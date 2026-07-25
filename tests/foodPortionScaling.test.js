const assert = require('node:assert/strict');
const { test } = require('node:test');

const {
  normalizeUnit,
  scaleFoodForQuantity,
} = require('../utils/foodPortionScaling');

const paneer = {
  name: 'Paneer',
  calories_per_serving: 265,
  protein_g: 18,
  carbs_g: 4,
  fat_g: 20,
  fiber_g: 0,
  serving_size: 100,
  serving_unit: 'g',
};

test('100g paneer scales from metric food anchor', () => {
  const result = scaleFoodForQuantity({ food: paneer, quantity: 200, unit: 'g' });

  assert.equal(result.ok, true);
  assert.equal(result.source, 'food_database_metric_anchor');
  assert.equal(result.macros.calories, 530);
  assert.equal(result.macros.protein_g, 36);
});

test('2 roti scales from food-specific piece portion', () => {
  const chapati = {
    name: 'Chapati',
    calories_per_serving: 120,
    protein_g: 3,
    carbs_g: 20,
    fat_g: 3.5,
    fiber_g: 2,
    serving_size: 1,
    serving_unit: 'piece',
  };
  const portions = [{
    portion_name: '1 medium chapati',
    serving_size: 1,
    serving_unit: 'piece',
    grams_equivalent: 40,
    calories: 120,
    protein_g: 3,
    carbs_g: 20,
    fat_g: 3.5,
    fiber_g: 2,
    is_default: true,
  }];

  const result = scaleFoodForQuantity({ food: chapati, portions, quantity: 2, unit: 'pieces' });

  assert.equal(result.ok, true);
  assert.equal(result.source, 'food_specific_portion');
  assert.equal(result.macros.calories, 240);
  assert.equal(result.macros.carbs_g, 40);
});

test('1 katori dal uses food-specific katori portion', () => {
  const dal = {
    name: 'Dal tadka',
    calories_per_serving: 180,
    protein_g: 10,
    carbs_g: 25,
    fat_g: 5,
    fiber_g: 6,
    serving_size: 150,
    serving_unit: 'g',
  };
  const portions = [{
    portion_name: '1 katori dal',
    serving_size: 1,
    serving_unit: 'katori',
    grams_equivalent: 150,
    calories: 180,
    protein_g: 10,
    carbs_g: 25,
    fat_g: 5,
    fiber_g: 6,
    is_default: true,
  }];

  const result = scaleFoodForQuantity({ food: dal, portions, quantity: 1, unit: 'katori' });

  assert.equal(result.ok, true);
  assert.equal(result.source, 'food_specific_portion');
  assert.equal(result.macros.calories, 180);
});

test('250ml milk scales from metric ml anchor', () => {
  const milk = {
    name: 'Milk full cream',
    calories_per_serving: 150,
    protein_g: 8,
    carbs_g: 12,
    fat_g: 8,
    fiber_g: 0,
    serving_size: 250,
    serving_unit: 'ml',
  };

  const result = scaleFoodForQuantity({ food: milk, quantity: 250, unit: 'ml' });

  assert.equal(result.ok, true);
  assert.equal(result.source, 'food_database_metric_anchor');
  assert.equal(result.macros.calories, 150);
});

test('1 scoop whey uses food-specific scoop portion', () => {
  const whey = {
    name: 'Whey protein scoop',
    calories_per_serving: 120,
    protein_g: 24,
    carbs_g: 3,
    fat_g: 1.5,
    fiber_g: 0,
    serving_size: 1,
    serving_unit: 'scoop',
  };
  const portions = [{
    portion_name: '1 scoop whey',
    serving_size: 1,
    serving_unit: 'scoop',
    grams_equivalent: 30,
    calories: 120,
    protein_g: 24,
    carbs_g: 3,
    fat_g: 1.5,
    fiber_g: 0,
    is_default: true,
  }];

  const result = scaleFoodForQuantity({ food: whey, portions, quantity: 1, unit: 'scoop' });

  assert.equal(result.ok, true);
  assert.equal(result.macros.calories, 120);
  assert.equal(result.macros.protein_g, 24);
});

test('4 oz chicken converts to grams and scales from 100g anchor', () => {
  const chicken = {
    name: 'Chicken breast grilled',
    calories_per_serving: 165,
    protein_g: 31,
    carbs_g: 0,
    fat_g: 3.6,
    fiber_g: 0,
    serving_size: 100,
    serving_unit: 'g',
  };

  const result = scaleFoodForQuantity({ food: chicken, quantity: 4, unit: 'oz' });

  assert.equal(result.ok, true);
  assert.equal(result.requested_equivalent.grams, 113.4);
  assert.equal(result.macros.calories, 187);
  assert.equal(result.macros.protein_g, 35.2);
});

test('1 slice pizza uses food-specific slice portion', () => {
  const pizza = {
    name: 'Pizza slice',
    calories_per_serving: 285,
    protein_g: 12,
    carbs_g: 36,
    fat_g: 10,
    fiber_g: 2,
    serving_size: 1,
    serving_unit: 'slice',
  };
  const portions = [{
    portion_name: '1 pizza slice',
    serving_size: 1,
    serving_unit: 'slice',
    grams_equivalent: 110,
    calories: 285,
    protein_g: 12,
    carbs_g: 36,
    fat_g: 10,
    fiber_g: 2,
  }];

  const result = scaleFoodForQuantity({ food: pizza, portions, quantity: 1, unit: 'slice' });

  assert.equal(result.ok, true);
  assert.equal(result.macros.calories, 285);
});

test('unknown unit returns clear unanchored fallback result', () => {
  const result = scaleFoodForQuantity({ food: paneer, quantity: 1, unit: 'ladle' });

  assert.equal(result.ok, false);
  assert.equal(result.reason, 'unsupported_or_unanchored_unit');
  assert.equal(result.macros, null);
});

test('missing food-specific katori falls back to Gymvyn 150g standard', () => {
  const dal = {
    name: 'Simple dal',
    calories_per_serving: 120,
    protein_g: 7,
    carbs_g: 18,
    fat_g: 3,
    fiber_g: 5,
    serving_size: 100,
    serving_unit: 'g',
  };

  const result = scaleFoodForQuantity({ food: dal, portions: [], quantity: 1, unit: 'katori' });

  assert.equal(result.ok, true);
  assert.equal(result.source, 'gymvyn_household_fallback');
  assert.equal(result.macros.calories, 180);
  assert.equal(result.macros.protein_g, 10.5);
});

test('unit normalization handles common variants', () => {
  assert.equal(normalizeUnit('grams'), 'g');
  assert.equal(normalizeUnit('pieces'), 'piece');
  assert.equal(normalizeUnit('tablespoons'), 'tbsp');
});
