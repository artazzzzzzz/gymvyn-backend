'use strict';

function numberOrZero(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function round(value, decimals = 1) {
  const factor = 10 ** decimals;
  return Math.round((Number(value) + Number.EPSILON) * factor) / factor;
}

function calculateSavedMealTotals(items = []) {
  return items.reduce((totals, item) => ({
    total_calories: round(totals.total_calories + numberOrZero(item.calories), 0),
    total_protein_g: round(totals.total_protein_g + numberOrZero(item.protein_g)),
    total_carbs_g: round(totals.total_carbs_g + numberOrZero(item.carbs_g)),
    total_fat_g: round(totals.total_fat_g + numberOrZero(item.fat_g)),
    total_fiber_g: round(totals.total_fiber_g + numberOrZero(item.fiber_g)),
  }), {
    total_calories: 0,
    total_protein_g: 0,
    total_carbs_g: 0,
    total_fat_g: 0,
    total_fiber_g: 0,
  });
}

function rowsFromResolvedSavedMealItems(savedMealId, resolvedItems = [], rawItems = []) {
  return resolvedItems.map((resolved, index) => {
    const raw = rawItems[index] || {};
    return {
      saved_meal_id: savedMealId,
      food_id: resolved.food_id ?? raw.food_id ?? raw.foodId ?? null,
      custom_food_id: resolved.custom_food_id ?? raw.custom_food_id ?? raw.customFoodId ?? null,
      food_name: resolved.food_name || raw.food_name || raw.foodName || raw.name,
      quantity: resolved.quantity ?? raw.quantity ?? 1,
      serving_unit: resolved.serving_unit ?? raw.serving_unit ?? raw.unit ?? null,
      serving_description: raw.serving_description ?? raw.servingDescription ?? null,
      calories: resolved.calories ?? raw.calories ?? 0,
      protein_g: resolved.protein_g ?? raw.protein_g ?? raw.proteinG ?? 0,
      carbs_g: resolved.carbs_g ?? raw.carbs_g ?? raw.carbsG ?? 0,
      fat_g: resolved.fat_g ?? raw.fat_g ?? raw.fatG ?? 0,
      fiber_g: resolved.portion_scaling?.macros?.fiber_g ?? raw.fiber_g ?? raw.fiberG ?? 0,
      sort_order: Number.isInteger(Number(raw.sort_order)) ? Number(raw.sort_order) : index,
    };
  });
}

module.exports = {
  calculateSavedMealTotals,
  rowsFromResolvedSavedMealItems,
};
