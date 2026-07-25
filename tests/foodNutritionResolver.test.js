const assert = require('node:assert/strict');
const { test } = require('node:test');

const {
  normalizeFoodName,
  resolveFoodNutrition,
} = require('../utils/foodNutritionResolver');

const foods = [
  {
    id: 'paneer',
    name: 'Paneer',
    normalized_name: 'paneer',
    calories_per_serving: 265,
    protein_g: 18,
    carbs_g: 4,
    fat_g: 20,
    fiber_g: 0,
    serving_size: 100,
    serving_unit: 'g',
    source: 'curated',
    search_priority: 90,
    popularity_score: 90,
  },
  {
    id: 'chapati',
    name: 'Chapati',
    normalized_name: 'chapati',
    calories_per_serving: 120,
    protein_g: 3,
    carbs_g: 20,
    fat_g: 3.5,
    fiber_g: 2,
    serving_size: 1,
    serving_unit: 'piece',
    source: 'curated',
    search_priority: 100,
    popularity_score: 100,
  },
  {
    id: 'dal-tadka',
    name: 'Dal tadka',
    normalized_name: 'dal tadka',
    calories_per_serving: 180,
    protein_g: 10,
    carbs_g: 25,
    fat_g: 5,
    fiber_g: 6,
    serving_size: 150,
    serving_unit: 'g',
    source: 'curated',
    search_priority: 95,
    popularity_score: 92,
  },
  {
    id: 'curd',
    name: 'Curd plain',
    normalized_name: 'curd plain',
    calories_per_serving: 90,
    protein_g: 5,
    carbs_g: 7,
    fat_g: 4,
    fiber_g: 0,
    serving_size: 150,
    serving_unit: 'g',
    source: 'curated',
    search_priority: 94,
    popularity_score: 90,
  },
  {
    id: 'pizza-slice',
    name: 'Pizza slice',
    normalized_name: 'pizza slice',
    calories_per_serving: 285,
    protein_g: 12,
    carbs_g: 36,
    fat_g: 10,
    fiber_g: 2,
    serving_size: 1,
    serving_unit: 'slice',
    source: 'curated',
    search_priority: 70,
    popularity_score: 80,
  },
  {
    id: 'chicken-breast',
    name: 'Chicken breast grilled',
    normalized_name: 'chicken breast grilled',
    calories_per_serving: 165,
    protein_g: 31,
    carbs_g: 0,
    fat_g: 3.6,
    fiber_g: 0,
    serving_size: 100,
    serving_unit: 'g',
    source: 'curated',
    search_priority: 88,
    popularity_score: 88,
  },
  {
    id: 'chicken-curry',
    name: 'Chicken curry',
    normalized_name: 'chicken curry',
    calories_per_serving: 250,
    protein_g: 25,
    carbs_g: 8,
    fat_g: 14,
    fiber_g: 1,
    serving_size: 150,
    serving_unit: 'g',
    source: 'curated',
    search_priority: 87,
    popularity_score: 84,
  },
  {
    id: 'custom-protein-oats',
    user_id: 'user-1',
    name: 'My Protein Oats',
    normalized_name: 'my protein oats',
    calories_per_serving: 420,
    protein_g: 32,
    carbs_g: 52,
    fat_g: 8,
    fiber_g: 7,
    serving_size: 1,
    serving_unit: 'bowl',
    grams_equivalent: 300,
    source: 'user_custom',
    search_priority: 0,
    popularity_score: 0,
    __source_type: 'user_custom',
  },
  {
    id: 'packaged-lassi',
    name: 'Amul High Protein Lassi',
    normalized_name: 'amul high protein lassi',
    calories_per_serving: 160,
    protein_g: 16,
    carbs_g: 20,
    fat_g: 3,
    fiber_g: 0,
    serving_size: 200,
    serving_unit: 'ml',
    serving_description: '200 ml',
    grams_equivalent: null,
    ml_equivalent: 200,
    source: 'openfoodfacts',
    quality_status: 'needs_review',
    __source_type: 'packaged',
  },
  {
    id: 'packaged-protein-bar',
    name: 'Packaged Protein Bar',
    normalized_name: 'packaged protein bar',
    calories_per_serving: 220,
    protein_g: 20,
    carbs_g: 22,
    fat_g: 7,
    fiber_g: 5,
    serving_size: 60,
    serving_unit: 'g',
    serving_description: '60 g',
    grams_equivalent: 60,
    ml_equivalent: null,
    source: 'openfoodfacts',
    quality_status: 'verified',
    __source_type: 'packaged',
  },
];

