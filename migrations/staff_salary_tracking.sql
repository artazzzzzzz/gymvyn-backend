-- Staff salary tracking, parallel to trainer_payment_rates/trainer_payouts but
-- keyed by staff_id (gym_staff.id) instead of trainer_id. Unlike trainers, staff
-- have no auto-tracked activity (no clients/sessions equivalent), so there is no
-- staff_sessions table -- "hourly" model amounts are entered manually by the owner
-- at payout time rather than computed from tracked hours.

CREATE TABLE IF NOT EXISTS staff_payment_rates (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  gym_id        UUID NOT NULL REFERENCES gyms(id),
  staff_id      UUID NOT NULL REFERENCES gym_staff(id),
  model         TEXT NOT NULL DEFAULT 'fixed' CHECK (model IN ('fixed', 'hourly')),
  monthly_rate  NUMERIC,
  hourly_rate   NUMERIC,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (gym_id, staff_id)
);

CREATE TABLE IF NOT EXISTS staff_payouts (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  gym_id        UUID NOT NULL REFERENCES gyms(id),
  staff_id      UUID NOT NULL REFERENCES gym_staff(id),
  period_start  DATE,
  period_end    DATE,
  amount        NUMERIC NOT NULL,
  breakdown     JSONB,
  notes         TEXT,
  status        TEXT NOT NULL DEFAULT 'paid',
  paid_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS staff_payouts_gym_staff_idx ON staff_payouts (gym_id, staff_id);
CREATE INDEX IF NOT EXISTS staff_payouts_paid_at_idx ON staff_payouts (paid_at);

-- RLS mirrors trainer_payment_rates/trainer_payouts's defense-in-depth policies.
-- staff_id here is gym_staff.id (not auth.uid()) since staff sign in via their own
-- user_id, so the "own row" policies join through gym_staff, same as
-- staff_permissions's existing "staff_read_own_permissions" policy.
ALTER TABLE staff_payment_rates ENABLE ROW LEVEL SECURITY;
ALTER TABLE staff_payouts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "owner manages staff rates" ON staff_payment_rates FOR ALL
  USING (gym_id IN (SELECT gyms.id FROM gyms WHERE gyms.owner_id = auth.uid()));

CREATE POLICY "staff views own rate" ON staff_payment_rates FOR SELECT
  USING (staff_id IN (SELECT gym_staff.id FROM gym_staff WHERE gym_staff.user_id = auth.uid()));

CREATE POLICY "owner manages staff payouts" ON staff_payouts FOR ALL
  USING (gym_id IN (SELECT gyms.id FROM gyms WHERE gyms.owner_id = auth.uid()));

CREATE POLICY "staff views own payouts" ON staff_payouts FOR SELECT
  USING (staff_id IN (SELECT gym_staff.id FROM gym_staff WHERE gym_staff.user_id = auth.uid()));
