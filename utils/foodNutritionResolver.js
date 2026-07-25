'use strict';

const { normalizeUnit, scaleFoodForQuantity } = require('./foodPortionScaling');
const { packagedFoodPortions } = require('./packagedFood');

const FOOD_SELECT = [
  'id',
  'name',
  'normalized_name',
  'calories_per_serving',
  'protein_g',
  'carbs_g',
  'fat_g',
  'fiber_g',
  'serving_size',
  'serving_unit',
  'source',
  'search_priority',
  'popularity_score',
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

const ALIAS_SELECT = 'food_id, alias, normalized_alias';

function normalizeFoodName(value) {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function toNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function positiveNumber(value, fallback = 1) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function clientMacros(item) {
  return {
    calories: toNumber(item?.calories, 0),
    protein_g: toNumber(item?.protein_g ?? item?.proteinG, 0),
    carbs_g: toNumber(item?.carbs_g ?? item?.carbsG, 0),
    fat_g: toNumber(item?.fat_g ?? item?.fatG, 0),
  };
}

function normalizeItem(item = {}) {
  return {
    original: item,
    food_id: item.food_id ?? item.foodId ?? null,
    custom_food_id: item.custom_food_id ?? item.customFoodId ?? null,
    packaged_food_id: item.packaged_food_id ?? item.packagedFoodId ?? null,
    user_id: item.user_id ?? item.userId ?? null,
    food_name: item.food_name ?? item.foodName ?? item.name ?? '',
    quantity: positiveNumber(item.quantity, 1),
    serving_unit: normalizeUnit(item.serving_unit ?? item.servingUnit ?? item.unit ?? 'serving'),
    macros: clientMacros(item),
    confidence: item.confidence ?? null,
  };
}

function isLegacyDefaultServingPayload(item, food) {
  const submittedCalories = Number(item.macros.calories);
  const requestedUnit = normalizeUnit(item.serving_unit || food?.serving_unit);
  const foodServingUnit = normalizeUnit(food?.serving_unit);
  const baseCalories = Number(food?.calories_per_serving) || 0;

  return Number.isFinite(submittedCalories) &&
    item.quantity === 1 &&
    requestedUnit === foodServingUnit &&
    Math.abs(submittedCalories - baseCalories) <= Math.max(5, baseCalories * 0.05);
}

function foodScore(food) {
  const priority = Number(food?.search_priority) || 0;
  const popularity = Number(food?.popularity_score) || 0;
  const source = String(food?.source || '').toLowerCase();
  const sourcePenalty = source.includes('openfoodfacts') ? 100 : 0;
  return priority * 1000 + popularity - sourcePenalty;
}

function uniqueFoods(rows = []) {
  const byId = new Map();
  rows.filter(Boolean).forEach((food) => {
    if (!byId.has(food.id) || foodScore(food) > foodScore(byId.get(food.id))) {
      byId.set(food.id, food);
    }
  });
  return [...byId.values()].sort((a, b) => foodScore(b) - foodScore(a));
}

function isClearlyBest(candidates) {
  if (candidates.length === 0) return false;
  if (candidates.length <= 1) return true;
  const [first, second] = candidates;
  return foodScore(first) >= foodScore(second) + 2000;
}

function fallbackResult(item, reason, warnings = []) {
  return {
    resolved: false,
    food_id: item.food_id || null,
    custom_food_id: item.custom_food_id || null,
    packaged_food_id: item.packaged_food_id || null,
    food_name: item.food_name,
    canonical_food_name: null,
    calories: item.macros.calories,
    protein_g: item.macros.protein_g,
    carbs_g: item.macros.carbs_g,
    fat_g: item.macros.fat_g,
    quantity: item.quantity,
    serving_unit: item.serving_unit,
    confidence: typeof item.confidence === 'number' ? Math.min(item.confidence, 0.45) : 0.35,
    source: 'client_or_ai_estimate',
    reason,
    warnings,
    portion_scaling: {
      ok: false,
      source: 'client_submitted_macros',
      reason,
      macros: null,
    },
  };
}

function resolvedResult(item, food, matchSource, scaling, warnings = []) {
  const confidenceBySource = {
    food_id: 0.98,
    custom_food_id: 0.98,
    packaged_food_id: 0.86,
    canonical_exact: 0.94,
    custom_exact: 0.94,
    alias_exact: 0.9,
    prefix_match: 0.72,
  };
  const fallbackPenalty = scaling.source === 'gymvyn_household_fallback' ? 0.08 : 0;
  const estimatedPenalty = scaling.source === 'food_specific_portion' && scaling.portion?.is_estimated ? 0.04 : 0;
  const confidence = Math.max(0.5, (confidenceBySource[matchSource] || 0.7) - fallbackPenalty - estimatedPenalty);

  return {
    resolved: true,
    food_id: food.__source_type === 'user_custom' || food.__source_type === 'packaged' ? null : food.id,
    custom_food_id: food.__source_type === 'user_custom' ? food.id : null,
    packaged_food_id: food.__source_type === 'packaged' ? food.id : null,
    food_name: food.name,
    canonical_food_name: food.name,
    calories: scaling.macros.calories,
    protein_g: scaling.macros.protein_g,
    carbs_g: scaling.macros.carbs_g,
    fat_g: scaling.macros.fat_g,
    quantity: item.quantity,
    serving_unit: item.serving_unit,
    confidence,
    source: matchSource,
    source_type: food.__source_type || 'canonical',
    reason: null,
    warnings,
    portion_scaling: scaling,
  };
}

function createSupabaseFoodRepository(supabase) {
  async function throwIfError(result) {
    if (result.error) throw result.error;
    return result.data || [];
  }

  return {
    async getFoodById(id) {
      const { data, error } = await supabase
        .from('food_database')
        .select(FOOD_SELECT)
        .eq('id', id)
        .maybeSingle();
      if (error) throw error;
      return data || null;
    },

    async findFoodsByNormalizedName(normalizedName) {
      return throwIfError(await supabase
        .from('food_database')
        .select(FOOD_SELECT)
        .eq('normalized_name', normalizedName)
        .limit(10));
    },

    async findAliasesByNormalizedName(normalizedName) {
      return throwIfError(await supabase
        .from('food_aliases')
        .select(ALIAS_SELECT)
        .eq('normalized_alias', normalizedName)
        .limit(10));
    },

    async findFoodsByNormalizedPrefix(normalizedName) {
      return throwIfError(await supabase
        .from('food_database')
        .select(FOOD_SELECT)
        .ilike('normalized_name', `${normalizedName}%`)
        .limit(10));
    },

    async findAliasesByNormalizedPrefix(normalizedName) {
      return throwIfError(await supabase
        .from('food_aliases')
        .select(ALIAS_SELECT)
        .ilike('normalized_alias', `${normalizedName}%`)
        .limit(10));
    },

    async getFoodsByIds(ids) {
      if (!ids.length) return [];
      return throwIfError(await supabase
        .from('food_database')
        .select(FOOD_SELECT)
        .in('id', ids));
    },

    async getPortions(foodId) {
      return throwIfError(await supabase
        .from('food_portions')
        .select(PORTION_SELECT)
        .eq('food_id', foodId)
        .order('is_default', { ascending: false }));
    },

    async getCustomFoodById(id, userId) {
      if (!id || !userId) return null;
      const { data, error } = await supabase
        .from('user_custom_foods')
        .select('*')
        .eq('id', id)
        .eq('user_id', userId)
        .maybeSingle();
      if (error) throw error;
      return data ? { ...data, source: 'user_custom', __source_type: 'user_custom' } : null;
    },

    async getPackagedFoodById(id) {
      if (!id) return null;
      const { data, error } = await supabase
        .from('packaged_foods')
        .select('*')
        .eq('id', id)
        .neq('quality_status', 'rejected')
        .maybeSingle();
      if (error) throw error;
      return data ? { ...data, source: data.source || 'packaged', __source_type: 'packaged' } : null;
    },

    async findCustomFoodsByNormalizedName(normalizedName, userId) {
      if (!userId) return [];
      const { data, error } = await supabase
        .from('user_custom_foods')
        .select('*')
        .eq('user_id', userId)
        .eq('normalized_name', normalizedName)
        .limit(10);
      if (error) throw error;
      return (data || []).map(row => ({ ...row, source: 'user_custom', __source_type: 'user_custom' }));
    },

    async findCustomFoodsByNormalizedPrefix(normalizedName, userId) {
      if (!userId) return [];
      const { data, error } = await supabase
        .from('user_custom_foods')
        .select('*')
        .eq('user_id', userId)
        .ilike('normalized_name', `${normalizedName}%`)
        .limit(10);
      if (error) throw error;
      return (data || []).map(row => ({ ...row, source: 'user_custom', __source_type: 'user_custom' }));
    },
  };
}

async function foodsForAliases(repository, aliases) {
  const ids = [...new Set((aliases || []).map(row => row.food_id).filter(Boolean))];
  return uniqueFoods(await repository.getFoodsByIds(ids));
}

async function resolveFoodMatch(repository, item) {
  const normalizedName = normalizeFoodName(item.food_name);
  const requestedFoodId = item.packaged_food_id || item.custom_food_id || item.food_id;
  if (requestedFoodId) {
    if (item.packaged_food_id && repository.getPackagedFoodById) {
      const packagedFood = await repository.getPackagedFoodById(item.packaged_food_id);
      if (packagedFood) return { food: packagedFood, source: 'packaged_food_id', warnings: [] };
    }

    if (item.custom_food_id && repository.getCustomFoodById) {
      const customFood = await repository.getCustomFoodById(item.custom_food_id, item.user_id);
      if (customFood) return { food: customFood, source: 'custom_food_id', warnings: [] };
    }

    if (item.food_id) {
      const food = await repository.getFoodById(item.food_id);
      if (food) return { food, source: 'food_id', warnings: [] };
    }

    if (repository.getCustomFoodById) {
      const customFood = await repository.getCustomFoodById(requestedFoodId, item.user_id);
      if (customFood) return { food: customFood, source: 'custom_food_id', warnings: [] };
    }
    return { food: null, source: null, warnings: ['food_id_not_found'] };
  }

  if (!normalizedName) return { food: null, source: null, warnings: ['missing_food_name'] };

  const exactFoods = uniqueFoods(await repository.findFoodsByNormalizedName(normalizedName));
  if (exactFoods.length) return { food: exactFoods[0], source: 'canonical_exact', warnings: [] };

  if (repository.findCustomFoodsByNormalizedName) {
    const exactCustomFoods = uniqueFoods(await repository.findCustomFoodsByNormalizedName(normalizedName, item.user_id));
    if (exactCustomFoods.length) return { food: exactCustomFoods[0], source: 'custom_exact', warnings: [] };
  }

  const exactAliases = await repository.findAliasesByNormalizedName(normalizedName);
  const aliasFoods = await foodsForAliases(repository, exactAliases);
  if (aliasFoods.length === 1 || isClearlyBest(aliasFoods)) {
    return { food: aliasFoods[0], source: 'alias_exact', warnings: [] };
  }
  if (aliasFoods.length > 1) {
    return { food: null, source: null, warnings: ['ambiguous_alias_match'] };
  }

  if (normalizedName.length < 3) {
    return { food: null, source: null, warnings: ['query_too_short_for_prefix_match'] };
  }

  const prefixFoods = uniqueFoods(await repository.findFoodsByNormalizedPrefix(normalizedName));
  const prefixCustomFoods = repository.findCustomFoodsByNormalizedPrefix
    ? await repository.findCustomFoodsByNormalizedPrefix(normalizedName, item.user_id)
    : [];
  const prefixAliases = await repository.findAliasesByNormalizedPrefix(normalizedName);
  const aliasPrefixFoods = await foodsForAliases(repository, prefixAliases);
  const candidates = uniqueFoods([...prefixFoods, ...prefixCustomFoods, ...aliasPrefixFoods]);

  if (candidates.length === 1 || isClearlyBest(candidates)) {
    return { food: candidates[0], source: 'prefix_match', warnings: [] };
  }
  if (candidates.length > 1) {
    return { food: null, source: null, warnings: ['ambiguous_prefix_match'] };
  }

  return { food: null, source: null, warnings: ['no_canonical_or_alias_match'] };
}

async function resolveFoodNutrition(repository, rawItem, options = {}) {
  const item = normalizeItem(rawItem);
  const match = await resolveFoodMatch(repository, item);

  if (!match.food) {
    return fallbackResult(item, match.warnings[0] || 'unresolved_food', match.warnings);
  }

  if (options.preserveLegacyDefaultServingPayload && isLegacyDefaultServingPayload(item, match.food)) {
    return {
      ...fallbackResult(item, 'legacy_default_serving_payload', ['preserved_client_submitted_default_serving']),
      food_id: match.food.__source_type === 'user_custom' || match.food.__source_type === 'packaged' ? null : match.food.id,
      custom_food_id: match.food.__source_type === 'user_custom' ? match.food.id : null,
      packaged_food_id: match.food.__source_type === 'packaged' ? match.food.id : null,
      food_name: match.food.name,
      canonical_food_name: match.food.name,
      source: 'client_submitted_macros',
    };
  }

  const portions = match.food.__source_type === 'user_custom'
    ? customFoodPortions(match.food)
    : match.food.__source_type === 'packaged'
      ? packagedFoodPortions(match.food)
      : await repository.getPortions(match.food.id);
  const scaling = scaleFoodForQuantity({
    food: match.food,
    portions,
    quantity: item.quantity,
    unit: item.serving_unit,
  });

  if (!scaling.ok || !scaling.macros) {
    return {
      ...fallbackResult(item, scaling.reason || 'portion_scaling_failed', [
        ...match.warnings,
        scaling.reason || 'portion_scaling_failed',
      ]),
      food_id: match.food.__source_type === 'packaged' || match.food.__source_type === 'user_custom' ? null : match.food.id,
      custom_food_id: match.food.__source_type === 'user_custom' ? match.food.id : null,
      packaged_food_id: match.food.__source_type === 'packaged' ? match.food.id : null,
      canonical_food_name: match.food.name,
      portion_scaling: scaling,
    };
  }

  return resolvedResult(item, match.food, match.source, scaling, match.warnings);
}

function customFoodPortions(food) {
  const portion = {
    portion_name: food.serving_description || `${food.serving_size || 1} ${food.serving_unit || 'serving'}`,
    serving_size: food.serving_size || 1,
    serving_unit: food.serving_unit || 'serving',
    grams_equivalent: food.grams_equivalent ?? null,
    ml_equivalent: food.ml_equivalent ?? null,
    calories: food.calories_per_serving,
    protein_g: food.protein_g,
    carbs_g: food.carbs_g,
    fat_g: food.fat_g,
    fiber_g: food.fiber_g,
    is_default: true,
    is_estimated: false,
    portion_note: food.notes || null,
  };
  return [portion];
}

function createSupabaseResolver(supabase) {
  const repository = createSupabaseFoodRepository(supabase);
  return {
    resolveFoodNutrition: (item, options) => resolveFoodNutrition(repository, item, options),
    resolveFoodItems: (items, options) => resolveFoodItems(repository, items, options),
  };
}

async function resolveFoodItems(repository, items, options = {}) {
  const resolved = [];
  for (const item of items || []) {
    resolved.push(await resolveFoodNutrition(repository, item, options));
  }
  return resolved;
}

async function resolveFoodNutritionWithSupabase(supabase, item, options = {}) {
  return resolveFoodNutrition(createSupabaseFoodRepository(supabase), item, options);
}

async function resolveFoodItemsWithSupabase(supabase, items, options = {}) {
  return resolveFoodItems(createSupabaseFoodRepository(supabase), items, options);
}

module.exports = {
  createSupabaseFoodRepository,
  createSupabaseResolver,
  normalizeFoodName,
  normalizeItem,
  resolveFoodItems,
  resolveFoodItemsWithSupabase,
  resolveFoodNutrition,
  resolveFoodNutritionWithSupabase,
  customFoodPortions,
};
