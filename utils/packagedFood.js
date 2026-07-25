'use strict';

const LOW_CALORIE_TERMS = [
  'black coffee',
  'green tea',
  'tea',
  'water',
  'sparkling water',
  'soda water',
  'diet soda',
  'zero sugar',
  'zero calorie',
  'cucumber',
  'herb',
  'herbs',
  'spice',
  'spices',
  'seasoning',
];

const NON_FOOD_TERMS = [
  'toothpaste',
  'soap',
  'shampoo',
  'detergent',
  'cosmetic',
  'cream',
  'lotion',
  'cleaner',
  'pet food',
  'dog food',
  'cat food',
];

const ALCOHOL_TERMS = [
  'beer',
  'wine',
  'vodka',
  'whisky',
  'whiskey',
  'rum',
  'gin',
  'liqueur',
  'alcohol',
];

const SUPPLEMENT_TERMS = [
  'creatine',
  'pre workout',
  'pre-workout',
  'bcaa',
  'multivitamin',
  'capsule',
  'tablet',
  'fat burner',
  'mass gainer',
];

function normalizeText(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function normalizeBarcode(value) {
  return String(value || '').replace(/\D/g, '').slice(0, 80);
}

function toNumber(value, fallback = null) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function round(value, decimals = 1) {
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  const factor = 10 ** decimals;
  return Math.round((number + Number.EPSILON) * factor) / factor;
}

function normalizeList(value) {
  if (Array.isArray(value)) {
    return value.map(item => String(item || '').replace(/^[a-z]{2}:/i, '').trim()).filter(Boolean);
  }
  return String(value || '')
    .split(',')
    .map(item => item.trim())
    .filter(Boolean);
}

function parseServingSize(value) {
  const text = String(value || '').trim();
  if (!text) return { size: 100, unit: 'g', description: '100g', usedFallback: true };

  const match = text.match(/([\d]+(?:[.,]\d+)?)\s*([a-zA-Z]+)/);
  if (!match) return { size: null, unit: null, description: text, usedFallback: false };

  const size = Number(match[1].replace(',', '.'));
  const rawUnit = match[2].toLowerCase();
  const unit = rawUnit === 'gram' || rawUnit === 'grams' || rawUnit === 'gm' || rawUnit === 'gms'
    ? 'g'
    : rawUnit === 'millilitre' || rawUnit === 'milliliter' || rawUnit === 'millilitres' || rawUnit === 'milliliters'
      ? 'ml'
      : rawUnit;

  return {
    size: Number.isFinite(size) && size > 0 ? size : null,
    unit,
    description: text,
    usedFallback: false,
  };
}

function isBrokenServingUnit(unit) {
  const normalized = String(unit || '').trim().toLowerCase();
  if (!normalized) return true;
  if (/\(\s*g\s*\)/i.test(normalized)) return true;
  if (/[|/~]/.test(normalized)) return true;
  if (/^(portion|pack|meal|box|serving|packets?)\b.*\(\s*g\s*\)/i.test(normalized)) return true;
  return false;
}

function hasMeaningfulName(name) {
  const normalized = normalizeText(name);
  if (!normalized || normalized === 'unknown food') return false;
  if (normalized.length < 2) return false;
  if (/^\d+$/.test(normalized)) return false;
  return true;
}

function isLowCalorieException(food) {
  const text = normalizeText(`${food.name} ${food.category} ${food.serving_description}`);
  return LOW_CALORIE_TERMS.some(term => text.includes(term));
}

function categoryFromOFF(product) {
  const categories = normalizeText((product.categories_tags || []).join(' '));
  const name = normalizeText([
    product.product_name_en,
    product.product_name,
    product.generic_name_en,
    product.generic_name,
  ].filter(Boolean).join(' '));

  if (categories.includes('beverage') || categories.includes('drink') || categories.includes('juice') || name.includes('drink')) return 'drink';
  if (categories.includes('dair') || categories.includes('milk') || categories.includes('cheese') || categories.includes('yogurt')) return 'dairy';
  if (categories.includes('snack') || categories.includes('chips') || categories.includes('biscuit') || categories.includes('namkeen')) return 'snack';
  if (categories.includes('cereal') || categories.includes('grain') || categories.includes('bread') || categories.includes('oat')) return 'grain';
  if (categories.includes('protein') || name.includes('protein powder') || name.includes('whey')) return 'protein';
  if (categories.includes('dessert') || categories.includes('sweet') || categories.includes('chocolate')) return 'dessert';
  return 'packaged';
}

function productText(food) {
  return normalizeText([
    food.name,
    food.brand,
    food.category,
    food.ingredients,
    ...(food.countries || []),
  ].filter(Boolean).join(' '));
}

function validatePackagedFood(food) {
  const reasons = [];
  const calories = toNumber(food.calories_per_serving);
  const protein = toNumber(food.protein_g);
  const carbs = toNumber(food.carbs_g);
  const fat = toNumber(food.fat_g);
  const fiber = toNumber(food.fiber_g, 0);
  const servingSize = toNumber(food.serving_size);
  const macroCalories = ((protein || 0) * 4) + ((carbs || 0) * 4) + ((fat || 0) * 9);
  const text = productText(food);

  if (!hasMeaningfulName(food.name)) reasons.push('missing_or_meaningless_name');
  if (!Number.isFinite(calories) || calories <= 0 || calories > 3000) reasons.push('unrealistic_calories_per_serving');
  if (Number.isFinite(calories) && calories > 0 && calories < 10 && !isLowCalorieException(food)) reasons.push('suspicious_tiny_calories');
  if (!Number.isFinite(servingSize) || servingSize <= 0) reasons.push('invalid_serving_size');
  if (isBrokenServingUnit(food.serving_unit)) reasons.push('invalid_serving_unit');
  if (![protein, carbs, fat, fiber].every(Number.isFinite)) reasons.push('invalid_macros');
  if ([protein, carbs, fat, fiber].some(value => Number.isFinite(value) && value < 0)) reasons.push('negative_macros');
  if (
    Number.isFinite(calories) &&
    calories > 0 &&
    [protein, carbs, fat].every(Number.isFinite) &&
    macroCalories > (calories * 1.35) + 20
  ) {
    reasons.push('macro_calories_exceed_calories');
  }
  if (NON_FOOD_TERMS.some(term => text.includes(term))) reasons.push('likely_non_food_product');
  if (ALCOHOL_TERMS.some(term => text.includes(term))) reasons.push('unsupported_alcohol_product');
  if (SUPPLEMENT_TERMS.some(term => text.includes(term)) && !text.includes('protein powder') && !text.includes('whey')) {
    reasons.push('unsupported_supplement_product');
  }

  const warningReasons = [];
  if (food.used_serving_fallback) warningReasons.push('serving_size_defaulted_to_100g');
  if (!food.ingredients) warningReasons.push('missing_ingredients');
  if (!food.countries?.length) warningReasons.push('missing_countries');

  const qualityStatus = reasons.length ? 'rejected' : warningReasons.length ? 'needs_review' : 'verified';
  const confidenceScore = reasons.length ? 0.1 : warningReasons.length ? 0.62 : 0.82;

  return {
    ok: reasons.length === 0,
    reasons,
    warnings: warningReasons,
    quality_status: qualityStatus,
    confidence_score: confidenceScore,
  };
}

function normalizeOFFProduct(product = {}) {
  const nutriments = product.nutriments || {};
  const calories100g = toNumber(nutriments['energy-kcal_100g'])
    ?? toNumber(nutriments['energy-kcal'])
    ?? (toNumber(nutriments.energy_100g) ? toNumber(nutriments.energy_100g) / 4.184 : null);
  const serving = parseServingSize(product.serving_size || product.serving_quantity);
  const servingSize = serving.size;
  const servingUnit = serving.unit;
  const scale = servingUnit === 'ml' || servingUnit === 'l'
    ? (servingSize || 100) / 100
    : (servingSize || 100) / 100;

  const per100 = {
    calories: calories100g,
    protein: toNumber(nutriments.proteins_100g ?? nutriments.protein_100g, 0),
    carbs: toNumber(nutriments.carbohydrates_100g, 0),
    fat: toNumber(nutriments.fat_100g, 0),
    fiber: toNumber(nutriments.fiber_100g ?? nutriments.fibre_100g, 0),
    sugar: toNumber(nutriments.sugars_100g),
    sodium: toNumber(nutriments.sodium_100g),
    saturatedFat: toNumber(nutriments['saturated-fat_100g']),
  };

  const name = [
    product.product_name_en,
    product.product_name,
    product.generic_name_en,
    product.generic_name,
  ].find(Boolean) || 'Unknown Food';

  const normalized = {
    barcode: normalizeBarcode(product.code || product._id || product.id),
    name: String(name).trim(),
    normalized_name: normalizeText(name),
    brand: product.brands || null,
    category: categoryFromOFF(product),
    image_url: product.image_front_small_url || product.image_front_url || product.image_url || null,
    serving_size: servingSize,
    serving_unit: servingUnit,
    serving_description: serving.description || `${servingSize}${servingUnit}`,
    grams_equivalent: servingUnit === 'g' ? servingSize : null,
    ml_equivalent: servingUnit === 'ml' ? servingSize : null,
    calories_per_serving: round((per100.calories || 0) * scale),
    protein_g: round((per100.protein || 0) * scale),
    carbs_g: round((per100.carbs || 0) * scale),
    fat_g: round((per100.fat || 0) * scale),
    fiber_g: round((per100.fiber || 0) * scale),
    sugar_g: per100.sugar == null ? null : round(per100.sugar * scale),
    sodium_mg: per100.sodium == null ? null : round(per100.sodium * 1000 * scale),
    saturated_fat_g: per100.saturatedFat == null ? null : round(per100.saturatedFat * scale),
    ingredients: product.ingredients_text_en || product.ingredients_text || null,
    allergens: normalizeList(product.allergens_tags || product.allergens),
    countries: normalizeList(product.countries_tags || product.countries),
    source: 'openfoodfacts',
    source_product_id: product._id || product.id || product.code || null,
    source_url: product.url || (product.code ? `https://world.openfoodfacts.org/product/${product.code}` : null),
    used_serving_fallback: serving.usedFallback,
  };

  const validation = validatePackagedFood(normalized);
  return {
    ...normalized,
    quality_status: validation.quality_status,
    confidence_score: validation.confidence_score,
    rejection_reasons: validation.reasons,
    warnings: validation.warnings,
  };
}

function isPackagedFoodLoggable(food) {
  const status = String(food?.quality_status || '').toLowerCase();
  return Boolean(food) && status !== 'rejected' && status !== 'bad' && status !== 'blocked';
}

function toPackagedFoodResponse(food, extra = {}) {
  const rejectionReasons = food?.rejection_reasons || [];
  const warnings = extra.warnings || food?.warnings || [];
  const canLog = isPackagedFoodLoggable(food);

  return {
    id: food.id || null,
    packaged_food_id: food.id || null,
    barcode: food.barcode || null,
    name: food.name,
    brand: food.brand || null,
    source: 'packaged',
    source_label: food.source === 'openfoodfacts' ? 'Open Food Facts' : 'Packaged food',
    source_detail: food.source || 'packaged',
    calories_per_serving: food.calories_per_serving,
    protein_g: food.protein_g,
    carbs_g: food.carbs_g,
    fat_g: food.fat_g,
    fiber_g: food.fiber_g,
    serving_size: food.serving_size,
    serving_unit: food.serving_unit,
    serving_description: food.serving_description,
    grams_equivalent: food.grams_equivalent,
    ml_equivalent: food.ml_equivalent,
    image_url: food.image_url || null,
    quality_status: food.quality_status || 'needs_review',
    confidence_score: food.confidence_score ?? 0.5,
    warnings,
    rejection_reasons: rejectionReasons,
    can_log: canLog,
    can_create_custom_food: !canLog || rejectionReasons.length > 0,
    default_portion: {
      portion_name: food.serving_description || `${food.serving_size} ${food.serving_unit}`,
      serving_size: food.serving_size,
      serving_unit: food.serving_unit,
      grams_equivalent: food.grams_equivalent,
      ml_equivalent: food.ml_equivalent,
      calories: food.calories_per_serving,
      protein_g: food.protein_g,
      carbs_g: food.carbs_g,
      fat_g: food.fat_g,
      fiber_g: food.fiber_g,
      is_default: true,
      is_estimated: String(food.quality_status || '').toLowerCase() !== 'verified',
      portion_note: food.quality_status || null,
    },
    ...extra,
  };
}

function packagedFoodPortions(food) {
  return [{
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
    is_estimated: String(food.quality_status || '').toLowerCase() !== 'verified',
    portion_note: food.quality_status || null,
  }];
}

module.exports = {
  isBrokenServingUnit,
  isPackagedFoodLoggable,
  normalizeBarcode,
  normalizeOFFProduct,
  normalizeText,
  packagedFoodPortions,
  toPackagedFoodResponse,
  validatePackagedFood,
};
