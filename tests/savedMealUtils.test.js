const assert = require('node:assert/strict');
const { test } = require('node:test');

const {
  calculateSavedMealTotals,
  rowsFromResolvedSavedMealItems,
} = require('../utils/savedMealUtils');

test('saved meal totals sum calories and macros predictably', () => {
  const totals = calculateSavedMealTotals([
    { calories: 120, protein_g: 3, carbs_g: 20, fat_g: 3.5, fiber_g: 2 },
    { calories: 180, protein_g: 10, carbs_g: 25, fat_g: 5, fiber_g: 6 },
  ]);

  assert.deepEqual(totals, {
    total_calories: 300,
    total_protein_g: 13,
    total_carbs_g: 45,
    total_fat_g: 8.5,
    total_fiber_g: 8,
  });
});

test('saved meal item rows preserve canonical and custom references separately', () => {
  const rows = rowsFromResolvedSavedMealItems('meal-1', [
    {
      food_id: 'canonical-1',
      custom_food_id: null,
      food_name: 'Chapati',
      quantity: 2,
      serving_unit: 'piece',
      calories: 240,
      protein_g: 6,
      carbs_g: 40,
      fat_g: 7,
      portion_scaling: { macros: { fiber_g: 4 } },
    },
    {
      food_id: null,
      custom_food_id: 'custom-1',
      food_name: 'My Protein Oats',
      quantity: 1,
      serving_unit: 'bowl',
      calories: 420,
      protein_g: 32,
      carbs_g: 52,
      fat_g: 8,
    },
  ], [{}, { fiber_g: 7 }]);

  assert.equal(rows[0].food_id, 'canonical-1');
  assert.equal(rows[0].custom_food_id, null);
  assert.equal(rows[0].fiber_g, 4);
  assert.equal(rows[1].food_id, null);
  assert.equal(rows[1].custom_food_id, 'custom-1');
  assert.equal(rows[1].fiber_g, 7);
});
