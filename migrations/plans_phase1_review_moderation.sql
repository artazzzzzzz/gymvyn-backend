-- Gymvyn Plans: review moderation. plans_reviews already had a status
-- column supporting 'hidden'/'removed' (Phase 1 foundation), but nothing
-- was ever wired to it and no audit-trail columns existed for it. Mirrors
-- the exact reason + per-status timestamp shape plans_listings already
-- uses for its own suspend/remove moderation, for consistency.
ALTER TABLE plans_reviews ADD COLUMN IF NOT EXISTS moderation_reason TEXT;
ALTER TABLE plans_reviews ADD COLUMN IF NOT EXISTS hidden_at TIMESTAMPTZ;
ALTER TABLE plans_reviews ADD COLUMN IF NOT EXISTS removed_at TIMESTAMPTZ;
