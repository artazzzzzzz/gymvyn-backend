const { callDeepSeek } = require('../clients/deepseek');
const { calcDeepSeekCost } = require('../costs');
const { logAIRequest } = require('../logger');

function buildPrompt({ goal, dietaryPreferences, days, mealTypes, calorieGoal, proteinGoal, carbsGoal, fatGoal }) {
  const targets = [
    calorieGoal ? `${calorieGoal} kcal/day` : null,
    proteinGoal ? `${proteinGoal}g protein` : null,
    carbsGoal ? `${carbsGoal}g carbs` : null,
    fatGoal ? `${fatGoal}g fat` : null,
  ].filter(Boolean).join(', ');

  return {
    system: `You are a nutrition coach building structured multi-day meal plans for a fitness trainer's client. Output ONLY valid JSON, no prose, no markdown fences.`,
    user: `Generate a ${days}-day meal plan for a client whose goal is ${goal}.

${targets ? `Daily targets to hit as closely as possible: ${targets}.` : 'No specific macro targets provided — use sensible defaults for the stated goal.'}
Meals per day: ${mealTypes.join(', ')}.
${dietaryPreferences ? `Dietary preferences/restrictions: ${dietaryPreferences}` : ''}

Return ONLY a JSON object with this exact structure — no markdown, no explanation:
{
  "name": "Plan name (short, specific)",
  "description": "One sentence describing the plan",
  "days": [
    {
      "day": 1,
      "meals": [
        {
          "meal_type": "breakfast|lunch|dinner|snack",
          "food_name": "Food name",
          "quantity": <number>,
          "unit": "piece|katori|cup|gram|ml|tbsp|...",
          "protein_g": <number>,
          "carbs_g": <number>,
          "fat_g": <number>,
          "calories": <number>
        }
      ]
    }
  ]
}

Rules:
- ${days} days total
- One entry per meal_type per day (${mealTypes.join(', ')})
- Realistic portion sizes and macros; calories should roughly equal 4*protein_g + 4*carbs_g + 9*fat_g
- Vary food choices across days while respecting any dietary preferences/restrictions`,
  };
}

async function generateDietPlan({
  trainerId, goal, dietaryPreferences, days, mealTypes,
  calorieGoal, proteinGoal, carbsGoal, fatGoal,
}) {
  const startedAt = Date.now();
  try {
    const { system, user } = buildPrompt({
      goal, dietaryPreferences, days, mealTypes, calorieGoal, proteinGoal, carbsGoal, fatGoal,
    });

    const { text, usage } = await callDeepSeek({
      system,
      user,
      responseFormat: { type: 'json_object' },
    });

    let parsed;
    try {
      parsed = JSON.parse(text.replace(/```json|```/g, '').trim());
    } catch {
      throw new Error('DeepSeek returned invalid JSON');
    }

    if (!parsed.days || !Array.isArray(parsed.days)) {
      throw new Error('Invalid plan structure from AI');
    }

    const costUsd = calcDeepSeekCost({ inputTokens: usage.inputTokens, outputTokens: usage.outputTokens });
    await logAIRequest({
      userId: trainerId,
      feature: 'diet_plan_generation',
      provider: 'deepseek',
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      costUsd,
      success: true,
      durationMs: Date.now() - startedAt,
    });

    return parsed;
  } catch (err) {
    await logAIRequest({
      userId: trainerId,
      feature: 'diet_plan_generation',
      provider: 'deepseek',
      success: false,
      errorMessage: err.message || String(err),
      durationMs: Date.now() - startedAt,
    });
    throw err;
  }
}

module.exports = { generateDietPlan };
