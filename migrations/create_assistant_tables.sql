-- Assistant settings per gym (revenue_metric is owner-configurable)
CREATE TABLE IF NOT EXISTS assistant_settings (
  gym_id        UUID PRIMARY KEY REFERENCES gyms(id) ON DELETE CASCADE,
  revenue_metric TEXT NOT NULL DEFAULT 'membership_only'
    CHECK (revenue_metric IN ('membership_only', 'all_income')),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One conversation = one chat thread (owns its messages + a compact summary)
CREATE TABLE IF NOT EXISTS assistant_conversations (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  gym_id          UUID NOT NULL REFERENCES gyms(id) ON DELETE CASCADE,
  owner_id        UUID NOT NULL,
  title           TEXT,
  context_summary TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_asst_conversations_gym
  ON assistant_conversations(gym_id, created_at DESC);

-- Messages within a conversation; is_compacted=true means the row was already
-- rolled into context_summary by the nightly cron and will be deleted soon.
CREATE TABLE IF NOT EXISTS assistant_messages (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES assistant_conversations(id) ON DELETE CASCADE,
  role            TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  content         TEXT NOT NULL,
  is_compacted    BOOLEAN NOT NULL DEFAULT false,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_asst_messages_conv
  ON assistant_messages(conversation_id, created_at ASC);

-- Immutable audit log of every proposed / executed / cancelled action
CREATE TABLE IF NOT EXISTS assistant_action_log (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  gym_id           UUID NOT NULL REFERENCES gyms(id) ON DELETE CASCADE,
  owner_id         UUID NOT NULL,
  conversation_id  UUID REFERENCES assistant_conversations(id) ON DELETE SET NULL,
  proposed_action  JSONB NOT NULL,
  status           TEXT NOT NULL DEFAULT 'proposed'
    CHECK (status IN ('proposed', 'confirmed', 'executed', 'cancelled')),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  executed_at      TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_asst_action_log_gym
  ON assistant_action_log(gym_id, created_at DESC);

-- ── Row-Level Security ────────────────────────────────────────────────────────
-- The backend uses the service-role key (bypasses RLS), so these are
-- defence-in-depth for any direct/anon Supabase access.

ALTER TABLE assistant_settings      ENABLE ROW LEVEL SECURITY;
ALTER TABLE assistant_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE assistant_messages      ENABLE ROW LEVEL SECURITY;
ALTER TABLE assistant_action_log    ENABLE ROW LEVEL SECURITY;

-- assistant_settings: accessible to the gym owner
CREATE POLICY "Owner can manage own assistant settings"
  ON assistant_settings FOR ALL
  USING (auth.uid() = (SELECT owner_id FROM gyms WHERE id = gym_id));

-- assistant_conversations: accessible to the owner who created them
CREATE POLICY "Owner can access own conversations"
  ON assistant_conversations FOR ALL
  USING (auth.uid() = owner_id);

-- assistant_messages: accessible when the caller owns the conversation
CREATE POLICY "Owner can access own messages"
  ON assistant_messages FOR ALL
  USING (
    auth.uid() = (
      SELECT owner_id FROM assistant_conversations WHERE id = conversation_id
    )
  );

-- assistant_action_log: accessible to the gym owner
CREATE POLICY "Owner can access own action log"
  ON assistant_action_log FOR ALL
  USING (auth.uid() = owner_id);
