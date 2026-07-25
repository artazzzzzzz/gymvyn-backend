'use strict';

const TARGET_FIELDS = ['calories', 'protein', 'carbs', 'fat'];

function parseOptionalPositive(value) {
  if (value === '' || value === null || value === undefined) return { empty: true, value: null };
  const parsed = typeof value === 'number' ? value : Number(String(value).trim());
  return Number.isFinite(parsed) && parsed > 0 ? { empty: false, value: parsed } : { empty: false, invalid: true };
}

function formatCalories(value) {
  return Number.isInteger(value)
    ? value.toLocaleString('en-IN')
    : (Math.round(value * 10) / 10).toLocaleString('en-IN');
}

function validateNutritionTarget({ calories, protein, carbs, fat }) {
  const values = { calories, protein, carbs, fat };
  const parsed = Object.fromEntries(TARGET_FIELDS.map(key => [key, parseOptionalPositive(values[key])]));
  const entered = TARGET_FIELDS.filter(key => !parsed[key].empty);
  const invalidFields = TARGET_FIELDS.filter(key => parsed[key].invalid);
  if (invalidFields.length) return { valid: false, status: 400, invalidFields, error: 'Nutrition targets must be positive numbers or omitted.' };
  if (entered.length === 0) return { valid: true, complete: false, partial: false };
  if (entered.length < TARGET_FIELDS.length) return { valid: true, complete: false, partial: true };

  const macroCalories = parsed.protein.value * 4 + parsed.carbs.value * 4 + parsed.fat.value * 9;
  const declaredCalories = parsed.calories.value;
  const tolerance = Math.max(25, declaredCalories * 0.02);
  if (Math.abs(declaredCalories - macroCalories) > tolerance) {
    return {
      valid: false, status: 400, invalidFields: TARGET_FIELDS, macroCalories, tolerance,
      error: `These macros add up to ${formatCalories(macroCalories)} kcal, not ${formatCalories(declaredCalories)} kcal. Adjust calories or macros before continuing.`,
    };
  }
  return { valid: true, complete: true, partial: false, macroCalories, tolerance };
}

function validateDietPlanTarget(payload = {}) {
  return validateNutritionTarget({
    calories: payload.calories_target,
    protein: payload.protein_g,
    carbs: payload.carbs_g,
    fat: payload.fat_g,
  });
}

module.exports = { validateDietPlanTarget, validateNutritionTarget };
