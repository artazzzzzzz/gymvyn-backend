-- Nutrition module foundation
-- Additive only: existing templates and assigned plans retain their current
-- rows and continue to work with the legacy diet-plan APIs.

ALTER TABLE diet_plan_templates
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'published', 'archived')),
  ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS target_ranges JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;

ALTER TABLE diet_plan_foods
  ADD COLUMN IF NOT EXISTS serving_quantity REAL,
  ADD COLUMN IF NOT EXISTS serving_unit TEXT,
  ADD COLUMN IF NOT EXISTS fiber_g REAL NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS food_snapshot JSONB;

ALTER TABLE diet_plan_meals
  ADD COLUMN IF NOT EXISTS fiber_g REAL NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS meal_type TEXT,
  ADD COLUMN IF NOT EXISTS preparation_instructions TEXT,
  ADD COLUMN IF NOT EXISTS tags TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN IF NOT EXISTS photo_url TEXT;

ALTER TABLE assigned_diet_foods
  ADD COLUMN IF NOT EXISTS food_id UUID REFERENCES food_database(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS serving_quantity REAL,
  ADD COLUMN IF NOT EXISTS serving_unit TEXT,
  ADD COLUMN IF NOT EXISTS fiber_g REAL NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS food_snapshot JSONB;

ALTER TABLE assigned_diet_meals
  ADD COLUMN IF NOT EXISTS fiber_g REAL NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS meal_type TEXT,
  ADD COLUMN IF NOT EXISTS preparation_instructions TEXT,
  ADD COLUMN IF NOT EXISTS tags TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN IF NOT EXISTS photo_url TEXT;

CREATE TABLE IF NOT EXISTS nutrition_recipes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  scope TEXT NOT NULL DEFAULT 'personal' CHECK (scope IN ('personal', 'team')),
  name TEXT NOT NULL,
  meal_type TEXT,
  preparation_instructions TEXT,
  notes TEXT,
  tags TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  photo_url TEXT,
  nutrition_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS nutrition_recipe_ingredients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  recipe_id UUID NOT NULL REFERENCES nutrition_recipes(id) ON DELETE CASCADE,
  food_id UUID NOT NULL REFERENCES food_database(id) ON DELETE RESTRICT,
  serving_quantity REAL NOT NULL CHECK (serving_quantity > 0),
  serving_unit TEXT NOT NULL,
  food_snapshot JSONB NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS diet_template_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id UUID NOT NULL REFERENCES diet_plan_templates(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  snapshot JSONB NOT NULL,
  created_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (template_id, version)
);

CREATE INDEX IF NOT EXISTS nutrition_recipes_owner_scope_idx
  ON nutrition_recipes(owner_id, scope, updated_at DESC);
CREATE INDEX IF NOT EXISTS nutrition_recipe_ingredients_recipe_idx
  ON nutrition_recipe_ingredients(recipe_id, sort_order);
CREATE INDEX IF NOT EXISTS assigned_diet_foods_food_id_idx
  ON assigned_diet_foods(food_id) WHERE food_id IS NOT NULL;

ALTER TABLE nutrition_recipes ENABLE ROW LEVEL SECURITY;
ALTER TABLE nutrition_recipe_ingredients ENABLE ROW LEVEL SECURITY;
ALTER TABLE diet_template_versions ENABLE ROW LEVEL SECURITY;

-- These tables are reached through authenticated server routes using the
-- service role. Explicitly avoid direct browser grants/policies until a
-- member/team permission model is finalised.
