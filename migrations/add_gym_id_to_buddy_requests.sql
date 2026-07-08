-- Gym buddies are opt-in: a buddy_request is only valid messaging grounds
-- when it was made in the context of a shared gym. gym_id records which gym
-- the two members were co-members of at request time; can_message() also
-- re-checks both users still hold an active gym_memberships row for this
-- gym_id at message time (see src/utils/canMessage.js).
ALTER TABLE buddy_requests ADD COLUMN IF NOT EXISTS gym_id uuid REFERENCES gyms(id);

CREATE INDEX IF NOT EXISTS buddy_requests_gym_id_idx ON buddy_requests (gym_id);
