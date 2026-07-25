-- Food knowledge base foundation
-- Purpose:
--   Keep food_database and food_logs backward compatible while adding the
--   companion tables needed for aliases, portions, country/cuisine tags,
--   source quality tracking, and future combo decomposition.
--
-- Safety:
--   - No destructive SQL.
--   - Does not rename or remove food_database or food_logs.
--   - Sample rows are tiny and idempotent; they only attach metadata to
--     existing curated foods if those foods are already present.

CREATE SCHEMA IF NOT EXISTS extensions;
CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA extensions;
SET search_path = public, extensions;

-- ── food_database: compatibility-preserving search metadata ────────────────
ALTER TABLE food_database
  ADD COLUMN IF NOT EXISTS normalized_name TEXT,
  ADD COLUMN IF NOT EXISTS search_priority INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS popularity_score REAL NOT NULL DEFAULT 0;

COMMENT ON COLUMN food_database.normalized_name IS
  'Optional importer-provided normalized food name for future exact/ranked search. Existing food_database.name remains canonical for API compatibility.';
COMMENT ON COLUMN food_database.search_priority IS
  'Manual ranking boost for common/verified foods. Current API does not depend on this yet.';
COMMENT ON COLUMN food_database.popularity_score IS
  'Future usage/import popularity score. Current API does not depend on this yet.';

CREATE INDEX IF NOT EXISTS idx_food_database_normalized_name
  ON food_database(normalized_name)
  WHERE normalized_name IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_food_database_name_trgm
  ON food_database USING gin (name gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_food_database_source_category
  ON food_database(source, category);

CREATE INDEX IF NOT EXISTS idx_food_database_search_rank
  ON food_database(search_priority DESC, popularity_score DESC);

-- ── aliases: Hindi, Hinglish, regional, brand, misspellings ────────────────
CREATE TABLE IF NOT EXISTS food_aliases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  food_id UUID NOT NULL REFERENCES food_database(id) ON DELETE CASCADE,
  alias TEXT NOT NULL,
  normalized_alias TEXT NOT NULL,
  language TEXT NOT NULL DEFAULT 'en',
  alias_type TEXT NOT NULL DEFAULT 'common'
    CHECK (alias_type IN ('common', 'hindi', 'hinglish', 'regional', 'brand', 'misspelling', 'barcode', 'other')),
  priority INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE food_aliases IS
  'Alternate names for a canonical food_database row. Future search should match aliases and rank exact/high-priority aliases above noisy imports.';

CREATE UNIQUE INDEX IF NOT EXISTS idx_food_aliases_food_normalized_alias
  ON food_aliases(food_id, normalized_alias);

CREATE INDEX IF NOT EXISTS idx_food_aliases_normalized_alias
  ON food_aliases(normalized_alias);

CREATE INDEX IF NOT EXISTS idx_food_aliases_alias_trgm
  ON food_aliases USING gin (alias gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_food_aliases_type_priority
  ON food_aliases(alias_type, priority DESC);

ALTER TABLE food_aliases ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'food_aliases'
      AND policyname = 'Anyone can read food aliases'
  ) THEN
    CREATE POLICY "Anyone can read food aliases"
      ON food_aliases FOR SELECT
      USING (true);
  END IF;
END $$;

-- ── portions: household units separate from canonical food rows ────────────
CREATE TABLE IF NOT EXISTS food_portions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  food_id UUID NOT NULL REFERENCES food_database(id) ON DELETE CASCADE,
  portion_name TEXT NOT NULL,
  serving_size REAL NOT NULL CHECK (serving_size > 0),
  serving_unit TEXT NOT NULL,
  grams_equivalent REAL CHECK (grams_equivalent IS NULL OR grams_equivalent > 0),
  ml_equivalent REAL CHECK (ml_equivalent IS NULL OR ml_equivalent > 0),
  calories REAL NOT NULL CHECK (calories >= 0),
  protein_g REAL NOT NULL DEFAULT 0 CHECK (protein_g >= 0),
  carbs_g REAL NOT NULL DEFAULT 0 CHECK (carbs_g >= 0),
  fat_g REAL NOT NULL DEFAULT 0 CHECK (fat_g >= 0),
  fiber_g REAL NOT NULL DEFAULT 0 CHECK (fiber_g >= 0),
  is_default BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE food_portions IS
  'Household and metric portions for a canonical food. Current food_database serving fields remain for backward compatibility.';

CREATE UNIQUE INDEX IF NOT EXISTS idx_food_portions_food_portion_name
  ON food_portions(food_id, lower(portion_name));

CREATE UNIQUE INDEX IF NOT EXISTS idx_food_portions_one_default_per_food
  ON food_portions(food_id)
  WHERE is_default;

CREATE INDEX IF NOT EXISTS idx_food_portions_food_default
  ON food_portions(food_id, is_default DESC);

CREATE INDEX IF NOT EXISTS idx_food_portions_unit
  ON food_portions(serving_unit);

ALTER TABLE food_portions ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'food_portions'
      AND policyname = 'Anyone can read food portions'
  ) THEN
    CREATE POLICY "Anyone can read food portions"
      ON food_portions FOR SELECT
      USING (true);
  END IF;
