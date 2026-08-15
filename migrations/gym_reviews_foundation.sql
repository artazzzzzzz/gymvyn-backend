-- Gym reviews: a member reviewing their own gym. Deliberately a separate
-- table from plans_reviews (trainer-plan-listing purchase reviews, added in
-- plans_phase1_foundation.sql) -- that table is keyed off a specific
-- plans_purchases row (a product review), this one is keyed off gym
-- membership (a tenant/relationship review). No shared listing/purchase
-- concept applies here, so reusing plans_reviews would mean nullable
-- listing_id/purchase_id columns bent to mean something else entirely.
--
-- Column set mirrors plans_reviews where the concept transfers directly
-- (rating, review_text, created_at) for consistency, swaps buyer_id/
-- listing_id for user_id/gym_id to match this domain's existing naming
-- (see gym_memberships.user_id / gym_memberships.gym_id), and adds
-- updated_at + an upsert-friendly UNIQUE(gym_id, user_id) instead of
-- UNIQUE(purchase_id) -- unlike a plan purchase, a gym membership is
-- open-ended, so editing an existing review (upsert) is the natural model
-- rather than plans_reviews' one-review-per-purchase, immutable-after-write
-- shape. No status/moderation column: this migration only supports the
-- member-side submit/edit flow (no admin moderation or public listing UI
-- exists yet), so a moderation column would be dead schema until that
-- feature is actually built.
CREATE TABLE IF NOT EXISTS gym_reviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  gym_id UUID NOT NULL REFERENCES gyms(id),
  user_id UUID NOT NULL REFERENCES users(id),
  rating SMALLINT NOT NULL CHECK (rating BETWEEN 1 AND 5),
  review_text TEXT NOT NULL CHECK (char_length(trim(review_text)) BETWEEN 1 AND 2000),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (gym_id, user_id)
);
CREATE INDEX IF NOT EXISTS gym_reviews_gym_idx ON gym_reviews (gym_id, created_at DESC);
CREATE INDEX IF NOT EXISTS gym_reviews_user_idx ON gym_reviews (user_id, created_at DESC);

-- Served through an authenticated Express route using the service-role
-- client (src/routes/gymReviewRoutes.js), same pattern as plans_reviews.
-- Keep direct Data API access closed by default.
ALTER TABLE gym_reviews ENABLE ROW LEVEL SECURITY;
