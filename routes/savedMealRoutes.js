const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const { z } = require('zod');
const { auth } = require('../middleware/auth');
const { resolveFoodItemsWithSupabase } = require('../utils/foodNutritionResolver');
const {
  calculateSavedMealTotals,
  rowsFromResolvedSavedMealItems,
} = require('../utils/savedMealUtils');

const router = express.Router();
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

const itemSchema = z.object({
  food_id: z.string().uuid().optional().nullable(),
  foodId: z.string().uuid().optional().nullable(),
  custom_food_id: z.string().uuid().optional().nullable(),
  customFoodId: z.string().uuid().optional().nullable(),
  food_name: z.string().trim().min(1).max(160).optional(),
  foodName: z.string().trim().min(1).max(160).optional(),
  name: z.string().trim().min(1).max(160).optional(),
  quantity: z.number().positive().optional().default(1),
  serving_unit: z.string().trim().max(40).optional().nullable(),
  unit: z.string().trim().max(40).optional().nullable(),
  serving_description: z.string().trim().max(160).optional().nullable(),
  calories: z.number().nonnegative().optional().default(0),
  protein_g: z.number().nonnegative().optional().default(0),
  proteinG: z.number().nonnegative().optional(),
  carbs_g: z.number().nonnegative().optional().default(0),
  carbsG: z.number().nonnegative().optional(),
  fat_g: z.number().nonnegative().optional().default(0),
  fatG: z.number().nonnegative().optional(),
  fiber_g: z.number().nonnegative().optional().default(0),
  fiberG: z.number().nonnegative().optional(),
  sort_order: z.number().int().optional(),
}).passthrough().refine(
  item => item.food_name || item.foodName || item.name || item.food_id || item.foodId || item.custom_food_id || item.customFoodId,
  'Each item needs a food name or food id'
);

const savedMealSchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(500).optional().nullable(),
  meal_type: z.string().trim().max(40).optional().nullable(),
  mealType: z.string().trim().max(40).optional().nullable(),
  items: z.array(itemSchema).min(1).max(50),
}).strict();

const savedMealUpdateSchema = savedMealSchema.partial().refine(
  value => Object.keys(value).length > 0,
  'At least one field is required'
);

function parseBody(schema, body) {
  const result = schema.safeParse(body || {});
  if (!result.success) {
    const message = result.error.issues
      .map(issue => `${issue.path.join('.') || 'body'}: ${issue.message}`)
      .join('; ');
    return { error: message };
  }
  return { data: result.data };
}

async function fetchMealWithItems(mealId, userId) {
  const { data: meal, error: mealError } = await supabase
    .from('saved_meals')
    .select('*')
    .eq('id', mealId)
    .eq('user_id', userId)
    .maybeSingle();
  if (mealError) throw mealError;
  if (!meal) return null;

  const { data: items, error: itemError } = await supabase
    .from('saved_meal_items')
    .select('*')
    .eq('saved_meal_id', mealId)
    .order('sort_order', { ascending: true });
  if (itemError) throw itemError;

  return { ...meal, items: items || [] };
}

async function resolveRowsForMeal(mealId, userId, items) {
  const resolverItems = items.map(item => ({
    ...item,
    user_id: userId,
    food_name: item.food_name || item.foodName || item.name,
    food_id: item.food_id || item.foodId,
    custom_food_id: item.custom_food_id || item.customFoodId,
    serving_unit: item.serving_unit || item.unit,
    protein_g: item.protein_g ?? item.proteinG,
    carbs_g: item.carbs_g ?? item.carbsG,
    fat_g: item.fat_g ?? item.fatG,
    fiber_g: item.fiber_g ?? item.fiberG,
  }));
  const resolvedItems = await resolveFoodItemsWithSupabase(supabase, resolverItems);
  return rowsFromResolvedSavedMealItems(mealId, resolvedItems, items);
}

async function insertMealItemsAndTotals(mealId, userId, items) {
  const itemRows = await resolveRowsForMeal(mealId, userId, items);
  const totals = calculateSavedMealTotals(itemRows);

  if (itemRows.length) {
    const { error: itemError } = await supabase
      .from('saved_meal_items')
      .insert(itemRows);
    if (itemError) throw itemError;
  }

  const { data: updatedMeal, error: updateError } = await supabase
    .from('saved_meals')
    .update({ ...totals, updated_at: new Date().toISOString() })
    .eq('id', mealId)
    .eq('user_id', userId)
    .select()
    .single();
  if (updateError) throw updateError;

  return { meal: updatedMeal, items: itemRows };
}

router.get('/', auth, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('saved_meals')
      .select('*')
      .eq('user_id', req.user.id)
      .order('updated_at', { ascending: false });
    if (error) throw error;
    res.json(data || []);
  } catch (err) {
    console.error('GET /api/saved-meals error:', err);
    res.status(500).json({ error: err.message || 'Failed to fetch saved meals' });
  }
});