END $$;

-- ── countries/cuisines: regional relevance and ranking ─────────────────────
CREATE TABLE IF NOT EXISTS food_country_tags (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  food_id UUID NOT NULL REFERENCES food_database(id) ON DELETE CASCADE,
  country_code TEXT NOT NULL CHECK (country_code = upper(country_code) AND length(country_code) BETWEEN 2 AND 3),
  country_name TEXT NOT NULL,
  cuisine TEXT,
  popularity_tier TEXT NOT NULL DEFAULT 'common'
    CHECK (popularity_tier IN ('core', 'common', 'niche')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE food_country_tags IS
  'Country and cuisine tags for regional search/ranking. India can be preferred first without blocking later global imports.';

CREATE UNIQUE INDEX IF NOT EXISTS idx_food_country_tags_food_country_cuisine
  ON food_country_tags(food_id, country_code, COALESCE(cuisine, ''));

CREATE INDEX IF NOT EXISTS idx_food_country_tags_country_popularity
  ON food_country_tags(country_code, popularity_tier);

CREATE INDEX IF NOT EXISTS idx_food_country_tags_cuisine
  ON food_country_tags(cuisine)
  WHERE cuisine IS NOT NULL;

ALTER TABLE food_country_tags ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'food_country_tags'
      AND policyname = 'Anyone can read food country tags'
  ) THEN
    CREATE POLICY "Anyone can read food country tags"
      ON food_country_tags FOR SELECT
      USING (true);
  END IF;
END $$;

-- ── quality: source provenance and validation status ───────────────────────
CREATE TABLE IF NOT EXISTS food_quality (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  food_id UUID NOT NULL REFERENCES food_database(id) ON DELETE CASCADE,
  source TEXT NOT NULL,
  source_detail TEXT,
  confidence_score REAL CHECK (confidence_score IS NULL OR (confidence_score >= 0 AND confidence_score <= 1)),
  validation_status TEXT NOT NULL DEFAULT 'needs_review'
    CHECK (validation_status IN ('verified', 'estimated', 'imported', 'needs_review', 'rejected')),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE food_quality IS
  'Source and quality audit trail for each canonical food. Future imports should write one quality row per source/import batch.';

CREATE UNIQUE INDEX IF NOT EXISTS idx_food_quality_food_source_detail
  ON food_quality(food_id, source, COALESCE(source_detail, ''));

CREATE INDEX IF NOT EXISTS idx_food_quality_status_confidence
  ON food_quality(validation_status, confidence_score DESC);

CREATE INDEX IF NOT EXISTS idx_food_quality_source
  ON food_quality(source);

ALTER TABLE food_quality ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'food_quality'
      AND policyname = 'Anyone can read food quality'
  ) THEN
    CREATE POLICY "Anyone can read food quality"
      ON food_quality FOR SELECT
      USING (true);
  END IF;
END $$;

-- ── components: future decomposition of combo foods ────────────────────────
CREATE TABLE IF NOT EXISTS food_components (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  combo_food_id UUID NOT NULL REFERENCES food_database(id) ON DELETE CASCADE,
  component_food_id UUID REFERENCES food_database(id) ON DELETE SET NULL,
  component_name TEXT NOT NULL,
  quantity REAL NOT NULL DEFAULT 1 CHECK (quantity > 0),
  serving_unit TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (combo_food_id <> component_food_id)
);

COMMENT ON TABLE food_components IS
  'Optional component map for combo foods such as dal chawal, roti sabzi, biryani, and thali. Does not affect current food_logs.';

CREATE INDEX IF NOT EXISTS idx_food_components_combo
  ON food_components(combo_food_id);

CREATE INDEX IF NOT EXISTS idx_food_components_component
  ON food_components(component_food_id)
  WHERE component_food_id IS NOT NULL;

ALTER TABLE food_components ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'food_components'
      AND policyname = 'Anyone can read food components'
  ) THEN
    CREATE POLICY "Anyone can read food components"
      ON food_components FOR SELECT
      USING (true);
  END IF;
END $$;

