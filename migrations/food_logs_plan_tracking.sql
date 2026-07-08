-- Track which AI diet-plan item a food_logs row confirms, so a checked-off
-- planned meal persists as "done" across reloads. logged_via already supports
-- 'plan' as a value (see fix_food_logs_columns.sql / diet_redesign.sql) — this
-- only adds the reference back to the specific plan slot.
--
-- Composite reference instead of a single plan_item_id because plan items
-- live inside user_diet_plans.plan_data (JSONB) and have no per-item UUID —
-- (diet_plan_id, plan_day, meal_type, plan_item_index) uniquely identifies
-- one item in plan_data.days[plan_day].meals[meal_type].items[plan_item_index].
-- meal_type reuses the existing food_logs column.

ALTER TABLE food_logs
  ADD COLUMN IF NOT EXISTS diet_plan_id    UUID REFERENCES user_diet_plans(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS plan_day        INT,
  ADD COLUMN IF NOT EXISTS plan_item_index INT;

CREATE INDEX IF NOT EXISTS idx_food_logs_plan_lookup
  ON food_logs(diet_plan_id, plan_day, meal_type, plan_item_index);
