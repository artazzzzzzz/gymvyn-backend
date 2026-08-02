const { scaleFoodForQuantity } = require('../../utils/foodPortionScaling');

const FOOD_ENTRY_FOOD_SELECT = [
  'id',
  'name',
  'calories_per_serving',
  'protein_g',
  'carbs_g',
  'fat_g',
  'fiber_g',
  'serving_size',
  'serving_unit',
].join(', ');

const PORTION_SELECT = [
  'portion_name',
  'serving_size',
  'serving_unit',
  'grams_equivalent',
  'ml_equivalent',
  'calories',
  'protein_g',
  'carbs_g',
  'fat_g',
  'fiber_g',
  'is_default',
  'is_estimated',
  'portion_note',
].join(', ');

// Verifies the meal (mealId) belongs to the given plan (planId) and that the
// plan is owned by trainerId. Returns the meal row or null.
const verifyMealOwnership = async (supabase, trainerId, planId, mealId) => {
  const { data: template, error: templateErr } = await supabase
    .from('diet_plan_templates')
    .select('id, trainer_id')
    .eq('id', planId)
    .eq('trainer_id', trainerId)
    .maybeSingle();
  if (templateErr || !template) return null;

  const { data: meal, error: mealErr } = await supabase
    .from('diet_plan_meals')
    .select('id, day_id')
    .eq('id', mealId)
    .maybeSingle();
  if (mealErr || !meal) return null;

  const { data: day, error: dayErr } = await supabase
    .from('diet_plan_days')
    .select('id, template_id')
    .eq('id', meal.day_id)
    .maybeSingle();
  if (dayErr || !day || day.template_id !== planId) return null;

  return meal;
};

// Resolves a { food_id, quantity_g } or manual { food_name, quantity_g,
// calories, protein_g, carbs_g, fat_g } payload into the snapshot values to
// persist on diet_plan_foods. Throws an Error with .status on bad input.
const resolveFoodEntryPayload = async (supabase, body) => {
  const quantityG = Number(body.quantity_g);
  if (!Number.isFinite(quantityG) || quantityG <= 0) {
    const err = new Error('quantity_g must be a positive number');
    err.status = 400;
    throw err;
  }

  if (body.food_id) {
    const { data: food, error: foodErr } = await supabase
      .from('food_database')
      .select(FOOD_ENTRY_FOOD_SELECT)
      .eq('id', body.food_id)
      .maybeSingle();
    if (foodErr) throw foodErr;
    if (!food) {
      const err = new Error('food_id not found');
      err.status = 404;
      throw err;
    }

    const { data: portions, error: portionsErr } = await supabase
      .from('food_portions')
      .select(PORTION_SELECT)
      .eq('food_id', food.id)
      .order('is_default', { ascending: false });
    if (portionsErr) throw portionsErr;

    const scaling = scaleFoodForQuantity({
      food,
      portions: portions || [],
      quantity: quantityG,
      unit: 'g',
    });

    if (!scaling.ok || !scaling.macros) {
      const err = new Error(scaling.reason || 'unable_to_scale_food_for_quantity');
      err.status = 422;
      throw err;
    }

    return {
      food_id: food.id,
      food_name: food.name,
      quantity_g: quantityG,
      calories: Math.round(scaling.macros.calories),
      protein_g: Math.round(scaling.macros.protein_g),
      carbs_g: Math.round(scaling.macros.carbs_g),
      fat_g: Math.round(scaling.macros.fat_g),
    };
  }

  if (!body.food_name || typeof body.food_name !== 'string') {
    const err = new Error('food_name is required for a custom food entry');
    err.status = 400;
    throw err;
  }

  const macros = ['calories', 'protein_g', 'carbs_g', 'fat_g'].reduce((acc, key) => {
    const value = Number(body[key]);
    acc[key] = Number.isFinite(value) ? Math.round(value) : 0;
    return acc;
  }, {});

  return {
    food_id: null,
    food_name: body.food_name.trim(),
    quantity_g: quantityG,
    ...macros,
  };
};

