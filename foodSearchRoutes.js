// ============================================
// foodSearchRoutes.js — Add to fitforge-backend
// Import in server.js: require('./foodSearchRoutes')(app, supabase)
// ============================================

module.exports = function (app, supabase) {

  const OFF_BASE = 'https://world.openfoodfacts.org';
  const OFF_INDIA = 'https://in.openfoodfacts.org';

  // Normalize Open Food Facts product into our standard format
  function normalizeOFF(product) {
    if (!product) return null;

    const nutriments = product.nutriments || {};

    // Extract macros — OFF uses per 100g values
    const per100 = {
      calories: nutriments['energy-kcal_100g'] ||
                nutriments['energy-kcal'] ||
                (nutriments['energy_100g'] ? nutriments['energy_100g'] / 4.184 : 0),
      protein: nutriments['proteins_100g'] || nutriments['protein_100g'] || 0,
      carbs:   nutriments['carbohydrates_100g'] || 0,
      fat:     nutriments['fat_100g'] || 0,
      fiber:   nutriments['fiber_100g'] || nutriments['fibre_100g'] || 0,
      sugar:   nutriments['sugars_100g'] || 0,
      sodium:  nutriments['sodium_100g'] || 0,
    };

    // Serving size — prefer product's serving, fallback to 100g
    const servingSize = product.serving_size
      ? parseFloat(product.serving_size) || 100
      : 100;
    const servingUnit = product.serving_size
      ? (product.serving_size.replace(/[\d.]/g, '').trim() || 'g')
      : 'g';

    // Scale macros to serving size
    const scale = servingSize / 100;
    const perServing = {
      calories: Math.round((per100.calories * scale) * 10) / 10,
      protein:  Math.round((per100.protein  * scale) * 10) / 10,
      carbs:    Math.round((per100.carbs    * scale) * 10) / 10,
      fat:      Math.round((per100.fat      * scale) * 10) / 10,
      fiber:    Math.round((per100.fiber    * scale) * 10) / 10,
    };

    const name = product.product_name_en ||
                 product.product_name ||
                 product.generic_name_en ||
                 product.generic_name ||
                 'Unknown Food';

    // Category detection
    const categories = (product.categories_tags || []).join(' ').toLowerCase();
    let category = 'Other';
    if (categories.includes('dairy') || categories.includes('milk')) category = 'Dairy';
    else if (categories.includes('meat') || categories.includes('chicken') || categories.includes('fish')) category = 'Protein';
    else if (categories.includes('vegetable') || categories.includes('sabzi')) category = 'Vegetables';
    else if (categories.includes('fruit')) category = 'Fruits';
    else if (categories.includes('grain') || categories.includes('rice') || categories.includes('bread') || categories.includes('roti')) category = 'Grains';
    else if (categories.includes('snack') || categories.includes('biscuit') || categories.includes('chips')) category = 'Snacks';
    else if (categories.includes('beverage') || categories.includes('drink') || categories.includes('juice')) category = 'Beverages';
    else if (categories.includes('oil') || categories.includes('fat')) category = 'Fats & Oils';
    else if (categories.includes('sweet') || categories.includes('dessert') || categories.includes('mithai')) category = 'Sweets';
    else if (categories.includes('legume') || categories.includes('dal') || categories.includes('lentil') || categories.includes('bean')) category = 'Legumes';
    else if (categories.includes('spice') || categories.includes('masala')) category = 'Spices';

    // Detect if Indian food
    const indianKeywords = ['indian', 'hindi', 'masala', 'dal', 'roti', 'paneer', 'biryani',
      'curry', 'sabzi', 'mithai', 'halwa', 'chai', 'lassi', 'dosa', 'idli', 'samosa',
      'paratha', 'chapati', 'rajma', 'chana', 'aloo', 'matar', 'palak'];
    const productText = (name + ' ' + categories).toLowerCase();
    const isIndian = indianKeywords.some(k => productText.includes(k)) ||
      (product.countries_tags || []).some(c => c.includes('india'));

    return {
      off_id: product._id || product.id,
      barcode: product.code || product._id,
      name: name.trim(),
      brand: product.brands || null,
      category,
      is_indian: isIndian,
      source: 'openfoodfacts',
      image_url: product.image_front_small_url || product.image_url || null,
      // Per 100g
      calories_per_100g: Math.round(per100.calories * 10) / 10,
      protein_per_100g:  Math.round(per100.protein  * 10) / 10,
      carbs_per_100g:    Math.round(per100.carbs    * 10) / 10,
      fat_per_100g:      Math.round(per100.fat      * 10) / 10,
      fiber_per_100g:    Math.round(per100.fiber    * 10) / 10,
      // Per serving (default log values)
      calories_per_serving: perServing.calories,
      protein_g:  perServing.protein,
      carbs_g:    perServing.carbs,
      fat_g:      perServing.fat,
      fiber_g:    perServing.fiber,
      serving_size: servingSize,
      serving_unit: servingUnit,
      serving_description: `${servingSize}${servingUnit}`,
    };
  }

  // Cache food in local DB to speed up repeat searches
  async function cacheFood(food) {
    try {
      await supabase.from('food_database').upsert({
        name: food.name,
        category: food.category,
        calories_per_serving: food.calories_per_serving,
        protein_g: food.protein_g,
        carbs_g: food.carbs_g,
        fat_g: food.fat_g,
        fiber_g: food.fiber_g,
        serving_size: food.serving_size,
        serving_unit: food.serving_unit,
        serving_description: food.serving_description,
        is_indian: food.is_indian,
        is_combo: false,
        source: 'openfoodfacts',
        barcode: food.barcode || null,
        image_url: food.image_url || null,
        brand: food.brand || null,
        off_id: food.off_id || null,
      }, { onConflict: 'name,source' });
    } catch (e) {
      // Non-critical — caching failure is fine
    }
  }

  // ──────────────────────────────────────────
  // GET /api/food-search?q=query&source=all
  // Enhanced search: local DB first, then OFF
  // ──────────────────────────────────────────
  app.get('/api/food-search', async (req, res) => {
    try {
      const query = (req.query.q || '').trim();
      const source = req.query.source || 'all'; // 'local' | 'off' | 'all'
      const page = parseInt(req.query.page) || 1;
      const limit = Math.min(parseInt(req.query.limit) || 25, 50);

      if (!query) return res.json([]);

      // Sanitize query
      const sanitized = query.replace(/[%_()']/g, '').slice(0, 100);

      let results = [];

      // 1. Local DB search (fast, cached)
      if (source !== 'off') {
        const { data: localResults } = await supabase
          .from('food_database')
          .select('*')
          .or(`name.ilike.%${sanitized}%,name_hindi.ilike.%${sanitized}%,category.ilike.%${sanitized}%,brand.ilike.%${sanitized}%`)
          .order('is_combo', { ascending: false })
          .order('is_indian', { ascending: false })
          .limit(20);

        if (localResults?.length) {
          results = localResults.map(item => ({
            ...item,
            source_label: item.source === 'openfoodfacts' ? 'Open Food Facts' : 'Gymvyn',
          }));
        }
      }

      // 2. Open Food Facts search (if local has < 5 results or source = 'off')
      if (source !== 'local' && (results.length < 5 || source === 'off')) {
        try {
          const offUrl = `${OFF_BASE}/cgi/search.pl?` + new URLSearchParams({
            search_terms: sanitized,
            search_simple: 1,
            action: 'process',
            json: 1,
            page_size: limit,
            page,
            fields: [
              'code', '_id', 'product_name', 'product_name_en', 'generic_name',
              'brands', 'categories_tags', 'countries_tags',
              'nutriments', 'serving_size', 'serving_quantity',
              'image_front_small_url', 'image_url'
            ].join(','),
            // Prefer Indian products
            tagtype_0: 'countries',
            tag_contains_0: 'contains',
            tag_0: 'india',
          });

          const offRes = await fetch(offUrl, {
            headers: { 'User-Agent': 'FitForge/1.0 (fitforge.in)' },
            signal: AbortSignal.timeout(5000),
          });

          if (offRes.ok) {
            const offData = await offRes.json();
            const offProducts = (offData.products || [])
              .filter(p => p.product_name || p.product_name_en)
              .map(p => normalizeOFF(p))
              .filter(Boolean)
              .filter(p => p.calories_per_serving > 0 || p.protein_g > 0);

            // Cache results in background
            offProducts.slice(0, 10).forEach(food => cacheFood(food));

            // Merge — deduplicate by name
            const existingNames = new Set(results.map(r => r.name.toLowerCase()));
            const newOFF = offProducts
              .filter(p => !existingNames.has(p.name.toLowerCase()))
              .map(p => ({ ...p, source_label: 'Open Food Facts' }));

            results = [...results, ...newOFF];
          }
        } catch (offErr) {
          console.error('OFF search error:', offErr.message);
          // Graceful fallback — return local results only
        }

        // If still no Indian results, try global search without country filter
        if (results.length < 3) {
          try {
            const globalUrl = `${OFF_BASE}/cgi/search.pl?` + new URLSearchParams({
              search_terms: sanitized,
              search_simple: 1,
              action: 'process',
              json: 1,
              page_size: 20,
              fields: 'code,_id,product_name,product_name_en,brands,categories_tags,nutriments,serving_size,image_front_small_url',
            });
            const globalRes = await fetch(globalUrl, {
              headers: { 'User-Agent': 'FitForge/1.0 (fitforge.in)' },
              signal: AbortSignal.timeout(5000),
            });
            if (globalRes.ok) {
              const globalData = await globalRes.json();
              const globalProducts = (globalData.products || [])
                .map(p => normalizeOFF(p))
                .filter(Boolean)
                .filter(p => p.calories_per_serving > 0);

              globalProducts.slice(0, 5).forEach(food => cacheFood(food));

              const existingNames = new Set(results.map(r => r.name.toLowerCase()));
              const newGlobal = globalProducts
                .filter(p => !existingNames.has(p.name.toLowerCase()))
                .map(p => ({ ...p, source_label: 'Open Food Facts' }));

              results = [...results, ...newGlobal];
            }
          } catch (e) { /* ignore */ }
        }
      }

      res.json(results.slice(0, 50));
    } catch (err) {
      console.error('Food search error:', err);
      res.status(500).json({ error: err.message });
    }
  });

  // ──────────────────────────────────────────
  // GET /api/food-barcode/:barcode
  // Scan barcode → get food details
  // ──────────────────────────────────────────
  app.get('/api/food-barcode/:barcode', async (req, res) => {
    try {
      const { barcode } = req.params;
      if (!barcode || barcode.length < 6) {
        return res.status(400).json({ error: 'Invalid barcode' });
      }

      // 1. Check local cache first
      const { data: cached } = await supabase
        .from('food_database')
        .select('*')
        .eq('barcode', barcode)
        .single();

      if (cached) {
        return res.json({ ...cached, source_label: 'Gymvyn Cache' });
      }

      // 2. Fetch from Open Food Facts
      const offUrl = `${OFF_BASE}/api/v2/product/${barcode}?fields=code,_id,product_name,product_name_en,generic_name,brands,categories_tags,countries_tags,nutriments,serving_size,serving_quantity,image_front_small_url`;

      const offRes = await fetch(offUrl, {
        headers: { 'User-Agent': 'FitForge/1.0 (fitforge.in)' },
        signal: AbortSignal.timeout(8000),
      });

      if (!offRes.ok) {
        return res.status(404).json({ error: 'Product not found' });
      }

      const offData = await offRes.json();

      if (offData.status !== 1 || !offData.product) {
        return res.status(404).json({ error: 'Product not found in Open Food Facts' });
      }

      const normalized = normalizeOFF(offData.product);
      if (!normalized) {
        return res.status(404).json({ error: 'Product data incomplete' });
      }

      // Cache it
      await cacheFood(normalized);

      res.json({ ...normalized, source_label: 'Open Food Facts' });
    } catch (err) {
      console.error('Barcode lookup error:', err);
      res.status(500).json({ error: err.message });
    }
  });

  // ──────────────────────────────────────────
  // POST /api/food-database/add
  // Manually add a custom food to local DB
  // ──────────────────────────────────────────
  app.post('/api/food-database/add', async (req, res) => {
    try {
      const { name, category, caloriesPerServing, proteinG, carbsG, fatG,
              fiberG, servingSize, servingUnit, isIndian } = req.body;

      if (!name || !caloriesPerServing) {
        return res.status(400).json({ error: 'name and caloriesPerServing required' });
      }

      const { data, error } = await supabase
        .from('food_database')
        .insert({
          name: name.trim(),
          category: category || 'Other',
          calories_per_serving: parseFloat(caloriesPerServing),
          protein_g: parseFloat(proteinG) || 0,
          carbs_g: parseFloat(carbsG) || 0,
          fat_g: parseFloat(fatG) || 0,
          fiber_g: parseFloat(fiberG) || 0,
          serving_size: parseFloat(servingSize) || 100,
          serving_unit: servingUnit || 'g',
          serving_description: `${servingSize || 100}${servingUnit || 'g'}`,
          is_indian: isIndian !== false,
          is_combo: false,
          source: 'user',
        })
        .select()
        .single();

      if (error) throw error;
      res.json(data);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ──────────────────────────────────────────
  // PATCH /api/food-database/add-columns
  // Run once to add new columns to food_database
  // ──────────────────────────────────────────
  app.post('/api/food-database/migrate', async (req, res) => {
    try {
      // Add missing columns if they don't exist
      const queries = [
        `ALTER TABLE food_database ADD COLUMN IF NOT EXISTS barcode VARCHAR(50)`,
        `ALTER TABLE food_database ADD COLUMN IF NOT EXISTS image_url TEXT`,
        `ALTER TABLE food_database ADD COLUMN IF NOT EXISTS brand VARCHAR(255)`,
        `ALTER TABLE food_database ADD COLUMN IF NOT EXISTS off_id VARCHAR(100)`,
        `ALTER TABLE food_database ADD COLUMN IF NOT EXISTS calories_per_100g DECIMAL(8,2)`,
        `ALTER TABLE food_database ADD COLUMN IF NOT EXISTS protein_per_100g DECIMAL(8,2)`,
        `ALTER TABLE food_database ADD COLUMN IF NOT EXISTS carbs_per_100g DECIMAL(8,2)`,
        `ALTER TABLE food_database ADD COLUMN IF NOT EXISTS fat_per_100g DECIMAL(8,2)`,
        `ALTER TABLE food_database ADD COLUMN IF NOT EXISTS fiber_per_100g DECIMAL(8,2)`,
        `CREATE UNIQUE INDEX IF NOT EXISTS idx_food_db_name_source ON food_database(name, source)`,
        `CREATE INDEX IF NOT EXISTS idx_food_db_barcode ON food_database(barcode) WHERE barcode IS NOT NULL`,
      ];

      for (const sql of queries) {
        await supabase.rpc('exec_sql', { sql }).catch(() => {}); // ignore if column exists
      }
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  console.log('✅ Food search routes (Open Food Facts) loaded');
};
