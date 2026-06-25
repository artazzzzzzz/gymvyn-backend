const insertTemplateDays = async (supabase, templateId, days) => {
  if (!days?.length) return;
  for (const day of days) {
    const { data: dayRow } = await supabase
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

    if (day.meals?.length) {
      for (const meal of day.meals) {
        const { data: mealRow } = await supabase
          .from('diet_plan_meals')
          .insert({
            day_id: dayRow.id,
            meal_name: meal.meal_name,
            meal_order: meal.meal_order || 0,
            calories: meal.calories,
            protein_g: meal.protein_g,
            carbs_g: meal.carbs_g,
            fat_g: meal.fat_g,
            notes: meal.notes,
          })
          .select()
          .single();

        if (meal.foods?.length) {
          await supabase.from('diet_plan_foods').insert(
            meal.foods.map(f => ({
              meal_id: mealRow.id,
              food_name: f.food_name,
              quantity_g: f.quantity_g,
              calories: f.calories,
              protein_g: f.protein_g,
              carbs_g: f.carbs_g,
              fat_g: f.fat_g,
            }))
          );
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
            calories: meal.calories,
            protein_g: meal.protein_g,
            carbs_g: meal.carbs_g,
            fat_g: meal.fat_g,
            notes: meal.notes,
          })
          .select()
          .single();

        if (meal.foods?.length) {
          await supabase.from('assigned_diet_foods').insert(
            meal.foods.map(f => ({
              assigned_meal_id: mealRow.id,
              food_name: f.food_name,
              quantity_g: f.quantity_g,
              calories: f.calories,
              protein_g: f.protein_g,
              carbs_g: f.carbs_g,
              fat_g: f.fat_g,
            }))
          );
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
};
