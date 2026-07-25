-- Gymvyn food portion measurement standard
-- Safe to run more than once. Adds metadata needed for estimated household portions.

ALTER TABLE food_portions
  ADD COLUMN IF NOT EXISTS is_estimated BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS portion_note TEXT;

COMMENT ON COLUMN food_portions.grams_equivalent IS
  'Estimated gram equivalent for household/imperial portions. Metric gram portions should match serving_size.';

COMMENT ON COLUMN food_portions.ml_equivalent IS
  'Estimated milliliter equivalent for liquid household portions. Metric ml portions should match serving_size.';

COMMENT ON COLUMN food_portions.is_estimated IS
  'True when the portion gram/ml value is an estimate rather than a lab-verified or package-exact value.';

COMMENT ON COLUMN food_portions.portion_note IS
  'Short note describing portion assumptions, e.g. household size variance or metric anchor source.';
