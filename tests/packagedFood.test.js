const assert = require('node:assert/strict');
const { test } = require('node:test');

const {
  normalizeBarcode,
  normalizeOFFProduct,
  toPackagedFoodResponse,
  validatePackagedFood,
} = require('../utils/packagedFood');

function validOFFProduct(overrides = {}) {
  return {
    code: '8901234567890',
    product_name: 'Amul High Protein Lassi',
    brands: 'Amul',
    categories_tags: ['en:dairies', 'en:drinks'],
    countries_tags: ['en:india', 'en:united-states'],
    nutriments: {
      'energy-kcal_100g': 80,
      proteins_100g: 8,
      carbohydrates_100g: 10,
      fat_100g: 1.5,
      fiber_100g: 0,
      sugars_100g: 8,
      sodium_100g: 0.04,
    },
    serving_size: '200 ml',
    ingredients_text: 'Milk, milk solids, sugar, cultures',
    image_front_small_url: 'https://example.test/lassi.jpg',
    ...overrides,
  };
}

test('normalizes barcode to digits only', () => {
  assert.equal(normalizeBarcode(' 890-123 4567890 '), '8901234567890');
});

test('OFF valid response normalizes into packaged food shape', () => {
  const normalized = normalizeOFFProduct(validOFFProduct());

  assert.equal(normalized.barcode, '8901234567890');
  assert.equal(normalized.name, 'Amul High Protein Lassi');
  assert.equal(normalized.brand, 'Amul');
  assert.equal(normalized.serving_size, 200);
  assert.equal(normalized.serving_unit, 'ml');
  assert.equal(normalized.calories_per_serving, 160);
  assert.equal(normalized.protein_g, 16);
  assert.equal(normalized.quality_status, 'verified');
});

test('local packaged food response is frontend-friendly and loggable when quality is acceptable', () => {
  const response = toPackagedFoodResponse({
    id: 'packaged-1',
    barcode: '8901234567890',
    name: 'Amul High Protein Lassi',
    brand: 'Amul',
    source: 'openfoodfacts',
    calories_per_serving: 160,
    protein_g: 16,
    carbs_g: 20,
    fat_g: 3,
    fiber_g: 0,
    serving_size: 200,
    serving_unit: 'ml',
    serving_description: '200 ml',
    ml_equivalent: 200,
    quality_status: 'needs_review',
    confidence_score: 0.62,
    rejection_reasons: [],
  });

  assert.equal(response.packaged_food_id, 'packaged-1');
  assert.equal(response.can_log, true);
  assert.equal(response.can_create_custom_food, false);
  assert.equal(response.default_portion.ml_equivalent, 200);
});

test('OFF invalid response is rejected when calories are missing', () => {
  const normalized = normalizeOFFProduct(validOFFProduct({
    nutriments: {
      proteins_100g: 8,
      carbohydrates_100g: 10,
      fat_100g: 1.5,
    },
  }));

  assert.equal(normalized.quality_status, 'rejected');
  assert.ok(normalized.rejection_reasons.includes('unrealistic_calories_per_serving'));
});

test('broken serving unit is rejected', () => {
  const validation = validatePackagedFood({
    name: 'Protein Bar',
    brand: 'Test',
    category: 'snack',
    serving_size: 1,
    serving_unit: 'portion ( g)',
    serving_description: 'portion ( g)',
    calories_per_serving: 220,
    protein_g: 18,
    carbs_g: 20,
    fat_g: 8,
    fiber_g: 4,
    source: 'openfoodfacts',
  });

  assert.equal(validation.ok, false);
  assert.ok(validation.reasons.includes('invalid_serving_unit'));
});

test('impossible macros are rejected', () => {
  const validation = validatePackagedFood({
    name: 'Impossible Protein Bar',
    brand: 'Test',
    category: 'snack',
    serving_size: 60,
    serving_unit: 'g',
    serving_description: '60 g',
    calories_per_serving: 100,
    protein_g: 30,
    carbs_g: 30,
    fat_g: 10,
    fiber_g: 4,
    source: 'openfoodfacts',
  });

  assert.equal(validation.ok, false);
  assert.ok(validation.reasons.includes('macro_calories_exceed_calories'));
});
