const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const { auth } = require('../middleware/auth');
const { resolveFoodbaseIngredient } = require('../src/utils/dietPlanHelpers');
const { recipeIngredientRow, sumIngredientSnapshots } = require('../src/utils/nutritionMeal');

const router = express.Router();
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

// Foodbase detail includes only DB-backed portions; never creates a second
// food-entry system or exposes service credentials.
router.get('/foods/:foodId', auth, async (req, res) => {
  try {
    const { data: food, error } = await supabase.from('food_database')
      .select('id, name, category, calories_per_serving, protein_g, carbs_g, fat_g, fiber_g, serving_size, serving_unit, serving_description')
      .eq('id', req.params.foodId).maybeSingle();
    if (error) throw error;
    if (!food) return res.status(404).json({ error: 'Foodbase food not found' });
    const { data: portions, error: portionsError } = await supabase.from('food_portions')
      .select('portion_name, serving_size, serving_unit, grams_equivalent, ml_equivalent, calories, protein_g, carbs_g, fat_g, fiber_g, is_default, is_estimated, portion_note')
      .eq('food_id', food.id).order('is_default', { ascending: false });
    if (portionsError) throw portionsError;
    res.json({ food, portions: portions || [] });
  } catch (error) {
    console.error('GET /api/nutrition/foods/:foodId error:', error);
    res.status(500).json({ error: error.message });
  }
});

router.post('/meal-preview', auth, async (req, res) => {
  try {
    const ingredients = Array.isArray(req.body.ingredients) ? req.body.ingredients : [];
    if (!ingredients.length) return res.status(400).json({ error: 'Add at least one Foodbase ingredient' });
    const resolved = await Promise.all(ingredients.map(item => resolveFoodbaseIngredient(supabase, item)));
    res.json({ ingredients: resolved, totals: sumIngredientSnapshots(resolved) });
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message });
  }
});

router.get('/recipes', auth, async (req, res) => {
  try {
    const { data, error } = await supabase.from('nutrition_recipes')
      .select('*').eq('owner_id', req.user.id).order('updated_at', { ascending: false });
    if (error) throw error;
    res.json({ recipes: data || [], permissions: { can_save_team_recipe: false } });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/recipes', auth, async (req, res) => {
  try {
    const { name, meal_type, preparation_instructions, notes, tags, photo_url, ingredients, scope = 'personal' } = req.body;
    if (!String(name || '').trim()) return res.status(400).json({ error: 'Recipe name is required' });
    if (scope !== 'personal') return res.status(403).json({ error: 'You do not have permission to save to the team library' });
    const resolved = await Promise.all((ingredients || []).map(item => resolveFoodbaseIngredient(supabase, item)));
    if (!resolved.length) return res.status(400).json({ error: 'Add at least one Foodbase ingredient' });
    const totals = sumIngredientSnapshots(resolved);
    const { data: recipe, error } = await supabase.from('nutrition_recipes').insert({
      owner_id: req.user.id, scope, name: name.trim(), meal_type, preparation_instructions, notes,
      tags: Array.isArray(tags) ? tags : [], photo_url: photo_url || null, nutrition_snapshot: totals,
    }).select().single();
    if (error) throw error;
    const { error: ingredientsError } = await supabase.from('nutrition_recipe_ingredients').insert(
      resolved.map((item, sortOrder) => recipeIngredientRow(recipe.id, item, sortOrder))
    );
    if (ingredientsError) throw ingredientsError;
    res.status(201).json({ ...recipe, ingredients: resolved });
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message });
  }
});

module.exports = router;
