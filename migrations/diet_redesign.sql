-- Diet Redesign migration
-- Tables: user_macros, food_database, food_logs, user_diet_plans
-- Plus: activity_level / gender columns on users

-- ── user_macros ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS user_macros (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE UNIQUE,
  calories INTEGER NOT NULL,
  protein_g INTEGER NOT NULL,
  carbs_g INTEGER NOT NULL,
  fat_g INTEGER NOT NULL,
  bmr INTEGER,
  tdee INTEGER,
  activity_level TEXT DEFAULT 'moderate',
  goal_adjustment INTEGER DEFAULT 0,
  formula TEXT DEFAULT 'mifflin_st_jeor',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE user_macros ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can read own macros" ON user_macros FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own macros" ON user_macros FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own macros" ON user_macros FOR UPDATE USING (auth.uid() = user_id);

-- ── food_database ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS food_database (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  name_hindi TEXT,
  category TEXT NOT NULL,
  calories_per_serving REAL NOT NULL,
  protein_g REAL NOT NULL,
  carbs_g REAL NOT NULL,
  fat_g REAL NOT NULL,
  fiber_g REAL DEFAULT 0,
  serving_size REAL NOT NULL,
  serving_unit TEXT NOT NULL,
  serving_description TEXT,
  is_combo BOOLEAN DEFAULT false,
  is_indian BOOLEAN DEFAULT true,
  source TEXT DEFAULT 'curated',
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE food_database ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can read food database" ON food_database FOR SELECT USING (true);

-- ── food_logs ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS food_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  date DATE NOT NULL DEFAULT CURRENT_DATE,
  meal_type TEXT NOT NULL CHECK (meal_type IN ('breakfast', 'lunch', 'snack', 'dinner')),
  food_name TEXT NOT NULL,
  quantity REAL NOT NULL DEFAULT 1,
  serving_unit TEXT,
  calories REAL NOT NULL,
  protein_g REAL NOT NULL DEFAULT 0,
  carbs_g REAL NOT NULL DEFAULT 0,
  fat_g REAL NOT NULL DEFAULT 0,
  logged_via TEXT DEFAULT 'manual' CHECK (logged_via IN ('manual', 'voice', 'camera', 'plan')),
  food_id UUID REFERENCES food_database(id),
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE food_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can read own food logs" ON food_logs FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own food logs" ON food_logs FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can delete own food logs" ON food_logs FOR DELETE USING (auth.uid() = user_id);
CREATE POLICY "Users can update own food logs" ON food_logs FOR UPDATE USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_food_logs_user_date ON food_logs(user_id, date);

-- ── user_diet_plans ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS user_diet_plans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  plan_data JSONB NOT NULL,
  diet_type TEXT DEFAULT 'non_veg' CHECK (diet_type IN ('veg', 'non_veg', 'eggetarian')),
  cuisine_pref TEXT DEFAULT 'north_indian',
  is_active BOOLEAN DEFAULT true,
  generated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE user_diet_plans ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can read own diet plans" ON user_diet_plans FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own diet plans" ON user_diet_plans FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own diet plans" ON user_diet_plans FOR UPDATE USING (auth.uid() = user_id);

-- ── users: gender + activity_level columns ───────────────────────────────────
ALTER TABLE users ADD COLUMN IF NOT EXISTS activity_level TEXT DEFAULT 'moderate';
ALTER TABLE users ADD COLUMN IF NOT EXISTS gender TEXT DEFAULT 'male';
