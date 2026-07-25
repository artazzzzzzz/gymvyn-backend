const assert = require('node:assert/strict');
const { test } = require('node:test');
const { recipeIngredientRow, sumIngredientSnapshots } = require('../src/utils/nutritionMeal');

test('meal totals include all planning nutrients and Foodbase-derived weight', () => {
  const totals = sumIngredientSnapshots([
    { calories: 120, protein_g: 6, carbs_g: 18, fat_g: 3, fiber_g: 4, quantity_g: 150 },
    { calories: 80, protein_g: 7, carbs_g: 5, fat_g: 4, fiber_g: 1, quantity_g: 100 },
  ]);
  assert.deepEqual(totals, { calories: 200, protein_g: 13, carbs_g: 23, fat_g: 7, fiber_g: 5, weight_g: 250 });
});

test('recipe ingredient mapping retains Foodbase identity and immutable snapshot', () => {
  const snapshot = { food_id: 'food-1', food_name: 'Dal', serving_quantity: 1, serving_unit: 'katori', macros: { calories: 180 } };
  assert.deepEqual(recipeIngredientRow('recipe-1', { food_id: 'food-1', serving_quantity: 1, serving_unit: 'katori', food_snapshot: snapshot }, 2), {
    recipe_id: 'recipe-1', food_id: 'food-1', serving_quantity: 1, serving_unit: 'katori', food_snapshot: snapshot, sort_order: 2,
  });
});
