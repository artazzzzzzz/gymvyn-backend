const { callGeminiVision } = require('../clients/gemini');
const { calcGeminiCost } = require('../costs');
const { logAIRequest } = require('../logger');
const { normalizeImage } = require('../utils/imageNormalize');
const { hashImage } = require('../utils/imageHash');
const { getCachedVisionResult, setCachedVisionResult } = require('../utils/visionCache');

function inferMealType() {
  const h = new Date().getHours();
  if (h >= 5  && h < 11) return 'breakfast';
  if (h >= 11 && h < 16) return 'lunch';
  if (h >= 16 && h < 19) return 'snack';
  if (h >= 19 && h < 23) return 'dinner';
  return 'snack';
}

function recomputeCalories(item) {
  const computed = 4 * (item.protein_g || 0) + 4 * (item.carbs_g || 0) + 9 * (item.fat_g || 0);
  const reported = item.calories || 0;
  if (reported === 0) return Math.round(computed);
  const deviation = Math.abs(computed - reported) / reported;
  return deviation > 0.15 ? Math.round(computed) : reported;
}

function validateAndFixItems(items) {
  if (!Array.isArray(items)) throw new Error('Gemini returned non-array items');
  return items.map(item => {
    const required = ['food_name', 'quantity', 'unit', 'calories', 'protein_g', 'carbs_g', 'fat_g', 'confidence'];
    for (const field of required) {
      if (item[field] === undefined || item[field] === null) {
        throw new Error(`Item missing field: ${field}`);
      }
    }
    return { ...item, calories: recomputeCalories(item) };
  });
}

async function parseFoodPhotos({ userId, images }) {
  if (!Array.isArray(images) || images.length < 1 || images.length > 3) {
    throw Object.assign(new Error('Provide 1 to 3 images'), { code: 'INVALID_IMAGE_COUNT' });
  }

  const startedAt = Date.now();

  // Step 1: Normalize all images and check cache
  const normalized = await Promise.all(
    images.map(async ({ buffer, mimeType }) => normalizeImage(buffer, mimeType))
  );

  const hashes = normalized.map(n => hashImage(n.buffer));
  const cacheResults = await Promise.all(hashes.map(h => getCachedVisionResult(h)));

  const missedIndices = cacheResults
    .map((result, i) => (result === null ? i : null))
    .filter(i => i !== null);

  const allCached = missedIndices.length === 0;

  // Step 2: All cached — merge and return for free
  if (allCached) {
    const allItems = cacheResults.flatMap(r => (Array.isArray(r) ? r : r?.items || []));
    const totals = computeTotals(allItems);

    await logAIRequest({
      userId,
      feature: 'food_vision',
      provider: 'gemini',
      imageCount: images.length,
      inputTokens: 0,
      outputTokens: 0,
      costUsd: 0,
      success: true,
      errorMessage: 'cache_hit_all',
      durationMs: Date.now() - startedAt,
    });

    return {
      items: allItems,
      totals,
      inferred_meal_type: inferMealType(),
      cacheStats: { hits: images.length, misses: 0, gemini_called: false },
    };
  }

  // Step 3: Call Gemini for missed images only
  const missedNormalized = missedIndices.map(i => normalized[i]);
  const base64Images = missedNormalized.map(n => n.buffer.toString('base64'));
  const N = missedIndices.length;

  const promptText = `I'm sending ${N} photo${N > 1 ? 's' : ''} of a meal. Identify all distinct food items. If the same item appears in multiple photos, list it only ONCE.\n\nReturn JSON in this exact shape:\n{\n  "items": [\n    {\n      "food_name": "...",\n      "quantity": <number>,\n      "unit": "piece|katori|cup|gram|ml|...",\n      "calories": <number>,\n      "protein_g": <number>,\n      "carbs_g": <number>,\n      "fat_g": <number>,\n      "confidence": <0.0 to 1.0>,\n      "source_image_index": <0 to ${N - 1}>\n    }\n  ]\n}`;

  const systemInstruction = `You analyze food photos for an Indian fitness app. Users photograph meals — often multi-item Indian thalis, but also Western/continental foods. Identify each food item, estimate portion size based on visual cues (plate size, utensil scale, common serving norms), and provide macros using realistic values. Indian home cooking has less oil than restaurant/dhaba versions — assume home unless the photo clearly shows restaurant context (banana leaf, dhaba steel thali with curries swimming in oil, etc). When portion estimation is uncertain, set confidence below 0.6. Output ONLY valid JSON, no prose.`;

  const geminiStart = Date.now();
  let geminiResult;
  try {
    geminiResult = await callGeminiVision({
      images: base64Images,
      prompt: `${systemInstruction}\n\n${promptText}`,
    });
  } catch (err) {
    await logAIRequest({
      userId,
      feature: 'food_vision',
      provider: 'gemini',
      imageCount: N,
      success: false,
      errorMessage: err.message,
      durationMs: Date.now() - geminiStart,
    });
    throw err;
  }

  const rawItems = validateAndFixItems(geminiResult.json?.items || []);
  const { inputTokens, outputTokens } = geminiResult.usage;
  const cost = calcGeminiCost({ inputTokens, outputTokens });

  await logAIRequest({
    userId,
    feature: 'food_vision',
    provider: 'gemini',
    imageCount: N,
    inputTokens,
    outputTokens,
    costUsd: cost,
    success: true,
    durationMs: Date.now() - geminiStart,
  });

  // Step 4: Cache new items per source image
  const itemsBySourceIndex = {};
  for (const item of rawItems) {
    const idx = item.source_image_index ?? 0;
    if (!itemsBySourceIndex[idx]) itemsBySourceIndex[idx] = [];
    itemsBySourceIndex[idx].push(item);
  }

  await Promise.all(
    missedIndices.map(async (originalIdx, missedIdx) => {
      const items = itemsBySourceIndex[missedIdx] || [];
      if (items.length > 0) {
        await setCachedVisionResult(hashes[originalIdx], items);
      }
    })
  );

  // Step 5: Merge cached + new items
  const cachedItems = cacheResults
    .map((r, i) => (r !== null ? (Array.isArray(r) ? r : r?.items || []) : null))
    .filter(Boolean)
    .flat();

  const allItems = [...cachedItems, ...rawItems.map(({ source_image_index, ...item }) => item)];
  const totals = computeTotals(allItems);

  return {
    items: allItems,
    totals,
    inferred_meal_type: inferMealType(),
    cacheStats: {
      hits: images.length - missedIndices.length,
      misses: missedIndices.length,
      gemini_called: true,
    },
  };
}

function computeTotals(items) {
  return items.reduce((acc, item) => ({
    calories:  acc.calories  + (item.calories  || 0),
    protein_g: acc.protein_g + (item.protein_g || 0),
    carbs_g:   acc.carbs_g   + (item.carbs_g   || 0),
    fat_g:     acc.fat_g     + (item.fat_g     || 0),
  }), { calories: 0, protein_g: 0, carbs_g: 0, fat_g: 0 });
}

module.exports = { parseFoodPhotos };