const aliases = [
  { food_id: 'chapati', alias: 'roti', normalized_alias: 'roti' },
  { food_id: 'chapati', alias: 'phulka', normalized_alias: 'phulka' },
  { food_id: 'dal-tadka', alias: 'dal', normalized_alias: 'dal' },
  { food_id: 'dal-tadka', alias: 'daal', normalized_alias: 'daal' },
  { food_id: 'curd', alias: 'dahi', normalized_alias: 'dahi' },
  { food_id: 'pizza-slice', alias: 'pizza', normalized_alias: 'pizza' },
  { food_id: 'chicken-breast', alias: 'chicken', normalized_alias: 'chicken' },
];

const portions = {
  chapati: [{
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
  }],
  'dal-tadka': [{
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
  }],
  curd: [{
    portion_name: '1 katori curd',
    serving_size: 1,
    serving_unit: 'katori',
    grams_equivalent: 150,
    calories: 90,
    protein_g: 5,
    carbs_g: 7,
    fat_g: 4,
    fiber_g: 0,
    is_default: true,
  }],
  'pizza-slice': [{
    portion_name: '1 pizza slice',
    serving_size: 1,
    serving_unit: 'slice',
    grams_equivalent: 110,
    calories: 285,
    protein_g: 12,
    carbs_g: 36,
    fat_g: 10,
    fiber_g: 2,
    is_default: true,
  }],
};

function makeRepository() {
  return {
    async getFoodById(id) {
      return foods.find(food => food.id === id && !food.__source_type) || null;
    },
    async findFoodsByNormalizedName(normalizedName) {
      return foods.filter(food => !food.__source_type && food.normalized_name === normalizedName);
    },
    async findAliasesByNormalizedName(normalizedName) {
      return aliases.filter(alias => alias.normalized_alias === normalizedName);
    },
    async findFoodsByNormalizedPrefix(normalizedName) {
      return foods.filter(food => !food.__source_type && food.normalized_name.startsWith(normalizedName));
    },
    async findAliasesByNormalizedPrefix(normalizedName) {
      return aliases.filter(alias => alias.normalized_alias.startsWith(normalizedName));
    },
    async getFoodsByIds(ids) {
      return foods.filter(food => !food.__source_type && ids.includes(food.id));
    },
    async getPortions(foodId) {
      return portions[foodId] || [];
    },
    async getCustomFoodById(id, userId) {
      return foods.find(food => food.id === id && food.user_id === userId) || null;
    },
    async getPackagedFoodById(id) {
      return foods.find(food => food.id === id && food.__source_type === 'packaged' && food.quality_status !== 'rejected') || null;
    },
    async findCustomFoodsByNormalizedName(normalizedName, userId) {
      return foods.filter(food => food.__source_type === 'user_custom' && food.user_id === userId && food.normalized_name === normalizedName);
    },
    async findCustomFoodsByNormalizedPrefix(normalizedName, userId) {
      return foods.filter(food => food.__source_type === 'user_custom' && food.user_id === userId && food.normalized_name.startsWith(normalizedName));
    },
  };
}

test('normalizes food names consistently', () => {
  assert.equal(normalizeFoodName('  Dahi & Yogurt!! '), 'dahi and yogurt');
});

test('manual 100g paneer resolves by exact canonical name and scales from metric anchor', async () => {
  const result = await resolveFoodNutrition(makeRepository(), {
    food_name: 'Paneer',
    quantity: 100,
    unit: 'g',
  });

  assert.equal(result.resolved, true);
  assert.equal(result.source, 'canonical_exact');
  assert.equal(result.food_id, 'paneer');
  assert.equal(result.calories, 265);
  assert.equal(result.protein_g, 18);
});

test('manual 2 chapati resolves by canonical name and piece portion', async () => {
  const result = await resolveFoodNutrition(makeRepository(), {
    food_name: 'chapati',
    quantity: 2,
    unit: 'pieces',
  });

  assert.equal(result.resolved, true);
  assert.equal(result.food_id, 'chapati');
  assert.equal(result.calories, 240);
  assert.equal(result.carbs_g, 40);
});

test('packaged food logging scales from serving/ml anchor', async () => {
  const result = await resolveFoodNutrition(makeRepository(), {
    packagedFoodId: 'packaged-lassi',
    food_name: 'Amul High Protein Lassi',
    quantity: 400,
    unit: 'ml',
  });

  assert.equal(result.resolved, true);
  assert.equal(result.source, 'packaged_food_id');
  assert.equal(result.food_id, null);
  assert.equal(result.packaged_food_id, 'packaged-lassi');
  assert.equal(result.calories, 320);
  assert.equal(result.protein_g, 32);
});

