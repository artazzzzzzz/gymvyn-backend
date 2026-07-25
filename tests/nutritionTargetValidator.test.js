const assert = require('node:assert/strict');
const { test } = require('node:test');
const { validateDietPlanTarget, validateNutritionTarget } = require('../src/utils/nutritionTargetValidator');

test('accepts an exact nutrition-target calorie match', () => {
  const result = validateNutritionTarget({ calories: 1600, protein: 120, carbs: 100, fat: 80 });
  assert.equal(result.valid, true);
  assert.equal(result.macroCalories, 1600);
});

test('accepts a declared calorie value within the rounding tolerance', () => {
  const result = validateNutritionTarget({ calories: 1624, protein: 120, carbs: 100, fat: 80 });
  assert.equal(result.valid, true);
  assert.ok(Math.abs(result.tolerance - 32.48) < 0.001);
});

test('rejects a mismatched complete target with a clear message', () => {
  const result = validateNutritionTarget({ calories: 2000, protein: 120, carbs: 100, fat: 80 });
  assert.equal(result.valid, false);
  assert.equal(result.macroCalories, 1600);
  assert.match(result.error, /1,600 kcal, not 2,000 kcal/);
});

test('allows empty and partial optional targets without implying a complete target', () => {
  assert.deepEqual(validateNutritionTarget({}).valid, true);
  const partial = validateNutritionTarget({ calories: 2000, protein: 120 });
  assert.equal(partial.valid, true);
  assert.equal(partial.partial, true);
});

test('rejects zero, negative, and non-numeric target values', () => {
  for (const calories of [0, -1, 'not-a-number']) {
    const result = validateNutritionTarget({ calories, protein: 120, carbs: 100, fat: 80 });
    assert.equal(result.valid, false);
    assert.match(result.error, /positive numbers/);
  }
});

test('API guard rejects an invalid diet-template payload before persistence', () => {
  const result = validateDietPlanTarget({ calories_target: 2000, protein_g: 120, carbs_g: 100, fat_g: 80 });
  assert.equal(result.valid, false);
  assert.equal(result.status, 400);
  assert.match(result.error, /Adjust calories or macros/);
});
