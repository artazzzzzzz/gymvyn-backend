#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const DEFAULT_FILE = path.join(__dirname, '..', 'seeds', 'phase1_food_expansion.json');

function sqlString(value) {
  if (value === null || value === undefined) return 'NULL';
  return `'${String(value).replace(/'/g, "''")}'`;
}

function main() {
  const filePath = path.resolve(process.argv[2] || DEFAULT_FILE);
  const seed = JSON.parse(fs.readFileSync(filePath, 'utf8'));

  if (!seed || !Array.isArray(seed.foods)) {
    throw new Error('Expected a seed object with a foods array');
  }

  const jsonLiteral = JSON.stringify(seed).replace(/\$\$/g, '$ $');
  const sourceDetail = seed.source_detail || path.relative(path.join(__dirname, '..'), filePath);

  process.stdout.write(`-- Gymvyn Phase 1 food expansion
-- Generated from ${sourceDetail}
-- Safe to run more than once. Does not delete food_database rows and does not touch food_logs.

WITH seed_document AS (
  SELECT $food_seed$${jsonLiteral}$food_seed$::jsonb AS data
),
seed_foods AS (
  SELECT
    food AS raw_food,
    food->>'name' AS name,
    NULLIF(food->>'name_hindi', '') AS name_hindi,
    food->>'normalized_name' AS normalized_name,
    food->>'category' AS category,
    (food->>'calories_per_serving')::REAL AS calories_per_serving,
    (food->>'protein_g')::REAL AS protein_g,
    (food->>'carbs_g')::REAL AS carbs_g,
    (food->>'fat_g')::REAL AS fat_g,
    COALESCE((food->>'fiber_g')::REAL, 0) AS fiber_g,
    (food->>'serving_size')::REAL AS serving_size,
    food->>'serving_unit' AS serving_unit,
    food->>'serving_description' AS serving_description,
    COALESCE((food->>'is_combo')::BOOLEAN, false) AS is_combo,
    COALESCE((food->>'is_indian')::BOOLEAN, false) AS is_indian,
    COALESCE(food->>'source', 'curated_phase1') AS source,
    COALESCE((food->>'search_priority')::INTEGER, 0) AS search_priority,
    COALESCE((food->>'popularity_score')::REAL, 0) AS popularity_score
  FROM seed_document,
  LATERAL jsonb_array_elements(data->'foods') AS food
),
inserted_foods AS (
  INSERT INTO food_database (
    name, name_hindi, category, calories_per_serving, protein_g, carbs_g,
    fat_g, fiber_g, serving_size, serving_unit, serving_description, is_combo,
    is_indian, source, normalized_name, search_priority, popularity_score
  )
  SELECT
    sf.name, sf.name_hindi, sf.category, sf.calories_per_serving, sf.protein_g, sf.carbs_g,
    sf.fat_g, sf.fiber_g, sf.serving_size, sf.serving_unit, sf.serving_description, sf.is_combo,
    sf.is_indian, sf.source, sf.normalized_name, sf.search_priority, sf.popularity_score
  FROM seed_foods sf
  WHERE NOT EXISTS (
    SELECT 1
    FROM food_database existing
    WHERE COALESCE(
      existing.normalized_name,
      btrim(regexp_replace(lower(replace(existing.name, '&', ' and ')), '[^a-z0-9]+', ' ', 'g'))
    ) = sf.normalized_name
  )
  ON CONFLICT DO NOTHING
  RETURNING id, normalized_name
),
existing_foods AS (
  SELECT DISTINCT ON (sf.normalized_name)
    sf.normalized_name,
    f.id AS food_id
  FROM seed_foods sf
  JOIN food_database f
    ON COALESCE(
      f.normalized_name,
      btrim(regexp_replace(lower(replace(f.name, '&', ' and ')), '[^a-z0-9]+', ' ', 'g'))
    ) = sf.normalized_name
  ORDER BY
    sf.normalized_name,
    (f.source = 'curated_phase1') DESC,
    (f.source = 'openfoodfacts') ASC,
    f.created_at ASC
),
food_map AS (
  SELECT normalized_name, id AS food_id
  FROM inserted_foods
  UNION ALL
  SELECT ef.normalized_name, ef.food_id
  FROM existing_foods ef
  WHERE NOT EXISTS (
    SELECT 1
    FROM inserted_foods inserted
    WHERE inserted.normalized_name = ef.normalized_name
  )
),
updated_existing_foods AS (
  UPDATE food_database f
  SET
    normalized_name = COALESCE(f.normalized_name, sf.normalized_name),
    search_priority = GREATEST(COALESCE(f.search_priority, 0), sf.search_priority),
    popularity_score = GREATEST(COALESCE(f.popularity_score, 0), sf.popularity_score)
  FROM seed_foods sf
  WHERE f.id IN (
    SELECT food_id FROM existing_foods WHERE normalized_name = sf.normalized_name
  )
  RETURNING f.id
),
inserted_aliases AS (
  INSERT INTO food_aliases (food_id, alias, normalized_alias, language, alias_type, priority)
  SELECT
    fm.food_id,
    alias_item->>'alias',
    btrim(regexp_replace(lower(replace(alias_item->>'alias', '&', ' and ')), '[^a-z0-9]+', ' ', 'g')),
    COALESCE(alias_item->>'language', 'en'),
    COALESCE(alias_item->>'alias_type', 'common'),
    COALESCE((alias_item->>'priority')::INTEGER, 0)
  FROM seed_foods sf
  JOIN food_map fm ON fm.normalized_name = sf.normalized_name
  CROSS JOIN LATERAL jsonb_array_elements(COALESCE(sf.raw_food->'aliases', '[]'::jsonb)) AS alias_item
  ON CONFLICT (food_id, normalized_alias) DO NOTHING
  RETURNING id
),
inserted_portions AS (
  INSERT INTO food_portions (
    food_id, portion_name, serving_size, serving_unit, grams_equivalent, ml_equivalent,
    calories, protein_g, carbs_g, fat_g, fiber_g, is_default, is_estimated, portion_note
  )
  SELECT
    fm.food_id,
    portion_item->>'portion_name',
    (portion_item->>'serving_size')::REAL,
    portion_item->>'serving_unit',
    NULLIF(portion_item->>'grams_equivalent', '')::REAL,
    NULLIF(portion_item->>'ml_equivalent', '')::REAL,
    COALESCE((portion_item->>'calories')::REAL, sf.calories_per_serving),
    COALESCE((portion_item->>'protein_g')::REAL, sf.protein_g),
    COALESCE((portion_item->>'carbs_g')::REAL, sf.carbs_g),
    COALESCE((portion_item->>'fat_g')::REAL, sf.fat_g),
    COALESCE((portion_item->>'fiber_g')::REAL, sf.fiber_g),
    CASE
      WHEN COALESCE((portion_item->>'is_default')::BOOLEAN, false)
        AND NOT EXISTS (
          SELECT 1 FROM food_portions existing_default
          WHERE existing_default.food_id = fm.food_id
            AND existing_default.is_default
        )
      THEN true
      ELSE false
    END,
    COALESCE((portion_item->>'is_estimated')::BOOLEAN, true),
    NULLIF(portion_item->>'portion_note', '')
  FROM seed_foods sf
  JOIN food_map fm ON fm.normalized_name = sf.normalized_name
  CROSS JOIN LATERAL jsonb_array_elements(COALESCE(sf.raw_food->'portions', '[]'::jsonb)) AS portion_item
  WHERE NOT EXISTS (
    SELECT 1
    FROM food_portions existing_portion
    WHERE existing_portion.food_id = fm.food_id
      AND lower(existing_portion.portion_name) = lower(portion_item->>'portion_name')
  )
  RETURNING id
),
updated_existing_portions AS (
  UPDATE food_portions existing_portion
  SET
    grams_equivalent = COALESCE(existing_portion.grams_equivalent, NULLIF(portion_item->>'grams_equivalent', '')::REAL),
    ml_equivalent = COALESCE(existing_portion.ml_equivalent, NULLIF(portion_item->>'ml_equivalent', '')::REAL),
    is_estimated = COALESCE((portion_item->>'is_estimated')::BOOLEAN, existing_portion.is_estimated, true),
    portion_note = COALESCE(existing_portion.portion_note, NULLIF(portion_item->>'portion_note', ''))
  FROM seed_foods sf
  JOIN food_map fm ON fm.normalized_name = sf.normalized_name
  CROSS JOIN LATERAL jsonb_array_elements(COALESCE(sf.raw_food->'portions', '[]'::jsonb)) AS portion_item
  WHERE existing_portion.food_id = fm.food_id
    AND lower(existing_portion.portion_name) = lower(portion_item->>'portion_name')
  RETURNING existing_portion.id
),
inserted_country_tags AS (
  INSERT INTO food_country_tags (food_id, country_code, country_name, cuisine, popularity_tier)
  SELECT
    fm.food_id,
    tag_item->>'country_code',
    tag_item->>'country_name',
    NULLIF(tag_item->>'cuisine', ''),
    COALESCE(tag_item->>'popularity_tier', 'common')
  FROM seed_foods sf
  JOIN food_map fm ON fm.normalized_name = sf.normalized_name
  CROSS JOIN LATERAL jsonb_array_elements(COALESCE(sf.raw_food->'country_tags', '[]'::jsonb)) AS tag_item
  ON CONFLICT (food_id, country_code, (COALESCE(cuisine, ''))) DO NOTHING
  RETURNING id
),
inserted_quality AS (
  INSERT INTO food_quality (food_id, source, source_detail, confidence_score, validation_status, notes)
  SELECT
    fm.food_id,
    COALESCE(sf.raw_food->'quality'->>'source', 'curated'),
    ${sqlString(sourceDetail)},
    NULLIF(sf.raw_food->'quality'->>'confidence_score', '')::REAL,
    COALESCE(sf.raw_food->'quality'->>'validation_status', 'estimated'),
    sf.raw_food->'quality'->>'notes'
  FROM seed_foods sf
  JOIN food_map fm ON fm.normalized_name = sf.normalized_name
  ON CONFLICT (food_id, source, (COALESCE(source_detail, ''))) DO UPDATE SET
    confidence_score = EXCLUDED.confidence_score,
    validation_status = EXCLUDED.validation_status,
    notes = EXCLUDED.notes
  RETURNING id
),
inserted_components AS (
  INSERT INTO food_components (combo_food_id, component_food_id, component_name, quantity, serving_unit, notes)
  SELECT
    fm.food_id,
    COALESCE(component_map.food_id, component_food.id),
    component_item->>'component_name',
    COALESCE((component_item->>'quantity')::REAL, 1),
    NULLIF(component_item->>'serving_unit', ''),
    component_item->>'notes'
  FROM seed_foods sf
  JOIN food_map fm ON fm.normalized_name = sf.normalized_name
  CROSS JOIN LATERAL jsonb_array_elements(COALESCE(sf.raw_food->'components', '[]'::jsonb)) AS component_item
  LEFT JOIN food_map component_map
    ON component_map.normalized_name = btrim(regexp_replace(lower(replace(component_item->>'component_name', '&', ' and ')), '[^a-z0-9]+', ' ', 'g'))
  LEFT JOIN food_database component_food
    ON COALESCE(
      component_food.normalized_name,
      btrim(regexp_replace(lower(replace(component_food.name, '&', ' and ')), '[^a-z0-9]+', ' ', 'g'))
    ) = btrim(regexp_replace(lower(replace(component_item->>'component_name', '&', ' and ')), '[^a-z0-9]+', ' ', 'g'))
  WHERE NOT EXISTS (
    SELECT 1
    FROM food_components existing_component
    WHERE existing_component.combo_food_id = fm.food_id
      AND lower(existing_component.component_name) = lower(component_item->>'component_name')
      AND COALESCE(existing_component.serving_unit, '') = COALESCE(component_item->>'serving_unit', '')
  )
  RETURNING id
)
SELECT
  (SELECT count(*) FROM seed_foods) AS canonical_foods_in_seed,
  (SELECT count(*) FROM inserted_foods) AS canonical_foods_inserted,
  (SELECT count(*) FROM updated_existing_foods) AS canonical_foods_matched_or_ranked,
  (SELECT count(*) FROM inserted_aliases) AS aliases_inserted,
  (SELECT count(*) FROM inserted_portions) AS portions_inserted,
  (SELECT count(*) FROM updated_existing_portions) AS portions_matched_or_updated,
  (SELECT count(*) FROM inserted_country_tags) AS country_tags_inserted,
  (SELECT count(*) FROM inserted_quality) AS quality_records_upserted,
  (SELECT count(*) FROM inserted_components) AS components_inserted;
`);
}

main();