-- ── Tiny proof-of-model sample metadata for existing curated foods ─────────
WITH sample_aliases(name, alias, normalized_alias, language, alias_type, priority) AS (
  VALUES
    ('Chapati', 'roti', 'roti', 'hi-Latn', 'hinglish', 90),
    ('Chapati', 'phulka', 'phulka', 'hi-Latn', 'regional', 60),
    ('Chapati', 'चपाती', 'चपाती', 'hi', 'hindi', 80),
    ('Dal tadka', 'dal', 'dal', 'hi-Latn', 'hinglish', 80),
    ('Dal tadka', 'दाल तड़का', 'दाल तड़का', 'hi', 'hindi', 90),
    ('Dal chawal', 'dal rice', 'dal rice', 'en', 'common', 80),
    ('Dal chawal', 'दाल चावल', 'दाल चावल', 'hi', 'hindi', 90),
    ('Paneer raw', 'paneer', 'paneer', 'hi-Latn', 'hinglish', 90),
    ('Chicken breast grilled', 'grilled chicken breast', 'grilled chicken breast', 'en', 'common', 80),
    ('Veg biryani', 'vegetable biryani', 'vegetable biryani', 'en', 'common', 75)
)
INSERT INTO food_aliases (food_id, alias, normalized_alias, language, alias_type, priority)
SELECT f.id, a.alias, a.normalized_alias, a.language, a.alias_type, a.priority
FROM sample_aliases a
JOIN food_database f ON f.name = a.name
ON CONFLICT (food_id, normalized_alias) DO NOTHING;

WITH sample_portions(name, portion_name, serving_size, serving_unit, grams_equivalent, ml_equivalent, is_default) AS (
  VALUES
    ('Chapati', '1 medium chapati', 1::REAL, 'piece', 30::REAL, NULL::REAL, true),
    ('Dal tadka', '1 katori', 1::REAL, 'katori', 150::REAL, NULL::REAL, true),
    ('Dal chawal', '1 plate', 1::REAL, 'plate', 300::REAL, NULL::REAL, true),
    ('Paneer raw', '100g paneer', 100::REAL, 'g', 100::REAL, NULL::REAL, true),
    ('Chicken breast grilled', '100g grilled chicken breast', 100::REAL, 'g', 100::REAL, NULL::REAL, true),
    ('Veg biryani', '1 plate', 1::REAL, 'plate', 300::REAL, NULL::REAL, true)
)
INSERT INTO food_portions (
  food_id, portion_name, serving_size, serving_unit, grams_equivalent, ml_equivalent,
  calories, protein_g, carbs_g, fat_g, fiber_g, is_default
)
SELECT
  f.id, p.portion_name, p.serving_size, p.serving_unit, p.grams_equivalent, p.ml_equivalent,
  f.calories_per_serving, f.protein_g, f.carbs_g, f.fat_g, COALESCE(f.fiber_g, 0), p.is_default
FROM sample_portions p
JOIN food_database f ON f.name = p.name
ON CONFLICT (food_id, (lower(portion_name))) DO NOTHING;

WITH sample_country_tags(name, country_code, country_name, cuisine, popularity_tier) AS (
  VALUES
    ('Chapati', 'IN', 'India', 'indian', 'core'),
    ('Dal tadka', 'IN', 'India', 'north_indian', 'core'),
    ('Dal chawal', 'IN', 'India', 'indian', 'core'),
    ('Paneer raw', 'IN', 'India', 'indian', 'core'),
    ('Chicken breast grilled', 'IN', 'India', 'fitness', 'common'),
    ('Veg biryani', 'IN', 'India', 'indian', 'common')
)
INSERT INTO food_country_tags (food_id, country_code, country_name, cuisine, popularity_tier)
SELECT f.id, t.country_code, t.country_name, t.cuisine, t.popularity_tier
FROM sample_country_tags t
JOIN food_database f ON f.name = t.name
ON CONFLICT (food_id, country_code, (COALESCE(cuisine, ''))) DO NOTHING;

WITH sample_quality(name, source, source_detail, confidence_score, validation_status, notes) AS (
  VALUES
    ('Chapati', 'curated_seed', 'seeds/indian_foods.sql', 0.85, 'verified', 'Curated Indian household portion seed.'),
    ('Dal tadka', 'curated_seed', 'seeds/indian_foods.sql', 0.85, 'verified', 'Curated Indian household portion seed.'),
    ('Dal chawal', 'curated_seed', 'seeds/indian_foods.sql', 0.75, 'estimated', 'Composite food; future component map should refine rice/dal quantities.'),
    ('Paneer raw', 'curated_seed', 'seeds/indian_foods.sql', 0.85, 'verified', 'Curated Indian ingredient seed.'),
    ('Chicken breast grilled', 'curated_seed', 'seeds/indian_foods.sql', 0.85, 'verified', 'Curated protein ingredient seed.'),
    ('Veg biryani', 'curated_seed', 'seeds/indian_foods.sql', 0.75, 'estimated', 'Composite plate serving; future regional variants can be added as aliases/portions.')
)
INSERT INTO food_quality (food_id, source, source_detail, confidence_score, validation_status, notes)
SELECT f.id, q.source, q.source_detail, q.confidence_score, q.validation_status, q.notes
FROM sample_quality q
JOIN food_database f ON f.name = q.name
ON CONFLICT (food_id, source, (COALESCE(source_detail, ''))) DO NOTHING;
