-- Trainer-initiated "Join Gym by Code" flow.
-- Separate code column from gyms.join_code (member join) so a leaked code
-- can't be replayed against the wrong role's consumption endpoint.
ALTER TABLE gyms ADD COLUMN IF NOT EXISTS trainer_join_code TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS gyms_trainer_join_code_idx
  ON gyms (trainer_join_code) WHERE trainer_join_code IS NOT NULL;

-- Pending join request target. gym_id stays NULL until the owner approves,
-- so GET /api/gym-trainers/:gymId (filtered on gym_id) never sees a pending
-- request and TOTAL/ACTIVE/INVITED counts in GymTrainers.jsx can't be
-- polluted by it.
ALTER TABLE trainer_profiles ADD COLUMN IF NOT EXISTS pending_gym_id UUID REFERENCES gyms(id);