// The shared Meal Builder sends a Foodbase id plus one of that food's
// supported portions. This resolver is deliberately server-side so browser
// estimates can never become the stored source of truth.
const resolveFoodbaseIngredient = async (supabase, body) => {
  const foodId = body?.food_id;
  const quantity = Number(body?.serving_quantity ?? body?.quantity);
  const unit = body?.serving_unit;
  if (!foodId || !Number.isFinite(quantity) || quantity <= 0 || !unit) {
    const err = new Error('food_id, serving_quantity and serving_unit are required');
    err.status = 400;
    throw err;
  }

  const { data: food, error: foodErr } = await supabase
    .from('food_database')
    .select(FOOD_ENTRY_FOOD_SELECT)
    .eq('id', foodId)
    .maybeSingle();
  if (foodErr) throw foodErr;
  if (!food) {
    const err = new Error('Foodbase food not found');
    err.status = 404;
    throw err;
  }
  const { data: portions, error: portionsErr } = await supabase
    .from('food_portions')
    .select(PORTION_SELECT)
    .eq('food_id', food.id)
    .order('is_default', { ascending: false });
  if (portionsErr) throw portionsErr;

  const scaling = scaleFoodForQuantity({ food, portions: portions || [], quantity, unit });
  if (!scaling.ok || !scaling.macros) {
    const err = new Error(scaling.reason || 'unsupported Foodbase serving');
    err.status = 422;
    throw err;
  }

  const snapshot = {
    food_id: food.id,
    food_name: food.name,
    serving_quantity: quantity,
    serving_unit: scaling.unit,
    quantity_g: scaling.requested_equivalent?.grams ?? null,
    quantity_ml: scaling.requested_equivalent?.ml ?? null,
    macros: scaling.macros,
    source: scaling.source,
    portion_name: scaling.portion_name || null,
  };
  return {
    food_id: food.id,
    food_name: food.name,
    quantity_g: snapshot.quantity_g,
    serving_quantity: quantity,
    serving_unit: scaling.unit,
    calories: scaling.macros.calories,
    protein_g: scaling.macros.protein_g,
    carbs_g: scaling.macros.carbs_g,
    fat_g: scaling.macros.fat_g,
    fiber_g: scaling.macros.fiber_g,
    food_snapshot: snapshot,
  };
};

// Sums all diet_plan_foods rows for a meal and writes the totals back onto
// diet_plan_meals, so the stored total can never drift from its foods.
const recomputeMealTotals = async (supabase, mealId) => {
  const { data: foods, error: foodsErr } = await supabase
    .from('diet_plan_foods')
    .select('calories, protein_g, carbs_g, fat_g, fiber_g')
    .eq('meal_id', mealId);
  if (foodsErr) throw foodsErr;

  const totals = (foods || []).reduce((acc, food) => {
    acc.calories += Number(food.calories) || 0;
    acc.protein_g += Number(food.protein_g) || 0;
    acc.carbs_g += Number(food.carbs_g) || 0;
    acc.fat_g += Number(food.fat_g) || 0;
    acc.fiber_g += Number(food.fiber_g) || 0;
    return acc;
  }, { calories: 0, protein_g: 0, carbs_g: 0, fat_g: 0, fiber_g: 0 });

  const { error: updateErr } = await supabase
    .from('diet_plan_meals')
    .update(totals)
    .eq('id', mealId);
  if (updateErr) throw updateErr;

  return totals;
};

const insertTemplateDays = async (supabase, templateId, days) => {
  if (!days?.length) return;
  for (const day of days) {
    const { data: dayRow, error: dayErr } = await supabase
      .from('diet_plan_days')
      .insert({
        template_id: templateId,
        day_number: day.day_number,
        calories_target: day.calories_target,
        protein_g: day.protein_g,
        carbs_g: day.carbs_g,
        fat_g: day.fat_g,
        notes: day.notes,
      })
      .select()
      .single();
    if (dayErr || !dayRow) throw dayErr || new Error(`Failed to insert day ${day.day_number}`);

    if (day.meals?.length) {
      for (const meal of day.meals) {
        const { data: mealRow, error: mealErr } = await supabase
          .from('diet_plan_meals')
          .insert({
            day_id: dayRow.id,
            meal_name: meal.meal_name,
            meal_order: meal.meal_order || 0,
            // Existing macro-only templates retain their values. Foodbase meals
            // are overwritten below from server-resolved ingredient snapshots.
            calories: meal.calories || 0,
            protein_g: meal.protein_g || 0,
            carbs_g: meal.carbs_g || 0,
            fat_g: meal.fat_g || 0,
            fiber_g: meal.fiber_g || 0,
            meal_type: meal.meal_type || null,
            preparation_instructions: meal.preparation_instructions || null,
            tags: Array.isArray(meal.tags) ? meal.tags : [],
            photo_url: meal.photo_url || null,
            notes: meal.notes,
          })
          .select()
          .single();
        if (mealErr || !mealRow) throw mealErr || new Error(`Failed to insert meal ${meal.meal_name}`);

        if (meal.foods?.length) {
          const resolvedFoods = await Promise.all(meal.foods.map(async (food) =>
            food.food_id ? resolveFoodbaseIngredient(supabase, food) : food
          ));
          const { error: foodsError } = await supabase.from('diet_plan_foods').insert(resolvedFoods.map(f => ({
            meal_id: mealRow.id, food_id: f.food_id || null, food_name: f.food_name,
            quantity_g: f.quantity_g ?? 0, serving_quantity: f.serving_quantity || null,
            serving_unit: f.serving_unit || null, calories: f.calories || 0,
            protein_g: f.protein_g || 0, carbs_g: f.carbs_g || 0, fat_g: f.fat_g || 0,
            fiber_g: f.fiber_g || 0, food_snapshot: f.food_snapshot || null,
          })));
          if (foodsError) throw foodsError;
          await recomputeMealTotals(supabase, mealRow.id);
        }
      }
    }
  }
};

