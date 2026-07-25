'use strict';

const GRAM_UNITS = {
  g: 1,
  gram: 1,
  grams: 1,
  kg: 1000,
  oz: 28.35,
  lb: 453.6,
};

const ML_UNITS = {
  ml: 1,
  l: 1000,
};

const UNIT_ALIASES = {
  gm: 'g',
  gms: 'g',
  grams: 'g',
  gram: 'g',
  kilogram: 'kg',
  kilograms: 'kg',
  ounce: 'oz',
  ounces: 'oz',
  pound: 'lb',
  pounds: 'lb',
  litre: 'l',
  liter: 'l',
  litres: 'l',
  liters: 'l',
  katori: 'katori',
  katoris: 'katori',
  bowl: 'bowl',
  bowls: 'bowl',
  plate: 'plate',
  plates: 'plate',
  glass: 'glass',
  glasses: 'glass',
  cup: 'cup',
  cups: 'cup',
  tablespoon: 'tbsp',
  tablespoons: 'tbsp',
  tbsp: 'tbsp',
  teaspoon: 'tsp',
  teaspoons: 'tsp',
  tsp: 'tsp',
  scoop: 'scoop',
  scoops: 'scoop',
  piece: 'piece',
  pieces: 'piece',
  pc: 'piece',
  pcs: 'piece',
  slice: 'slice',
  slices: 'slice',
  roll: 'roll',
  rolls: 'roll',
  wrap: 'wrap',
  wraps: 'wrap',
  serving: 'serving',
  servings: 'serving',
};

const HOUSEHOLD_FALLBACKS = {
  katori: { grams: 150, ml: 150 },
  bowl: { grams: 250, ml: 250 },
  plate: { grams: 300 },
  glass: { ml: 250 },
  cup: { ml: 240 },
  tbsp: { ml: 15, grams: 15 },
  tsp: { ml: 5, grams: 5 },
  scoop: { grams: 30 },
};

const DIRECT_UNITS = new Set([
  'piece',
  'slice',
  'roll',
  'wrap',
  'serving',
]);

const MACRO_KEYS = ['calories', 'protein_g', 'carbs_g', 'fat_g', 'fiber_g'];

function normalizeUnit(unit) {
  const cleaned = String(unit || '')
    .toLowerCase()
    .trim()
    .replace(/\./g, '')
    .replace(/[^a-z]+/g, ' ');
  const compact = cleaned.split(/\s+/).filter(Boolean)[0] || '';
  return UNIT_ALIASES[compact] || compact;
}

function toPositiveNumber(value, fallback = null) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function getFoodMacros(food) {
  return {
    calories: numericValue(food?.calories_per_serving, numericValue(food?.calories, 0)),
    protein_g: numericValue(food?.protein_g, 0),
    carbs_g: numericValue(food?.carbs_g, 0),
    fat_g: numericValue(food?.fat_g, 0),
    fiber_g: numericValue(food?.fiber_g, 0),
  };
}

function getPortionMacros(portion, food) {
  const foodMacros = getFoodMacros(food);
  return {
    calories: numericValue(portion?.calories, foodMacros.calories),
    protein_g: numericValue(portion?.protein_g, foodMacros.protein_g),
    carbs_g: numericValue(portion?.carbs_g, foodMacros.carbs_g),
    fat_g: numericValue(portion?.fat_g, foodMacros.fat_g),
    fiber_g: numericValue(portion?.fiber_g, foodMacros.fiber_g),
  };
}

