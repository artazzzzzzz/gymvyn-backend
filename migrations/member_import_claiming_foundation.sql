-- Backend foundation for owner/staff mass member import and account claiming.
-- This migration only creates the staging model and integrity guards. It does
-- not parse files and does not mutate existing production member data.

CREATE TABLE IF NOT EXISTS imported_gym_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  gym_id UUID NOT NULL REFERENCES gyms(id) ON DELETE CASCADE,
  claimed_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  claimed_membership_id UUID,

  normalized_phone TEXT,
  normalized_email TEXT,
  raw_phone TEXT,
  raw_email TEXT,

  imported_full_name TEXT,
  imported_profile JSONB NOT NULL DEFAULT '{}'::jsonb,

  membership_type TEXT,
  monthly_fee NUMERIC,
  start_date DATE,
  end_date DATE,
  payment_status TEXT,
  gym_member_code TEXT,
  notes TEXT,
  assigned_trainer_id UUID REFERENCES users(id) ON DELETE SET NULL,
  membership_status TEXT NOT NULL DEFAULT 'active',
  tags TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],

  source_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  row_fingerprint TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'unclaimed'
    CHECK (status IN ('unclaimed', 'claiming', 'claimed', 'ignored', 'conflict')),
  claimed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CHECK (normalized_phone IS NOT NULL OR normalized_email IS NOT NULL OR imported_full_name IS NOT NULL)
);

ALTER TABLE imported_gym_members ENABLE ROW LEVEL SECURITY;

ALTER TABLE gym_memberships
  ADD COLUMN IF NOT EXISTS imported_member_id UUID REFERENCES imported_gym_members(id) ON DELETE SET NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'imported_gym_members_claimed_membership_fk'
      AND conrelid = 'imported_gym_members'::regclass
  ) THEN
    ALTER TABLE imported_gym_members
      ADD CONSTRAINT imported_gym_members_claimed_membership_fk
      FOREIGN KEY (claimed_membership_id) REFERENCES gym_memberships(id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_imported_gym_members_gym_status
  ON imported_gym_members(gym_id, status);

CREATE INDEX IF NOT EXISTS idx_imported_gym_members_claimed_user
  ON imported_gym_members(claimed_user_id)
  WHERE claimed_user_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uniq_imported_gym_members_open_phone
  ON imported_gym_members(gym_id, normalized_phone)
  WHERE normalized_phone IS NOT NULL AND status IN ('unclaimed', 'claiming');

CREATE UNIQUE INDEX IF NOT EXISTS uniq_imported_gym_members_open_email
  ON imported_gym_members(gym_id, normalized_email)
  WHERE normalized_email IS NOT NULL AND status IN ('unclaimed', 'claiming');

CREATE UNIQUE INDEX IF NOT EXISTS uniq_imported_gym_members_open_code
  ON imported_gym_members(gym_id, gym_member_code)
  WHERE gym_member_code IS NOT NULL AND status IN ('unclaimed', 'claiming');

CREATE UNIQUE INDEX IF NOT EXISTS uniq_imported_gym_members_row_fingerprint
  ON imported_gym_members(gym_id, row_fingerprint);

CREATE UNIQUE INDEX IF NOT EXISTS uniq_imported_gym_members_claim_once
  ON imported_gym_members(id, claimed_user_id)
  WHERE claimed_user_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uniq_gym_memberships_one_active_per_user
  ON gym_memberships(gym_id, user_id)
  WHERE user_id IS NOT NULL AND status = 'active';