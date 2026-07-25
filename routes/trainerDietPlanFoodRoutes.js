const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const {
  verifyMealOwnership,
  resolveFoodEntryPayload,
  resolveFoodbaseIngredient,
  recomputeMealTotals,
} = require('../src/utils/dietPlanHelpers');
const { auth } = require('../middleware/auth');

const router = express.Router();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

// POST /api/trainer/diet-plans/:planId/meals/:mealId/foods
router.post('/:planId/meals/:mealId/foods', auth, async (req, res) => {
  try {
    const { planId, mealId } = req.params;
    const meal = await verifyMealOwnership(supabase, req.user.id, planId, mealId);
    if (!meal) return res.status(404).json({ error: 'Not found' });

    const entry = req.body.food_id && req.body.serving_unit
      ? await resolveFoodbaseIngredient(supabase, req.body)
      : await resolveFoodEntryPayload(supabase, req.body);

    const { data: created, error: insertErr } = await supabase
      .from('diet_plan_foods')
      .insert({ meal_id: mealId, ...entry })
      .select()
      .single();
    if (insertErr) throw insertErr;

    await recomputeMealTotals(supabase, mealId);

    res.status(201).json(created);
  } catch (err) {
    console.error('POST /api/trainer/diet-plans/:planId/meals/:mealId/foods error:', err);
    res.status(err.status || 500).json({ error: err.message });
  }
});

// PATCH /api/trainer/diet-plans/:planId/meals/:mealId/foods/:foodEntryId
router.patch('/:planId/meals/:mealId/foods/:foodEntryId', auth, async (req, res) => {
  try {
    const { planId, mealId, foodEntryId } = req.params;
    const meal = await verifyMealOwnership(supabase, req.user.id, planId, mealId);
    if (!meal) return res.status(404).json({ error: 'Not found' });

    const { data: existing, error: existingErr } = await supabase
      .from('diet_plan_foods')
      .select('id, meal_id')
      .eq('id', foodEntryId)
      .maybeSingle();
    if (existingErr) throw existingErr;
    if (!existing || existing.meal_id !== mealId) {
      return res.status(404).json({ error: 'Not found' });
    }

    const entry = req.body.food_id && req.body.serving_unit
      ? await resolveFoodbaseIngredient(supabase, req.body)
      : await resolveFoodEntryPayload(supabase, req.body);

    const { data: updated, error: updateErr } = await supabase
      .from('diet_plan_foods')
      .update(entry)
      .eq('id', foodEntryId)
      .select()
      .single();
    if (updateErr) throw updateErr;

    await recomputeMealTotals(supabase, mealId);

    res.json(updated);
  } catch (err) {
    console.error('PATCH /api/trainer/diet-plans/:planId/meals/:mealId/foods/:foodEntryId error:', err);
    res.status(err.status || 500).json({ error: err.message });
  }
});

// DELETE /api/trainer/diet-plans/:planId/meals/:mealId/foods/:foodEntryId
router.delete('/:planId/meals/:mealId/foods/:foodEntryId', auth, async (req, res) => {
  try {
    const { planId, mealId, foodEntryId } = req.params;
    const meal = await verifyMealOwnership(supabase, req.user.id, planId, mealId);
    if (!meal) return res.status(404).json({ error: 'Not found' });

    const { data: existing, error: existingErr } = await supabase
      .from('diet_plan_foods')
      .select('id, meal_id')
      .eq('id', foodEntryId)
      .maybeSingle();
    if (existingErr) throw existingErr;
    if (!existing || existing.meal_id !== mealId) {
      return res.status(404).json({ error: 'Not found' });
    }

    const { error: deleteErr } = await supabase
      .from('diet_plan_foods')
      .delete()
      .eq('id', foodEntryId);
    if (deleteErr) throw deleteErr;

    await recomputeMealTotals(supabase, mealId);

    res.json({ success: true });
  } catch (err) {
    console.error('DELETE /api/trainer/diet-plans/:planId/meals/:mealId/foods/:foodEntryId error:', err);
    res.status(err.status || 500).json({ error: err.message });
  }
});

module.exports = router;
