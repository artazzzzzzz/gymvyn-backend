const assert = require('node:assert/strict');
const { test } = require('node:test');

const foodSearchRoutes = require('../foodSearchRoutes');
const {
  decoratePackagedFoodResult,
  decorateFoodResult,
  mergeFoodResults,
  normalizeText,
  rankFoodResult,
} = foodSearchRoutes._test;

function metadata({
  aliases = [],
  quality = [],
  portions = [],
  countryTags = [],
} = {}) {
  const aliasesByFoodId = new Map();
  const qualityByFoodId = new Map();
  const portionsByFoodId = new Map();
  const countryTagsByFoodId = new Map();

  aliases.forEach(row => aliasesByFoodId.set(row.food_id, [...(aliasesByFoodId.get(row.food_id) || []), row]));
  quality.forEach(row => qualityByFoodId.set(row.food_id, [...(qualityByFoodId.get(row.food_id) || []), row]));
  portions.forEach(row => portionsByFoodId.set(row.food_id, [...(portionsByFoodId.get(row.food_id) || []), row]));
  countryTags.forEach(row => countryTagsByFoodId.set(row.food_id, [...(countryTagsByFoodId.get(row.food_id) || []), row]));

  return {
    aliasesByFoodId,
    qualityByFoodId,
    portionsByFoodId,
    countryTagsByFoodId,
  };
}

test('alias exact match ranks canonical food above weaker direct partial matches', () => {
  const chapati = {
    id: 'chapati-id',
    name: 'Chapati',
    normalized_name: 'chapati',
    source: 'curated_phase1',
    search_priority: 100,
    popularity_score: 0.99,
    is_indian: true,
    is_combo: false,
  };
  const proteinRoti = {
    id: 'protein-roti-id',
    name: 'Protein roti wrap',
    normalized_name: 'protein roti wrap',
    source: 'openfoodfacts',
    search_priority: 0,
    popularity_score: 0,
    is_indian: false,
    is_combo: false,
  };

  const chapatiRank = rankFoodResult(chapati, {
    normalizedQuery: normalizeText('roti'),
    aliases: [{ alias: 'roti', normalized_alias: 'roti', alias_type: 'hinglish', priority: 100 }],
    quality: [{ source: 'curated', validation_status: 'estimated', confidence_score: 0.82 }],
    countryTags: [{ country_code: 'IN', popularity_tier: 'core', cuisine: 'indian' }],
  });
  const offRank = rankFoodResult(proteinRoti, {
    normalizedQuery: normalizeText('roti'),
    aliases: [],
    quality: [{ source: 'openfoodfacts', validation_status: 'imported', confidence_score: 0.4 }],
    countryTags: [],
  });

  assert.ok(chapatiRank > offRank);
});

test('decorated results keep legacy fields and add optional default portion data', () => {
  const food = {
    id: 'whey-id',
    name: 'Whey protein scoop',
    calories_per_serving: 120,
    protein_g: 24,
    carbs_g: 3,
    fat_g: 1.5,
    serving_size: 1,
    serving_unit: 'scoop',
    source: 'curated_phase1',
    search_priority: 96,
    popularity_score: 0.95,
  };

  const result = decorateFoodResult(food, metadata({
    aliases: [{ food_id: 'whey-id', alias: 'protein powder', normalized_alias: 'protein powder', alias_type: 'common', priority: 90 }],
    portions: [{ food_id: 'whey-id', portion_name: '1 scoop whey', serving_size: 1, serving_unit: 'scoop', is_default: true }],
  }), normalizeText('protein powder'));

  assert.equal(result.name, 'Whey protein scoop');
  assert.equal(result.calories_per_serving, 120);
  assert.equal(result.source_label, 'Gymvyn');
  assert.equal(result.default_portion.portion_name, '1 scoop whey');
  assert.deepEqual(result.matched_aliases, ['protein powder']);
});

test('mergeFoodResults removes duplicate canonical rows by id and keeps stronger rank', () => {
  const merged = mergeFoodResults(
    [{ id: 'egg-id', name: 'Whole egg boiled', search_rank: 100 }],
    [{ id: 'egg-id', name: 'Whole egg boiled', search_rank: 200 }]
  );

  assert.equal(merged.length, 1);
  assert.equal(merged[0].search_rank, 200);
});

test('packaged food appears in search when quality is acceptable', () => {
  const result = decoratePackagedFoodResult({
    id: 'packaged-lassi',
    barcode: '8901234567890',
    name: 'Amul High Protein Lassi',
    normalized_name: 'amul high protein lassi',
    brand: 'Amul',
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
    source: 'openfoodfacts',
  }, normalizeText('amul high protein lassi'), 'amul high protein lassi');

  assert.equal(result.is_packaged, true);
  assert.equal(result.can_log, true);
  assert.ok(result.search_rank > 0);
});

test('packaged food does not outrank curated generic food for generic query', () => {
  const curatedMilk = {
    id: 'milk-id',
    name: 'Milk full cream',
    normalized_name: 'milk full cream',
    source: 'curated_phase1',
    search_priority: 100,
    popularity_score: 0.95,
    is_indian: true,
    is_combo: false,
  };
  const packagedMilk = decoratePackagedFoodResult({
    id: 'packaged-milk',
    barcode: '1234567890123',
    name: 'Acme Milk Tetra Pack',
    normalized_name: 'acme milk tetra pack',
    brand: 'Acme',
    calories_per_serving: 150,
    protein_g: 8,
    carbs_g: 12,
    fat_g: 8,
    fiber_g: 0,
    serving_size: 250,
    serving_unit: 'ml',
    serving_description: '250 ml',
    ml_equivalent: 250,
    quality_status: 'needs_review',
    confidence_score: 0.62,
    rejection_reasons: [],
    source: 'openfoodfacts',
  }, normalizeText('milk'), 'milk');

  const curatedRank = rankFoodResult(curatedMilk, {
    normalizedQuery: normalizeText('milk'),
    aliases: [],
    quality: [{ source: 'curated', validation_status: 'estimated', confidence_score: 0.86 }],
    countryTags: [{ country_code: 'IN', popularity_tier: 'core', cuisine: 'indian' }],
  });

  assert.ok(curatedRank > packagedMilk.search_rank);
});
