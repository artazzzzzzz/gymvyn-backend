const NUTRITION_KEYS = ['calories', 'protein_g', 'carbs_g', 'fat_g', 'fiber_g'];

function sumIngredientSnapshots(ingredients = []) {
  const totals = { calories: 0, protein_g: 0, carbs_g: 0, fat_g: 0, fiber_g: 0, weight_g: 0 };
  for (const ingredient of ingredients) {
    for (const key of NUTRITION_KEYS) totals[key] += Number(ingredient[key]) || 0;
    totals.weight_g += Number(ingredient.quantity_g) || 0;
  }
  return totals;
}

function recipeIngredientRow(recipeId, ingredient, sortOrder) {
  return {
    recipe_id: recipeId,
    food_id: ingredient.food_id,
    serving_quantity: ingredient.serving_quantity,
    serving_unit: ingredient.serving_unit,
    food_snapshot: ingredient.food_snapshot,
    sort_order: sortOrder,
  };
}

module.exports = { recipeIngredientRow, sumIngredientSnapshots };
