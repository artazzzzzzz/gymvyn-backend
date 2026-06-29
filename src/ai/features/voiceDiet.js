const { transcribeAudio } = require('../clients/deepgram');
const { callDeepSeek } = require('../clients/deepseek');
const { calcDeepgramCost, calcDeepSeekCost } = require('../costs');
const { logAIRequest } = require('../logger');

function buildPrompt(transcript) {
  const now = new Date();
  const hh = String(now.getHours()).padStart(2, '0');
  const mm = String(now.getMinutes()).padStart(2, '0');
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Kolkata';

  return {
    system: `You parse spoken food log entries into structured nutrition data for an Indian fitness app. Users mix English and Hindi food names (e.g., 'roti', 'dal makhani', 'paneer bhurji'). Estimate calories and macros using typical Indian home-cooked portion sizes unless the user specifies otherwise. Be realistic — restaurant/dhaba dishes are oilier than home versions. When portion size is ambiguous, assume one standard serving. Output ONLY valid JSON, no prose.`,
    user: `Transcript: "${transcript}"\n\nCurrent time: ${hh}:${mm} (${tz})\n\nReturn JSON in this exact shape:\n{\n  "items": [\n    {\n      "food_name": "...",\n      "quantity": <number>,\n      "unit": "piece|katori|cup|gram|ml|tbsp|...",\n      "calories": <number>,\n      "protein_g": <number>,\n      "carbs_g": <number>,\n      "fat_g": <number>,\n      "confidence": <0.0 to 1.0>\n    }\n  ],\n  "inferred_meal_type": "breakfast|lunch|dinner|snack"\n}\n\nInfer meal_type from current time: breakfast (5am-11am), lunch (11am-4pm), snack (4pm-7pm), dinner (7pm-11pm). If unclear, choose 'snack'.`,
  };
}

function recomputeCalories(item) {
  const computed = 4 * item.protein_g + 4 * item.carbs_g + 9 * item.fat_g;
  const reported = item.calories;
  if (reported === 0) return computed;
  const deviation = Math.abs(computed - reported) / reported;
  return deviation > 0.15 ? Math.round(computed) : reported;
}

function validateItems(items) {
  if (!Array.isArray(items)) throw new Error('LLM returned non-array items');
  return items.map(item => {
    const required = ['food_name', 'quantity', 'unit', 'calories', 'protein_g', 'carbs_g', 'fat_g', 'confidence'];
    for (const field of required) {
      if (item[field] === undefined || item[field] === null) {
        throw new Error(`Item missing field: ${field}`);
      }
    }
    const calories = recomputeCalories(item);
    return { ...item, calories };
  });
}

async function parseVoiceDietLog({ userId, audioBuffer, mimeType }) {
  const startedAt = Date.now();
  let transcript = '';
  let durationSeconds = 0;
  let deepgramLogged = false;

  try {
    // Step 1: Transcribe
    const transcribeStart = Date.now();
    const transcribeResult = await transcribeAudio({ audioBuffer, mimeType, language: 'en-IN' });
    transcript = transcribeResult.transcript;
    durationSeconds = transcribeResult.durationSeconds;

    console.log('[voice-diet] transcript result:', {
      transcript,
      durationSeconds,
      transcriptLength: transcript?.length,
    });

    const deepgramCost = calcDeepgramCost({ audioSeconds: durationSeconds });
    await logAIRequest({
      userId,
      feature: 'voice_diet',
      provider: 'deepgram',
      audioSeconds: durationSeconds,
      costUsd: deepgramCost,
      success: true,
      durationMs: Date.now() - transcribeStart,
    });
    deepgramLogged = true;

    // Step 2: Validate transcript
    if (!transcript || transcript.trim().length < 3) {
      throw { code: 'EMPTY_TRANSCRIPT', message: 'Could not hear anything. Please try again.' };
    }

    // Step 3: Parse with LLM
    const llmStart = Date.now();
    const { system, user } = buildPrompt(transcript.trim());
    const { text, usage } = await callDeepSeek({
      system,
      user,
      responseFormat: { type: 'json_object' },
    });

    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new Error('DeepSeek returned invalid JSON');
    }

    const items = validateItems(parsed.items || []);
    const inferred_meal_type = parsed.inferred_meal_type || 'snack';

    const deepseekCost = calcDeepSeekCost({ inputTokens: usage.inputTokens, outputTokens: usage.outputTokens });
    await logAIRequest({
      userId,
      feature: 'voice_diet',
      provider: 'deepseek',
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      costUsd: deepseekCost,
      success: true,
      durationMs: Date.now() - llmStart,
    });

    const totals = items.reduce((acc, item) => ({
      calories: acc.calories + (item.calories || 0),
      protein_g: acc.protein_g + (item.protein_g || 0),
      carbs_g: acc.carbs_g + (item.carbs_g || 0),
      fat_g: acc.fat_g + (item.fat_g || 0),
    }), { calories: 0, protein_g: 0, carbs_g: 0, fat_g: 0 });

    return { transcript, items, totals, inferred_meal_type };

  } catch (err) {
    if (!deepgramLogged) {
      await logAIRequest({
        userId,
        feature: 'voice_diet',
        provider: 'deepgram',
        success: false,
        errorMessage: err.message || String(err),
        durationMs: Date.now() - startedAt,
      });
    } else {
      await logAIRequest({
        userId,
        feature: 'voice_diet',
        provider: 'deepseek',
        success: false,
        errorMessage: err.message || String(err),
        durationMs: Date.now() - startedAt,
      });
    }
    throw err;
  }
}

module.exports = { parseVoiceDietLog };
