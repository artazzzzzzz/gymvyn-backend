-- trainer_reviews_foundation.sql
--
-- Allows gym members with an active trainer-client relationship to leave a
-- rating and review for their trainer. Mirrors gym_reviews_foundation.sql but
-- scoped to trainer_id instead of gym_id.
--
-- Guard is enforced in the backend route (POST /api/trainer-reviews):
-- getActiveTrainerClientLink() checks trainer_clients.status before upsert.
-- This table itself intentionally has no RLS — backend uses service-role key
-- and does the authZ check itself (same pattern as every other table in this
-- repo that the backend owns via service-role).

CREATE TABLE IF NOT EXISTS trainer_reviews (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  trainer_id  uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  user_id     uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  rating      int         NOT NULL CHECK (rating BETWEEN 1 AND 5),
  review_text text        NOT NULL CHECK (char_length(review_text) BETWEEN 1 AND 2000),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (trainer_id, user_id)
);

-- Index for looking up all reviews a trainer has received (trainer profile page)
CREATE INDEX IF NOT EXISTS trainer_reviews_trainer_id_idx
  ON trainer_reviews (trainer_id);

-- Index for member looking up their own reviews across all trainers
CREATE INDEX IF NOT EXISTS trainer_reviews_user_id_idx
  ON trainer_reviews (user_id);
