-- Client Diet Plans — AI-generated, trainer-editable multi-day diet plans
-- assigned to a specific linked client. Distinct from the normalized
-- diet_plans/diet_plan_days/... template system used by manual assignment.

CREATE TABLE IF NOT EXISTS client_diet_plans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trainer_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  client_user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  plan_data JSONB NOT NULL,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE client_diet_plans ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Trainers can read own client diet plans" ON client_diet_plans FOR SELECT USING (auth.uid() = trainer_id);
CREATE POLICY "Clients can read their diet plans" ON client_diet_plans FOR SELECT USING (auth.uid() = client_user_id);
CREATE POLICY "Trainers can insert client diet plans" ON client_diet_plans FOR INSERT WITH CHECK (auth.uid() = trainer_id);
CREATE POLICY "Trainers can update own client diet plans" ON client_diet_plans FOR UPDATE USING (auth.uid() = trainer_id);

CREATE INDEX IF NOT EXISTS idx_client_diet_plans_trainer_client ON client_diet_plans(trainer_id, client_user_id);