router.get('/:id', auth, async (req, res) => {
  try {
    const meal = await fetchMealWithItems(req.params.id, req.user.id);
    if (!meal) return res.status(404).json({ error: 'Saved meal not found' });
    res.json(meal);
  } catch (err) {
    console.error('GET /api/saved-meals/:id error:', err);
    res.status(500).json({ error: err.message || 'Failed to fetch saved meal' });
  }
});

router.post('/', auth, async (req, res) => {
  let createdMealId = null;
  try {
    const parsed = parseBody(savedMealSchema, req.body);
    if (parsed.error) return res.status(400).json({ error: parsed.error });

    const { items, mealType, ...mealInput } = parsed.data;
    const { data: meal, error: mealError } = await supabase
      .from('saved_meals')
      .insert({
        user_id: req.user.id,
        name: mealInput.name,
        description: mealInput.description ?? null,
        meal_type: mealInput.meal_type ?? mealType ?? null,
      })
      .select()
      .single();
    if (mealError) throw mealError;
    createdMealId = meal.id;

    await insertMealItemsAndTotals(meal.id, req.user.id, items);
    const fullMeal = await fetchMealWithItems(meal.id, req.user.id);
    res.status(201).json(fullMeal);
  } catch (err) {
    if (createdMealId) {
      await supabase.from('saved_meals').delete().eq('id', createdMealId).eq('user_id', req.user.id);
    }
    console.error('POST /api/saved-meals error:', err);
    res.status(500).json({ error: err.message || 'Failed to create saved meal' });
  }
});

router.put('/:id', auth, async (req, res) => {
  try {
    const parsed = parseBody(savedMealUpdateSchema, req.body);
    if (parsed.error) return res.status(400).json({ error: parsed.error });

    const existing = await fetchMealWithItems(req.params.id, req.user.id);
    if (!existing) return res.status(404).json({ error: 'Saved meal not found' });

    const { items, mealType, ...mealInput } = parsed.data;
    const updates = { updated_at: new Date().toISOString() };
    if (mealInput.name !== undefined) updates.name = mealInput.name;
    if (mealInput.description !== undefined) updates.description = mealInput.description;
    if (mealInput.meal_type !== undefined || mealType !== undefined) updates.meal_type = mealInput.meal_type ?? mealType ?? null;

    const { error: mealError } = await supabase
      .from('saved_meals')
      .update(updates)
      .eq('id', req.params.id)
      .eq('user_id', req.user.id);
    if (mealError) throw mealError;

    if (items) {
      const { error: deleteError } = await supabase
        .from('saved_meal_items')
        .delete()
        .eq('saved_meal_id', req.params.id);
      if (deleteError) throw deleteError;
      await insertMealItemsAndTotals(req.params.id, req.user.id, items);
    }

    const fullMeal = await fetchMealWithItems(req.params.id, req.user.id);
    res.json(fullMeal);
  } catch (err) {
    console.error('PUT /api/saved-meals/:id error:', err);
    res.status(500).json({ error: err.message || 'Failed to update saved meal' });
  }
});

router.delete('/:id', auth, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('saved_meals')
      .delete()
      .eq('id', req.params.id)
      .eq('user_id', req.user.id)
      .select('id')
      .maybeSingle();
    if (error) throw error;
    if (!data) return res.status(404).json({ error: 'Saved meal not found' });
    res.json({ success: true, id: data.id });
  } catch (err) {
    console.error('DELETE /api/saved-meals/:id error:', err);
    res.status(500).json({ error: err.message || 'Failed to delete saved meal' });
  }
});

router.post('/:id/log', auth, async (req, res) => {
  try {
    const meal = await fetchMealWithItems(req.params.id, req.user.id);
    if (!meal) return res.status(404).json({ error: 'Saved meal not found' });

    const logDate = req.body?.log_date || req.body?.date || new Date().toISOString().slice(0, 10);
    const mealType = req.body?.meal_type || req.body?.mealType || meal.meal_type || 'meal';
    const rows = (meal.items || []).map(item => ({
      user_id: req.user.id,
      log_date: logDate,
      meal_type: mealType,
      food_name: item.food_name,
      quantity: item.quantity,
      serving_unit: item.serving_unit,
      calories: item.calories,
      protein_g: item.protein_g,
      carbs_g: item.carbs_g,
      fat_g: item.fat_g,
      logged_via: 'saved_meal',
      food_id: item.food_id,
    }));

    if (!rows.length) return res.status(400).json({ error: 'Saved meal has no items' });

    const { data, error } = await supabase
      .from('food_logs')
      .insert(rows)
      .select();
    if (error) throw error;

    res.status(201).json({
      saved_meal_id: meal.id,
      inserted_count: data.length,
      food_logs: data,
    });
  } catch (err) {
    console.error('POST /api/saved-meals/:id/log error:', err);
    res.status(500).json({ error: err.message || 'Failed to log saved meal' });
  }
});

module.exports = router;
