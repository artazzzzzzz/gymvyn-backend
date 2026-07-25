-- Link diet_plan_foods entries back to food_database for re-editing/re-scaling.
-- food_name/calories/protein_g/carbs_g/fat_g remain the resolved snapshot at
-- time of adding; food_id is a reference only and does not live-join.

ALTER TABLE diet_plan_foods
  ADD COLUMN IF NOT EXISTS food_id UUID REFERENCES food_database(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_diet_plan_foods_food_id ON diet_plan_foods(food_id) WHERE food_id IS NOT NULL;