test('packaged food logging scales from 100g request when gram anchor exists', async () => {
  const result = await resolveFoodNutrition(makeRepository(), {
    packaged_food_id: 'packaged-protein-bar',
    food_name: 'Packaged Protein Bar',
    quantity: 100,
    unit: 'g',
  });

  assert.equal(result.resolved, true);
  assert.equal(result.packaged_food_id, 'packaged-protein-bar');
  assert.equal(result.calories, 367);
  assert.equal(result.protein_g, 33.3);
});

test('voice item 2 roti resolves through alias to chapati', async () => {
  const result = await resolveFoodNutrition(makeRepository(), {
    food_name: 'roti',
    quantity: 2,
    unit: 'piece',
  });

  assert.equal(result.resolved, true);
  assert.equal(result.source, 'alias_exact');
  assert.equal(result.food_id, 'chapati');
  assert.equal(result.calories, 240);
});

test('voice item 1 katori dal resolves and uses katori portion', async () => {
  const result = await resolveFoodNutrition(makeRepository(), {
    food_name: 'dal',
    quantity: 1,
    unit: 'katori',
  });

  assert.equal(result.resolved, true);
  assert.equal(result.food_id, 'dal-tadka');
  assert.equal(result.calories, 180);
});

test('voice item dahi 1 katori resolves through Hindi alias to curd', async () => {
  const result = await resolveFoodNutrition(makeRepository(), {
    food_name: 'dahi',
    quantity: 1,
    unit: 'katori',
  });

  assert.equal(result.resolved, true);
  assert.equal(result.food_id, 'curd');
  assert.equal(result.calories, 90);
});

test('photo item pizza 1 slice resolves through alias to pizza slice', async () => {
  const result = await resolveFoodNutrition(makeRepository(), {
    food_name: 'pizza',
    quantity: 1,
    unit: 'slice',
  });

  assert.equal(result.resolved, true);
  assert.equal(result.food_id, 'pizza-slice');
  assert.equal(result.calories, 285);
});

test('ambiguous prefix food does not resolve dangerously', async () => {
  const result = await resolveFoodNutrition(makeRepository(), {
    food_name: 'chick',
    quantity: 4,
    unit: 'oz',
    calories: 250,
    protein_g: 25,
    carbs_g: 8,
    fat_g: 14,
  });

  assert.equal(result.resolved, false);
  assert.equal(result.reason, 'ambiguous_prefix_match');
  assert.equal(result.calories, 250);
});

test('AI item 4 oz chicken breast resolves safely and converts oz to grams', async () => {
  const result = await resolveFoodNutrition(makeRepository(), {
    food_name: 'chicken',
    quantity: 4,
    unit: 'oz',
  });

  assert.equal(result.resolved, true);
  assert.equal(result.source, 'alias_exact');
  assert.equal(result.food_id, 'chicken-breast');
  assert.equal(result.calories, 187);
  assert.equal(result.protein_g, 35.2);
});

test('unresolved food falls back to supplied AI macros', async () => {
  const result = await resolveFoodNutrition(makeRepository(), {
    food_name: 'mystery curry',
    quantity: 1,
    unit: 'bowl',
    calories: 333,
    protein_g: 9,
    carbs_g: 41,
    fat_g: 12,
  });

  assert.equal(result.resolved, false);
  assert.equal(result.source, 'client_or_ai_estimate');
  assert.equal(result.calories, 333);
});

test('existing quick-add default serving payload remains compatible', async () => {
  const result = await resolveFoodNutrition(makeRepository(), {
    food_id: 'paneer',
    food_name: 'Paneer',
    quantity: 1,
    unit: 'g',
    calories: 265,
    protein_g: 18,
    carbs_g: 4,
    fat_g: 20,
  }, { preserveLegacyDefaultServingPayload: true });

  assert.equal(result.resolved, false);
  assert.equal(result.source, 'client_submitted_macros');
  assert.equal(result.reason, 'legacy_default_serving_payload');
  assert.equal(result.calories, 265);
});

test('custom food id resolves only for the owning user and does not map to canonical food_id', async () => {
  const result = await resolveFoodNutrition(makeRepository(), {
    food_id: 'custom-protein-oats',
    user_id: 'user-1',
    food_name: 'My Protein Oats',
    quantity: 1,
    unit: 'bowl',
  });

  assert.equal(result.resolved, true);
  assert.equal(result.source, 'custom_food_id');
  assert.equal(result.source_type, 'user_custom');
  assert.equal(result.food_id, null);
  assert.equal(result.custom_food_id, 'custom-protein-oats');
  assert.equal(result.calories, 420);
});
