// ============================================
// foodSearchRoutes.js — Add to fitforge-backend
// Import in server.js: require('./foodSearchRoutes')(app, supabase)
// ============================================

const packagedFood = require('./utils/packagedFood');

const KNOWN_CATEGORIES = new Set([
  'breakfast',
  'combo',
  'dal_sabzi',
  'dessert',
  'drink',
  'protein',
  'roti_rice',
  'snack',
  'fruit',
  'vegetable',
  'grain',
  'dairy',
  'other',
]);

const LOW_CALORIE_TERMS = [
  'black coffee',
  'green tea',
  'tea',
  'water',
  'sparkling water',
  'soda water',
  'diet soda',
  'zero sugar',
  'zero calorie',
  'cucumber',
  'herb',
  'herbs',
  'spice',
  'spices',
  'seasoning',
];

function normalizeText(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function hasMeaningfulName(name) {
  const normalized = normalizeText(name);
  if (!normalized || normalized === 'unknown food') return false;
  if (normalized.length < 2) return false;
  if (/^\d+$/.test(normalized)) return false;
  return true;
}

function isLowCalorieException(food) {
  const text = normalizeText(`${food.name} ${food.category} ${food.serving_description}`);
  return LOW_CALORIE_TERMS.some(term => text.includes(term));
}

function normalizeCategory(product) {
  const categories = (product.categories_tags || []).join(' ').toLowerCase();
  const nameText = normalizeText([
    product.product_name_en,
    product.product_name,
    product.generic_name_en,
    product.generic_name,
  ].filter(Boolean).join(' '));

  if (categories.includes('breakfast')) return 'breakfast';
  if (categories.includes('dessert') || categories.includes('sweet') || categories.includes('mithai')) return 'dessert';
  if (categories.includes('beverage') || categories.includes('drink') || categories.includes('juice') || categories.includes('coffee') || categories.includes('tea')) return 'drink';
  if (categories.includes('dairy') || categories.includes('milk') || categories.includes('cheese') || categories.includes('yogurt') || categories.includes('curd')) return 'dairy';
  if (categories.includes('meat') || categories.includes('chicken') || categories.includes('fish') || categories.includes('egg') || categories.includes('protein')) return 'protein';
  if (categories.includes('vegetable') || categories.includes('sabzi')) return 'vegetable';
  if (categories.includes('fruit')) return 'fruit';
  if (categories.includes('grain') || categories.includes('cereal') || categories.includes('rice') || categories.includes('bread') || categories.includes('roti') || categories.includes('oat') || categories.includes('pasta') || categories.includes('noodle')) return 'grain';
  if (categories.includes('snack') || categories.includes('biscuit') || categories.includes('chips') || categories.includes('namkeen')) return 'snack';
  if (categories.includes('legume') || categories.includes('dal') || categories.includes('lentil') || categories.includes('bean')) return 'dal_sabzi';
  if (nameText.includes('dal') || nameText.includes('sabzi') || nameText.includes('curry')) return 'dal_sabzi';
  if (nameText.includes('roti') || nameText.includes('chapati') || nameText.includes('naan') || nameText.includes('rice')) return 'roti_rice';
  if (nameText.includes('biryani') || nameText.includes('thali') || nameText.includes('meal')) return 'combo';

  return 'other';
}

function isBrokenServingUnit(unit) {
  const normalized = String(unit || '').trim().toLowerCase();
  if (!normalized) return true;
  if (/\(\s*g\s*\)/i.test(normalized)) return true;
  if (/[|/~]/.test(normalized)) return true;
  if (/^(portion|pack|meal|box|serving|packets?)\b.*\(\s*g\s*\)/i.test(normalized)) return true;
  return false;
}

function validateOFFCacheCandidate(food) {
  const reasons = [];
  const calories = Number(food.calories_per_serving);
  const protein = Number(food.protein_g);
  const carbs = Number(food.carbs_g);
  const fat = Number(food.fat_g);
  const servingSize = Number(food.serving_size);
  const macroCalories = (protein * 4) + (carbs * 4) + (fat * 9);

  if (!hasMeaningfulName(food.name)) reasons.push('missing_or_meaningless_name');
  if (!Number.isFinite(calories) || calories <= 0 || calories > 3000) reasons.push('unrealistic_calories_per_serving');
  if (Number.isFinite(calories) && calories > 0 && calories < 10 && !isLowCalorieException(food)) reasons.push('suspicious_tiny_calories');
  if (!Number.isFinite(servingSize) || servingSize <= 0) reasons.push('invalid_serving_size');
  if (isBrokenServingUnit(food.serving_unit)) reasons.push('invalid_serving_unit');
  if (!KNOWN_CATEGORIES.has(food.category)) reasons.push('unknown_category');
  if (![protein, carbs, fat].every(Number.isFinite)) reasons.push('invalid_macros');
  if ([protein, carbs, fat].some(value => Number.isFinite(value) && value < 0)) reasons.push('negative_macros');
  if (
    Number.isFinite(calories) &&
    calories > 0 &&
    [protein, carbs, fat].every(Number.isFinite) &&
    macroCalories > (calories * 1.35) + 20
  ) {
    reasons.push('macro_calories_exceed_calories');
  }
  if (food.source !== 'openfoodfacts') reasons.push('invalid_source');

  return { ok: reasons.length === 0, reasons };
}

function sourceRank(source) {
  const normalized = normalizeText(source);
  if (normalized === 'openfoodfacts') return -600;
  if (normalized === 'user') return -100;
  if (normalized.includes('curated')) return 350;
  if (normalized.includes('ifct')) return 300;
  if (normalized.includes('estimate')) return 200;
  return 0;
}

function qualityRank(qualityRecords = []) {
  if (!qualityRecords.length) return 0;

  return qualityRecords.reduce((best, quality) => {
    const status = normalizeText(quality.validation_status);
    const source = normalizeText(quality.source);
    const confidence = Number(quality.confidence_score) || 0;
    let score = Math.round(confidence * 100);

    if (source.includes('curated')) score += 250;
    if (status === 'verified') score += 350;
    else if (status === 'estimated') score += 250;
    else if (status === 'imported') score -= 100;
    else if (status === 'needs_review') score -= 800;
    else if (status === 'rejected') score -= 2000;

    return Math.max(best, score);
  }, -2000);
}

function countryRank(countryTags = []) {
  return countryTags.reduce((best, tag) => {
    const countryCode = String(tag.country_code || '').toUpperCase();
    const tier = normalizeText(tag.popularity_tier);
    const cuisine = normalizeText(tag.cuisine);
    let score = 0;

    if (countryCode === 'IN') score += 300;
    if (tier === 'core') score += 160;
    else if (tier === 'common') score += 90;
    else if (tier === 'niche') score += 20;
    if (cuisine.includes('fitness')) score += 60;

    return Math.max(best, score);
  }, 0);
}

function textMatchScore(text, normalizedQuery) {
  const normalizedText = normalizeText(text);
  if (!normalizedText || !normalizedQuery) return 0;
  if (normalizedText === normalizedQuery) return 10000;
  if (normalizedText.startsWith(normalizedQuery)) return 8000;
  if (normalizedText.split(' ').some(token => token.startsWith(normalizedQuery))) return 7000;
  if (normalizedText.includes(` ${normalizedQuery} `) || normalizedText.endsWith(` ${normalizedQuery}`)) return 6000;
  return 0;
}

function rawTextMatchScore(text, rawQuery) {
  const rawText = String(text || '').toLowerCase().trim();
  const rawSearch = String(rawQuery || '').toLowerCase().trim();
  if (!rawText || !rawSearch) return 0;
  if (normalizeText(rawSearch)) return 0;
  if (rawText === rawSearch) return 10000;
  if (rawText.startsWith(rawSearch)) return 8000;
  if (rawText.includes(rawSearch)) return 6000;
  return 0;
}

function categoryMatchScore(category, normalizedQuery) {
  return textMatchScore(category, normalizedQuery) > 0 ? 1500 : 0;
}

function aliasMatchScore(aliasMatches = [], normalizedQuery, rawQuery) {
  return aliasMatches.reduce((best, alias) => {
    const normalizedAlias = normalizeText(alias.normalized_alias || alias.alias);
    let score = rawTextMatchScore(alias.alias, rawQuery);

    if (normalizedQuery && normalizedAlias === normalizedQuery) score = 9500;
    else if (normalizedQuery && normalizedAlias.startsWith(normalizedQuery)) score = 7600;
    else if (normalizedQuery && normalizedAlias.split(' ').some(token => token.startsWith(normalizedQuery))) score = 6800;
    else if (normalizedQuery && (normalizedAlias.includes(` ${normalizedQuery} `) || normalizedAlias.endsWith(` ${normalizedQuery}`))) score = 5800;

    score += Number(alias.priority) || 0;
    if (alias.alias_type === 'hindi' || alias.alias_type === 'hinglish') score += 80;
    if (alias.alias_type === 'common') score += 40;

    return Math.max(best, score);
  }, 0);
}

function rankFoodResult(food, context = {}) {
  const normalizedQuery = context.normalizedQuery || '';
  const rawQuery = context.rawQuery || '';
  const aliases = context.aliases || [];
  const quality = context.quality || [];
  const countryTags = context.countryTags || [];

  const directScore = Math.max(
    textMatchScore(food.name, normalizedQuery),
    textMatchScore(food.normalized_name, normalizedQuery),
    textMatchScore(food.name_hindi, normalizedQuery),
    textMatchScore(food.brand, normalizedQuery),
    categoryMatchScore(food.category, normalizedQuery),
    rawTextMatchScore(food.name, rawQuery),
    rawTextMatchScore(food.name_hindi, rawQuery),
    rawTextMatchScore(food.brand, rawQuery)
  );
  const aliasScore = aliasMatchScore(aliases, normalizedQuery, rawQuery);

  return Math.max(directScore, aliasScore) +
    ((Number(food.search_priority) || 0) * 20) +
    ((Number(food.popularity_score) || 0) * 100) +
    (food.is_indian ? 180 : 0) +
    (food.is_combo ? 30 : 0) +
    sourceRank(food.source) +
    qualityRank(quality) +
    countryRank(countryTags);
}

function bestDefaultPortion(portions = []) {
  if (!portions.length) return null;
  return portions.find(portion => portion.is_default) || portions[0];
}

function decorateFoodResult(food, metadata, normalizedQuery, rawQuery = '') {
  const aliases = metadata.aliasesByFoodId.get(food.id) || [];
  const quality = metadata.qualityByFoodId.get(food.id) || [];
  const portions = metadata.portionsByFoodId.get(food.id) || [];
  const countryTags = metadata.countryTagsByFoodId.get(food.id) || [];
  const defaultPortion = bestDefaultPortion(portions);

  return {
    ...food,
    source_label: food.source === 'openfoodfacts' ? 'Open Food Facts' : 'Gymvyn',
    default_portion: defaultPortion,
    matched_aliases: aliases.map(alias => alias.alias),
    search_rank: rankFoodResult(food, {
      aliases,
      quality,
      countryTags,
      normalizedQuery,
      rawQuery,
    }),
  };
}

function decorateCustomFoodResult(food, normalizedQuery, rawQuery = '') {
  const searchRank = Math.max(
    textMatchScore(food.name, normalizedQuery),
    textMatchScore(food.normalized_name, normalizedQuery),
    textMatchScore(food.brand, normalizedQuery),
    rawTextMatchScore(food.name, rawQuery),
    rawTextMatchScore(food.brand, rawQuery)
  ) + 250000;

  return {
    ...food,
    id: food.id,
    food_id: null,
    custom_food_id: food.id,
    is_custom: true,
    source: 'user_custom',
    source_label: 'Custom',
    default_portion: {
      portion_name: food.serving_description || `${food.serving_size} ${food.serving_unit}`,
      serving_size: food.serving_size,
      serving_unit: food.serving_unit,
      grams_equivalent: food.grams_equivalent,
      ml_equivalent: food.ml_equivalent,
      calories: food.calories_per_serving,
      protein_g: food.protein_g,
      carbs_g: food.carbs_g,
      fat_g: food.fat_g,
      fiber_g: food.fiber_g,
      is_default: true,
      is_estimated: false,
      portion_note: food.notes || null,
    },
    matched_aliases: [],
    search_rank: searchRank,
  };
}

function packagedSearchIntent(query) {
  const normalized = normalizeText(query);
  const packageTerms = [
    'bar',
    'biscuit',
    'chips',
    'cookie',
    'cookies',
    'cereal',
    'protein powder',
    'whey',
    'drink',
    'shake',
    'yogurt',
    'curd',
    'milk',
    'chocolate',
    'pack',
    'instant',
    'ready to eat',
    'coke',
    'pepsi',
    'lays',
    'amul',
    'nestle',
    'kellogg',
    'quaker',
    'gatorade',
  ];
  return packageTerms.some(term => normalized.includes(term)) || /\b\d+\s*(g|ml|oz|lb)\b/.test(normalized);
}

function decoratePackagedFoodResult(food, normalizedQuery, rawQuery = '') {
  const qualityStatus = normalizeText(food.quality_status);
  const directScore = Math.max(
    textMatchScore(food.name, normalizedQuery),
    textMatchScore(food.normalized_name, normalizedQuery),
    textMatchScore(food.brand, normalizedQuery),
    rawTextMatchScore(food.name, rawQuery),
    rawTextMatchScore(food.brand, rawQuery)
  );
  const brandBoost = textMatchScore(food.brand, normalizedQuery) > 0 ? 1800 : 0;
  const qualityPenalty = qualityStatus === 'verified' ? 0 : qualityStatus === 'needs_review' ? -1500 : -10000;
  const intentBoost = packagedSearchIntent(rawQuery) ? 1500 : -900;

  return {
    ...packagedFood.toPackagedFoodResponse(food),
    id: food.id,
    food_id: null,
    packaged_food_id: food.id,
    is_packaged: true,
    matched_aliases: [],
    search_rank: directScore + brandBoost + qualityPenalty + intentBoost,
  };
}

function mergeFoodResults(existingResults, incomingResults) {
  const byKey = new Map();

  [...existingResults, ...incomingResults].forEach(result => {
    const key = `${result.source || ''}:${result.id || normalizeText(result.name)}`;
    const existing = byKey.get(key);
    if (!existing || (Number(result.search_rank) || 0) > (Number(existing.search_rank) || 0)) {
      byKey.set(key, result);
    }
  });

  return [...byKey.values()].sort((a, b) => {
    const rankDelta = (Number(b.search_rank) || 0) - (Number(a.search_rank) || 0);
    if (rankDelta !== 0) return rankDelta;
    return String(a.name || '').localeCompare(String(b.name || ''));
  });
}

module.exports = function (app, supabase) {

  const OFF_BASE = 'https://world.openfoodfacts.org';
  const OFF_INDIA = 'https://in.openfoodfacts.org';

  function selectPackagedFoodColumns() {
    return [
      'id',
      'barcode',
      'name',
      'normalized_name',
      'brand',
      'category',
      'image_url',
      'serving_size',
      'serving_unit',
      'serving_description',
      'grams_equivalent',
      'ml_equivalent',
      'calories_per_serving',
      'protein_g',
      'carbs_g',
      'fat_g',
      'fiber_g',
      'sugar_g',
      'sodium_mg',
      'saturated_fat_g',
      'ingredients',
      'allergens',
      'countries',
      'source',
      'source_product_id',
      'source_url',
      'quality_status',
      'confidence_score',
      'rejection_reasons',
      'last_verified_at',
      'created_at',
      'updated_at',
    ].join(', ');
  }

  function packagedFoodInsertPayload(food) {
    return {
      barcode: food.barcode,
      name: food.name,
      normalized_name: food.normalized_name,
      brand: food.brand,
      category: food.category || 'packaged',
      image_url: food.image_url,
      serving_size: food.serving_size,
      serving_unit: food.serving_unit,
      serving_description: food.serving_description,
      grams_equivalent: food.grams_equivalent,
      ml_equivalent: food.ml_equivalent,
      calories_per_serving: food.calories_per_serving,
      protein_g: food.protein_g,
      carbs_g: food.carbs_g,
      fat_g: food.fat_g,
      fiber_g: food.fiber_g,
      sugar_g: food.sugar_g,
      sodium_mg: food.sodium_mg,
      saturated_fat_g: food.saturated_fat_g,
      ingredients: food.ingredients,
      allergens: food.allergens || [],
      countries: food.countries || [],
      source: food.source || 'openfoodfacts',
      source_product_id: food.source_product_id,
      source_url: food.source_url,
      quality_status: food.quality_status || 'needs_review',
      confidence_score: food.confidence_score ?? 0.5,
      rejection_reasons: food.rejection_reasons || [],
      last_verified_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
  }

  async function getPackagedFoodByBarcode(barcode) {
    const { data, error } = await supabase
      .from('packaged_foods')
      .select(selectPackagedFoodColumns())
      .eq('barcode', barcode)
      .maybeSingle();
    if (error) {
      console.error('Packaged food barcode lookup error:', error.message);
      return null;
    }
    return data || null;
  }

  async function cachePackagedFood(food) {
    const validation = packagedFood.validatePackagedFood(food);
    if (!validation.ok) {
      return {
        cached: false,
        skipped: true,
        reasons: validation.reasons,
        food: {
          ...food,
          quality_status: 'rejected',
          confidence_score: 0.1,
          rejection_reasons: validation.reasons,
        },
      };
    }

    const payload = packagedFoodInsertPayload({
      ...food,
      quality_status: food.quality_status || validation.quality_status,
      confidence_score: food.confidence_score ?? validation.confidence_score,
      rejection_reasons: food.rejection_reasons || validation.reasons,
    });

    const { data, error } = await supabase
      .from('packaged_foods')
      .upsert(payload, { onConflict: 'barcode' })
      .select(selectPackagedFoodColumns())
      .single();

    if (error) {
      console.error('Packaged food cache write error:', error.message);
      return { cached: false, skipped: false, reasons: ['cache_write_failed'], food };
    }

    return { cached: true, skipped: false, reasons: [], food: data };
  }

  async function fetchOFFProduct(barcode) {
    const offUrl = `${OFF_BASE}/api/v2/product/${barcode}?fields=code,_id,url,product_name,product_name_en,generic_name,generic_name_en,brands,categories_tags,countries,countries_tags,allergens,allergens_tags,ingredients_text,ingredients_text_en,nutriments,serving_size,serving_quantity,image_front_small_url,image_front_url,image_url`;

    const offRes = await fetch(offUrl, {
      headers: { 'User-Agent': 'Gymvyn/1.0 (gymvyn.com)' },
      signal: AbortSignal.timeout(8000),
    });

    if (!offRes.ok) return null;
    const offData = await offRes.json();
    if (offData.status !== 1 || !offData.product) return null;
    return offData.product;
  }

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

    const categories = (product.categories_tags || []).join(' ').toLowerCase();
    const category = normalizeCategory(product);

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

  // Legacy guard retained for older callers/tests. New packaged-food writes use
  // cachePackagedFood() and never persist Open Food Facts rows to food_database.
  async function cacheFood(food) {
    const validation = validateOFFCacheCandidate(food);
    if (!validation.ok) {
      return { cached: false, skipped: true, reasons: validation.reasons };
    }

    try {
      const normalized = {
        ...food,
        normalized_name: normalizeText(food.name),
        source_product_id: food.off_id,
        quality_status: 'needs_review',
        confidence_score: 0.62,
        rejection_reasons: [],
      };
      return await cachePackagedFood(normalized);
    } catch (e) {
      // Non-critical — caching failure is fine
      return { cached: false, skipped: false, reasons: ['cache_write_failed'] };
    }
  }

  async function fetchFoodMetadata(foodIds) {
    const metadata = {
      aliasesByFoodId: new Map(),
      qualityByFoodId: new Map(),
      portionsByFoodId: new Map(),
      countryTagsByFoodId: new Map(),
    };

    if (!foodIds.length) return metadata;

    const [aliasesRes, qualityRes, portionsRes, countryTagsRes] = await Promise.all([
      supabase
        .from('food_aliases')
        .select('food_id, alias, normalized_alias, language, alias_type, priority')
        .in('food_id', foodIds),
      supabase
        .from('food_quality')
        .select('food_id, source, confidence_score, validation_status, notes')
        .in('food_id', foodIds),
      supabase
        .from('food_portions')
        .select('food_id, portion_name, serving_size, serving_unit, grams_equivalent, ml_equivalent, calories, protein_g, carbs_g, fat_g, fiber_g, is_default, is_estimated, portion_note')
        .in('food_id', foodIds)
        .order('is_default', { ascending: false }),
      supabase
        .from('food_country_tags')
        .select('food_id, country_code, country_name, cuisine, popularity_tier')
        .in('food_id', foodIds),
    ]);

    [
      ['aliasesByFoodId', aliasesRes.data || []],
      ['qualityByFoodId', qualityRes.data || []],
      ['portionsByFoodId', portionsRes.data || []],
      ['countryTagsByFoodId', countryTagsRes.data || []],
    ].forEach(([mapName, rows]) => {
      rows.forEach(row => {
        const currentRows = metadata[mapName].get(row.food_id) || [];
        currentRows.push(row);
        metadata[mapName].set(row.food_id, currentRows);
      });
    });

    return metadata;
  }

  async function searchLocalFoods(query, limit) {
    const normalizedQuery = normalizeText(query);
    const safeQuery = query.replace(/[%_(),'"]/g, '').slice(0, 100);
    const safeNormalizedQuery = normalizedQuery.replace(/[%_(),'"]/g, '').slice(0, 100);
    const localResultsById = new Map();

    if (!safeQuery.trim() && !safeNormalizedQuery) return [];

    const foodConditions = [
      `name.ilike.%${safeQuery}%`,
      `name_hindi.ilike.%${safeQuery}%`,
      `category.ilike.%${safeQuery}%`,
      `brand.ilike.%${safeQuery}%`,
    ];

    if (safeNormalizedQuery) {
      foodConditions.push(`normalized_name.ilike.%${safeNormalizedQuery}%`);
    }

    const { data: directFoods, error: directError } = await supabase
      .from('food_database')
      .select('*')
      .or(foodConditions.join(','))
      .limit(40);

    if (directError) {
      console.error('Local food direct search error:', directError.message);
    }

    (directFoods || []).forEach(food => {
      localResultsById.set(food.id, food);
    });

    const aliasConditions = [`alias.ilike.%${safeQuery}%`];
    if (safeNormalizedQuery) {
      aliasConditions.push(`normalized_alias.ilike.%${safeNormalizedQuery}%`);
    }

    const { data: aliasMatches, error: aliasError } = await supabase
      .from('food_aliases')
      .select('food_id, alias, normalized_alias, language, alias_type, priority')
      .or(aliasConditions.join(','))
      .order('priority', { ascending: false })
      .limit(80);

    if (aliasError) {
      console.error('Local food alias search error:', aliasError.message);
    }

    const aliasFoodIds = [...new Set((aliasMatches || []).map(alias => alias.food_id).filter(Boolean))];
    if (aliasFoodIds.length) {
      const { data: aliasFoods, error: aliasFoodError } = await supabase
        .from('food_database')
        .select('*')
        .in('id', aliasFoodIds);

      if (aliasFoodError) {
        console.error('Local food alias canonical fetch error:', aliasFoodError.message);
      }

      (aliasFoods || []).forEach(food => {
        localResultsById.set(food.id, food);
      });
    }

    const localFoods = [...localResultsById.values()];
    const metadata = await fetchFoodMetadata(localFoods.map(food => food.id));

    (aliasMatches || []).forEach(alias => {
      const currentAliases = metadata.aliasesByFoodId.get(alias.food_id) || [];
      if (!currentAliases.some(existing => existing.normalized_alias === alias.normalized_alias)) {
        currentAliases.push(alias);
        metadata.aliasesByFoodId.set(alias.food_id, currentAliases);
      }
    });

    return localFoods
      .map(food => decorateFoodResult(food, metadata, normalizedQuery, query))
      .filter(food => (Number(food.search_rank) || 0) > 0)
      .sort((a, b) => (Number(b.search_rank) || 0) - (Number(a.search_rank) || 0))
      .slice(0, Math.max(limit, 20));
  }

  async function getOptionalUserId(req) {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) return null;

    const { data, error } = await supabase.auth.getUser(token);
    if (error || !data?.user?.id) return null;
    return data.user.id;
  }

  async function searchCustomFoods(userId, query, limit) {
    if (!userId) return [];

    const normalizedQuery = normalizeText(query);
    const safeQuery = query.replace(/[%_(),'"]/g, '').slice(0, 100);
    const safeNormalizedQuery = normalizedQuery.replace(/[%_(),'"]/g, '').slice(0, 100);
    if (!safeQuery.trim() && !safeNormalizedQuery) return [];

    const conditions = [
      `name.ilike.%${safeQuery}%`,
      `brand.ilike.%${safeQuery}%`,
    ];
    if (safeNormalizedQuery) {
      conditions.push(`normalized_name.ilike.%${safeNormalizedQuery}%`);
    }

    const { data, error } = await supabase
      .from('user_custom_foods')
      .select('*')
      .eq('user_id', userId)
      .or(conditions.join(','))
      .limit(Math.max(limit, 20));

    if (error) {
      console.error('Custom food search error:', error.message);
      return [];
    }

    return (data || [])
      .map(food => decorateCustomFoodResult(food, normalizedQuery, query))
      .filter(food => (Number(food.search_rank) || 0) > 0);
  }

  async function searchPackagedFoods(query, limit) {
    const normalizedQuery = normalizeText(query);
    const safeQuery = query.replace(/[%_(),'"]/g, '').slice(0, 100);
    const safeNormalizedQuery = normalizedQuery.replace(/[%_(),'"]/g, '').slice(0, 100);
    if (!safeQuery.trim() && !safeNormalizedQuery) return [];

    const conditions = [
      `name.ilike.%${safeQuery}%`,
      `brand.ilike.%${safeQuery}%`,
    ];
    if (safeNormalizedQuery) {
      conditions.push(`normalized_name.ilike.%${safeNormalizedQuery}%`);
    }

    const { data, error } = await supabase
      .from('packaged_foods')
      .select(selectPackagedFoodColumns())
      .or(conditions.join(','))
      .neq('quality_status', 'rejected')
      .limit(Math.max(limit, 20));

    if (error) {
      console.error('Packaged food search error:', error.message);
      return [];
    }

    return (data || [])
      .map(food => decoratePackagedFoodResult(food, normalizedQuery, query))
      .filter(food => (Number(food.search_rank) || 0) > 0);
  }

  async function handleBarcodeLookup(req, res) {
    try {
      const barcode = packagedFood.normalizeBarcode(req.params.barcode);
      if (!barcode || barcode.length < 6) {
        return res.status(400).json({
          error: 'Invalid barcode',
          can_log: false,
          can_create_custom_food: true,
        });
      }

      const cached = await getPackagedFoodByBarcode(barcode);
      if (cached && packagedFood.isPackagedFoodLoggable(cached)) {
        return res.json(packagedFood.toPackagedFoodResponse(cached, {
          cache_status: 'hit',
          can_log: true,
        }));
      }

      const product = await fetchOFFProduct(barcode);
      if (!product) {
        return res.status(404).json({
          error: 'Product not found',
          barcode,
          can_log: false,
          can_create_custom_food: true,
          rejection_reasons: ['not_found_in_openfoodfacts'],
        });
      }

      const normalized = packagedFood.normalizeOFFProduct({ ...product, code: product.code || barcode });
      const cacheResult = await cachePackagedFood(normalized);

      if (!cacheResult.cached) {
        return res.status(422).json(packagedFood.toPackagedFoodResponse(cacheResult.food || normalized, {
          error: 'Product needs manual entry',
          status: 'needs_manual_entry',
          cache_status: cacheResult.skipped ? 'rejected_not_cached' : 'not_cached',
          rejection_reasons: cacheResult.reasons,
          can_log: false,
          can_create_custom_food: true,
        }));
      }

      return res.json(packagedFood.toPackagedFoodResponse(cacheResult.food, {
        cache_status: 'cached',
        can_log: true,
      }));
    } catch (err) {
      console.error('Barcode lookup error:', err);
      res.status(500).json({ error: err.message });
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
      const userId = await getOptionalUserId(req);

      // 1. Local DB search (fast, cached)
      if (source !== 'off') {
        results = await searchLocalFoods(sanitized, limit);
        const customResults = await searchCustomFoods(userId, sanitized, limit);
        const packagedResults = await searchPackagedFoods(sanitized, limit);
        results = mergeFoodResults(mergeFoodResults(customResults, results), packagedResults);
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

            // Cache only rows that pass stricter persistence validation. Search
            // can still show transient OFF results, but bad rows must not enter
            // food_database.
            offProducts.slice(0, 10).forEach(food => cacheFood(food));

            // Merge — deduplicate by name
            const existingNames = new Set(results.map(r => r.name.toLowerCase()));
            const newOFF = offProducts
              .filter(p => !existingNames.has(p.name.toLowerCase()))
              .map(p => ({ ...p, source_label: 'Open Food Facts', search_rank: -1000 }));

            results = mergeFoodResults(results, newOFF);
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

                // Same rule as Indian OFF search: useful transient search result,
                // cache only if the normalized row is clean enough to persist.
              globalProducts.slice(0, 5).forEach(food => cacheFood(food));

              const existingNames = new Set(results.map(r => r.name.toLowerCase()));
              const newGlobal = globalProducts
                .filter(p => !existingNames.has(p.name.toLowerCase()))
                .map(p => ({ ...p, source_label: 'Open Food Facts', search_rank: -1200 }));

              results = mergeFoodResults(results, newGlobal);
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
  // GET /api/foods/barcode/:barcode
  // Safe packaged-food barcode lookup
  // ──────────────────────────────────────────
  app.get('/api/foods/barcode/:barcode', handleBarcodeLookup);

  // ──────────────────────────────────────────
  // GET /api/food-barcode/:barcode
  // Legacy alias for older frontend builds
  // ──────────────────────────────────────────
  app.get('/api/food-barcode/:barcode', handleBarcodeLookup);

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

module.exports._test = {
  aliasMatchScore,
  decorateFoodResult,
  decoratePackagedFoodResult,
  mergeFoodResults,
  normalizeText,
  rankFoodResult,
  textMatchScore,
};
