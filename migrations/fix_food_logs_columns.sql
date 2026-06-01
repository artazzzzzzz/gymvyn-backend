-- Fix food_logs table: add all missing columns
-- Run this in Supabase Dashboard → SQL Editor
-- Safe to run multiple times (uses IF NOT EXISTS / IF EXISTS)

-- Step 1: Add every missing column
ALTER TABLE food_logs
  ADD COLUMN IF NOT EXISTS quantity      REAL    NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS serving_unit  TEXT,
  ADD COLUMN IF NOT EXISTS protein_g     REAL    NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS carbs_g       REAL    NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS fat_g         REAL    NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS logged_via    TEXT    DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS food_id       UUID;

-- Step 2: Copy old "protein" values into protein_g, then drop old column
UPDATE food_logs SET protein_g = COALESCE(protein, 0) WHERE protein_g = 0;
ALTER TABLE food_logs DROP COLUMN IF EXISTS protein;

-- Step 3: Add index if missing
CREATE INDEX IF NOT EXISTS idx_food_logs_user_date ON food_logs(user_id, log_date);
