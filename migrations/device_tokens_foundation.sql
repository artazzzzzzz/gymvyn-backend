-- Push-notification device registry. Written and read exclusively through
-- the backend (service role, which bypasses RLS) — see
-- src/services/notificationService.js and routes/deviceTokenRoutes.js. A
-- token identifies one specific app install, not a user: if a device is
-- shared or re-logged-in as someone else, the same token is re-registered
-- against the new user_id rather than creating a duplicate row (hence the
-- unique constraint on token, not on (user_id, token)).
--
-- RLS here is a defense-in-depth backstop, same rationale as
-- chat_rls_policies.sql — no INSERT/UPDATE policy is granted to
-- anon/authenticated, all writes must go through the backend.

CREATE TABLE IF NOT EXISTS device_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  platform text NOT NULL CHECK (platform IN ('ios', 'android')),
  token text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS device_tokens_user_id_idx ON device_tokens(user_id);

ALTER TABLE device_tokens ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS device_tokens_owner_select ON device_tokens;
CREATE POLICY device_tokens_owner_select ON device_tokens
  FOR SELECT
  USING (auth.uid() = user_id);
