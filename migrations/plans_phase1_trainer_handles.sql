-- Gymvyn Plans: trainer storefront handles. Lives on trainer_profiles (the
-- trainer-domain extension table), not users, since it's seller-facing
-- metadata specific to being a Gymvyn Plans trainer, not a core identity
-- field. Nullable -- existing trainers have no handle until they set one
-- (Step 5 endpoint) or one is backfilled for them.
ALTER TABLE trainer_profiles ADD COLUMN IF NOT EXISTS handle TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS trainer_profiles_handle_idx
  ON trainer_profiles (handle) WHERE handle IS NOT NULL;

ALTER TABLE trainer_profiles DROP CONSTRAINT IF EXISTS trainer_profiles_handle_format_check;
ALTER TABLE trainer_profiles ADD CONSTRAINT trainer_profiles_handle_format_check
  CHECK (handle IS NULL OR (handle ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$' AND char_length(handle) BETWEEN 3 AND 60));