const insertAssignedDays = async (supabase, assignedPlanId, days) => {
  if (!days?.length) return;
  for (const day of days) {
    const { data: dayRow } = await supabase
      .from('assigned_diet_days')
      .insert({
        assigned_plan_id: assignedPlanId,
        day_number: day.day_number,
        calories_target: day.calories_target,
        protein_g: day.protein_g,
        carbs_g: day.carbs_g,
        fat_g: day.fat_g,
        notes: day.notes,
      })
      .select()
      .single();

    if (day.meals?.length) {
      for (const meal of day.meals) {
        const { data: mealRow } = await supabase
          .from('assigned_diet_meals')
          .insert({
            assigned_day_id: dayRow.id,
            meal_name: meal.meal_name,
            meal_order: meal.meal_order || 0,
            calories: meal.calories || 0,
            protein_g: meal.protein_g || 0,
            carbs_g: meal.carbs_g || 0,
            fat_g: meal.fat_g || 0,
            fiber_g: meal.fiber_g || 0,
            meal_type: meal.meal_type || null,
            preparation_instructions: meal.preparation_instructions || null,
            tags: Array.isArray(meal.tags) ? meal.tags : [],
            photo_url: meal.photo_url || null,
            notes: meal.notes,
          })
          .select()
          .single();

        if (meal.foods?.length) {
          const { error: foodsError } = await supabase.from('assigned_diet_foods').insert(meal.foods.map(f => ({
            assigned_meal_id: mealRow.id, food_id: f.food_id || null, food_name: f.food_name,
            quantity_g: f.quantity_g ?? 0, serving_quantity: f.serving_quantity || null,
            serving_unit: f.serving_unit || null, calories: f.calories || 0,
            protein_g: f.protein_g || 0, carbs_g: f.carbs_g || 0, fat_g: f.fat_g || 0,
            fiber_g: f.fiber_g || 0, food_snapshot: f.food_snapshot || null,
          })));
          if (foodsError) throw foodsError;
        }
      }
    }
  }
};

const fetchFullTemplate = async (supabase, templateId) => {
  const { data: template } = await supabase
    .from('diet_plan_templates')
    .select('*')
    .eq('id', templateId)
    .single();

  if (!template) return null;

  const { data: days } = await supabase
    .from('diet_plan_days')
    .select('*')
    .eq('template_id', templateId)
    .order('day_number');

  for (const day of days || []) {
    const { data: meals } = await supabase
      .from('diet_plan_meals')
      .select('*')
      .eq('day_id', day.id)
      .order('meal_order');

    for (const meal of meals || []) {
      const { data: foods } = await supabase
        .from('diet_plan_foods')
        .select('*')
        .eq('meal_id', meal.id);
      meal.foods = foods || [];
    }
    day.meals = meals || [];
  }

  template.days = days || [];
  return template;
};

const fetchFullAssignedPlan = async (supabase, assignedPlanId) => {
  const { data: plan } = await supabase
    .from('assigned_diet_plans')
    .select('*')
    .eq('id', assignedPlanId)
    .single();

  if (!plan) return null;

  const { data: days } = await supabase
    .from('assigned_diet_days')
    .select('*')
    .eq('assigned_plan_id', assignedPlanId)
    .order('day_number');

  for (const day of days || []) {
    const { data: meals } = await supabase
      .from('assigned_diet_meals')
      .select('*')
      .eq('assigned_day_id', day.id)
      .order('meal_order');

    for (const meal of meals || []) {
      const { data: foods } = await supabase
        .from('assigned_diet_foods')
        .select('*')
        .eq('assigned_meal_id', meal.id);
      meal.foods = foods || [];
    }
    day.meals = meals || [];
  }

  plan.days = days || [];
  return plan;
};

module.exports = {
  insertTemplateDays,
  insertAssignedDays,
  fetchFullTemplate,
  fetchFullAssignedPlan,
  verifyMealOwnership,
  resolveFoodEntryPayload,
  resolveFoodbaseIngredient,
  recomputeMealTotals,
};