function numericValue(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function scaleMacros(macros, factor) {
  return {
    calories: Math.round((Number(macros.calories) || 0) * factor),
    protein_g: round((Number(macros.protein_g) || 0) * factor),
    carbs_g: round((Number(macros.carbs_g) || 0) * factor),
    fat_g: round((Number(macros.fat_g) || 0) * factor),
    fiber_g: round((Number(macros.fiber_g) || 0) * factor),
  };
}

function round(value, decimals = 1) {
  const factor = 10 ** decimals;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

function measurementFromUnit(quantity, unit) {
  if (GRAM_UNITS[unit]) return { grams: quantity * GRAM_UNITS[unit] };
  if (ML_UNITS[unit]) return { ml: quantity * ML_UNITS[unit] };
  return null;
}

function equivalentForPortion(portion) {
  const grams = toPositiveNumber(portion?.grams_equivalent);
  const ml = toPositiveNumber(portion?.ml_equivalent);
  if (grams) return { kind: 'grams', amount: grams };
  if (ml) return { kind: 'ml', amount: ml };
  return null;
}

function findPortionByUnit(portions, unit) {
  return (portions || []).find(portion => normalizeUnit(portion.serving_unit) === unit);
}

function findMetricAnchor(portions, kind) {
  const targetUnits = kind === 'ml' ? new Set(['ml', 'l']) : new Set(['g', 'gram', 'kg', 'oz', 'lb']);
  return (portions || []).find(portion => targetUnits.has(normalizeUnit(portion.serving_unit)) && equivalentForPortion(portion)?.kind === (kind === 'ml' ? 'ml' : 'grams'));
}

function baseAnchorFromFood(food, kind) {
  const servingSize = toPositiveNumber(food?.serving_size);
  const servingUnit = normalizeUnit(food?.serving_unit);
  if (!servingSize) return null;

  const measurement = measurementFromUnit(servingSize, servingUnit);
  if (measurement?.grams && kind === 'grams') {
    return { kind: 'grams', amount: measurement.grams, macros: getFoodMacros(food), source: 'food_database_metric_anchor' };
  }
  if (measurement?.ml && kind === 'ml') {
    return { kind: 'ml', amount: measurement.ml, macros: getFoodMacros(food), source: 'food_database_metric_anchor' };
  }
  return null;
}

function portionAnchor(portion, food) {
  const equivalent = equivalentForPortion(portion);
  if (!equivalent) return null;
  return {
    ...equivalent,
    macros: getPortionMacros(portion, food),
    source: 'food_specific_portion',
    portion,
  };
}

function findBestAnchor(food, portions, kind) {
  const metricPortion = findMetricAnchor(portions, kind === 'ml' ? 'ml' : 'grams');
  if (metricPortion) return portionAnchor(metricPortion, food);

  const foodAnchor = baseAnchorFromFood(food, kind);
  if (foodAnchor) return foodAnchor;

  const defaultPortion = (portions || []).find(portion => portion.is_default) || (portions || [])[0];
  const defaultAnchor = portionAnchor(defaultPortion, food);
  if (defaultAnchor?.kind === kind) return defaultAnchor;

  return null;
}

function fallbackEquivalent(unit) {
  const fallback = HOUSEHOLD_FALLBACKS[unit];
  if (!fallback) return null;
  if (fallback.grams) return { kind: 'grams', amount: fallback.grams };
  if (fallback.ml) return { kind: 'ml', amount: fallback.ml };
  return null;
}

function scaleFoodForQuantity({ food, portions = [], quantity = 1, unit }) {
  const normalizedUnit = normalizeUnit(unit || food?.serving_unit || 'serving');
  const safeQuantity = toPositiveNumber(quantity, 1);

  if (!food) {
    return {
      ok: false,
      reason: 'missing_food',
      quantity: safeQuantity,
      unit: normalizedUnit,
      macros: null,
    };
  }

  const exactMeasurement = measurementFromUnit(safeQuantity, normalizedUnit);
  if (exactMeasurement) {
    const kind = exactMeasurement.grams ? 'grams' : 'ml';
    const amount = exactMeasurement.grams || exactMeasurement.ml;
    const anchor = findBestAnchor(food, portions, kind);

    if (!anchor || !toPositiveNumber(anchor.amount)) {
      return {
        ok: false,
        reason: `missing_${kind}_anchor`,
        quantity: safeQuantity,
        unit: normalizedUnit,
        requested_equivalent: exactMeasurement,
        macros: null,
      };
    }

    return {
      ok: true,
      source: anchor.source,
      quantity: safeQuantity,
      unit: normalizedUnit,
      requested_equivalent: exactMeasurement,
      base_equivalent: { [kind]: anchor.amount },
      portion_name: anchor.portion?.portion_name || null,
      macros: scaleMacros(anchor.macros, amount / anchor.amount),
    };
  }

  const portion = findPortionByUnit(portions, normalizedUnit);
  if (portion) {
    const servingSize = toPositiveNumber(portion.serving_size, 1);
    return {
      ok: true,
      source: 'food_specific_portion',
      quantity: safeQuantity,
      unit: normalizedUnit,
      requested_equivalent: scaleEquivalent(equivalentForPortion(portion), safeQuantity / servingSize),
      portion_name: portion.portion_name,
      macros: scaleMacros(getPortionMacros(portion, food), safeQuantity / servingSize),
    };
  }

  if (DIRECT_UNITS.has(normalizedUnit)) {
    const foodUnit = normalizeUnit(food.serving_unit);
    const servingSize = toPositiveNumber(food.serving_size, 1);
    if (foodUnit === normalizedUnit) {
      return {
        ok: true,
        source: 'food_database_same_unit',
        quantity: safeQuantity,
        unit: normalizedUnit,
        macros: scaleMacros(getFoodMacros(food), safeQuantity / servingSize),
      };
    }
  }

  const fallback = fallbackEquivalent(normalizedUnit);
  if (fallback) {
    const anchor = findBestAnchor(food, portions, fallback.kind);
    if (anchor?.amount) {
      return {
        ok: true,
        source: 'gymvyn_household_fallback',
        quantity: safeQuantity,
        unit: normalizedUnit,
        requested_equivalent: { [fallback.kind]: fallback.amount * safeQuantity },
        base_equivalent: { [fallback.kind]: anchor.amount },
        macros: scaleMacros(anchor.macros, (fallback.amount * safeQuantity) / anchor.amount),
      };
    }
  }

  if (normalizedUnit === 'serving') {
    return {
      ok: true,
      source: 'food_database_default_serving',
      quantity: safeQuantity,
      unit: normalizedUnit,
      macros: scaleMacros(getFoodMacros(food), safeQuantity),
    };
  }

  return {
    ok: false,
    reason: 'unsupported_or_unanchored_unit',
    quantity: safeQuantity,
    unit: normalizedUnit,
    macros: null,
  };
}

function scaleEquivalent(equivalent, factor) {
  if (!equivalent) return null;
  return { [equivalent.kind]: round(equivalent.amount * factor, 2) };
}

module.exports = {
  GRAM_UNITS,
  HOUSEHOLD_FALLBACKS,
  ML_UNITS,
  normalizeUnit,
  scaleFoodForQuantity,
};
