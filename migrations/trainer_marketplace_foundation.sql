-- Trainer Marketplace v1 — schema foundation (Stage 1 of the build sequence).
-- No payment processor in v1: purchases are confirmed manually by both
-- buyer and seller (see marketplace_purchases.status), commission is
-- tracked for reporting only, no money actually moves. Listings wrap the
-- existing generic trainer_templates (workout) / diet_plan_templates (diet)
-- rows rather than duplicating plan content — template_id is intentionally
-- untyped (no FK) since it points at one of two different tables depending
-- on template_type; enforce that pairing in application code.

-- ── platform_settings ───────────────────────────────────────────────────────
-- Single-row-per-key global config. Nothing like this existed before this
-- migration (verified: no platform_settings/app_config/system_settings table
-- anywhere in the schema).

CREATE TABLE IF NOT EXISTS platform_settings (
  key         TEXT PRIMARY KEY,
  value       JSONB NOT NULL,
  updated_by  UUID REFERENCES users(id) ON DELETE SET NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO platform_settings (key, value)
VALUES ('marketplace_commission_rate', '{"rate": 0.20}'::jsonb)
ON CONFLICT (key) DO NOTHING;

ALTER TABLE platform_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "authenticated users read settings" ON platform_settings
  FOR SELECT USING (auth.uid() IS NOT NULL);
-- No INSERT/UPDATE/DELETE policy: writes go through the service-role client
-- from an admin-gated backend route only (see Stage 6).

-- ── marketplace_listings ────────────────────────────────────────────────────
-- commission_rate is snapshotted from platform_settings at publish time, not
-- looked up live, so a later rate change never retroactively changes what a
-- trainer expects to earn on an already-published listing.

CREATE TABLE IF NOT EXISTS marketplace_listings (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trainer_id       UUID NOT NULL REFERENCES users(id),
  template_type    TEXT NOT NULL CHECK (template_type IN ('workout', 'diet')),
  template_id      UUID NOT NULL, -- trainer_templates.id or diet_plan_templates.id, keyed by template_type; no FK (see header note)
  price_cents      INTEGER NOT NULL CHECK (price_cents >= 0),
  currency         TEXT NOT NULL DEFAULT 'INR',
  commission_rate  NUMERIC,
  status           TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'unpublished')),
  title            TEXT,
  description      TEXT,
  preview_data     JSONB,
  tags             TEXT[] DEFAULT '{}',
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  published_at     TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS marketplace_listings_trainer_idx ON marketplace_listings (trainer_id);
CREATE INDEX IF NOT EXISTS marketplace_listings_status_idx ON marketplace_listings (status);

ALTER TABLE marketplace_listings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "browse published or own listings" ON marketplace_listings
  FOR SELECT USING (status = 'published' OR auth.uid() = trainer_id);
CREATE POLICY "trainer creates own listings" ON marketplace_listings
  FOR INSERT WITH CHECK (auth.uid() = trainer_id);
CREATE POLICY "trainer updates own listings" ON marketplace_listings
  FOR UPDATE USING (auth.uid() = trainer_id);
CREATE POLICY "trainer deletes own listings" ON marketplace_listings
  FOR DELETE USING (auth.uid() = trainer_id);

-- ── marketplace_purchases ───────────────────────────────────────────────────
-- status is a state machine (see build plan): pending_confirmation ->
-- payment_confirmed -> delivered, with disputed/resolved_* and cancelled as
-- side branches. Delivery only fires once BOTH buyer_confirmed_at and
-- seller_confirmed_at are set -- this table is the sole authorization check
-- for plan delivery (never trainer_clients/isLinkedPair, which stays scoped
-- to assigned-client relationships and is unrelated to marketplace access).

CREATE TABLE IF NOT EXISTS marketplace_purchases (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id            UUID NOT NULL REFERENCES marketplace_listings(id),
  template_type         TEXT NOT NULL, -- denormalized from the listing at purchase time
  template_id           UUID NOT NULL, -- denormalized from the listing at purchase time
  buyer_id              UUID NOT NULL REFERENCES users(id),
  seller_id             UUID NOT NULL REFERENCES users(id),
  price_cents           INTEGER NOT NULL,
  commission_rate       NUMERIC,
  commission_cents      INTEGER,
  status                TEXT NOT NULL DEFAULT 'pending_confirmation' CHECK (status IN (
                           'pending_confirmation', 'payment_confirmed', 'delivered',
                           'disputed', 'resolved_confirmed', 'resolved_rejected', 'cancelled'
                         )),
  buyer_confirmed_at    TIMESTAMPTZ,
  seller_confirmed_at   TIMESTAMPTZ,
  admin_resolved_by     UUID REFERENCES users(id) ON DELETE SET NULL,
  admin_resolved_at     TIMESTAMPTZ,
  delivered_at          TIMESTAMPTZ,
  payment_reference     TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS marketplace_purchases_buyer_idx ON marketplace_purchases (buyer_id);
CREATE INDEX IF NOT EXISTS marketplace_purchases_seller_idx ON marketplace_purchases (seller_id);
CREATE INDEX IF NOT EXISTS marketplace_purchases_listing_idx ON marketplace_purchases (listing_id);
CREATE INDEX IF NOT EXISTS marketplace_purchases_status_idx ON marketplace_purchases (status);

ALTER TABLE marketplace_purchases ENABLE ROW LEVEL SECURITY;
CREATE POLICY "buyer or seller read own purchases" ON marketplace_purchases
  FOR SELECT USING (auth.uid() = buyer_id OR auth.uid() = seller_id);
CREATE POLICY "buyer creates purchase request" ON marketplace_purchases
  FOR INSERT WITH CHECK (auth.uid() = buyer_id);
CREATE POLICY "buyer or seller update own purchases" ON marketplace_purchases
  FOR UPDATE USING (auth.uid() = buyer_id OR auth.uid() = seller_id);

-- ── marketplace_payouts ─────────────────────────────────────────────────────
-- Reporting/reconciliation only in v1 -- no money actually moves, 'paid' is
-- a manually-recorded admin note, mirroring trainer_payouts/staff_payouts.

CREATE TABLE IF NOT EXISTS marketplace_payouts (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trainer_id        UUID NOT NULL REFERENCES users(id),
  period_start      DATE NOT NULL,
  period_end        DATE NOT NULL,
  gross_cents       INTEGER NOT NULL DEFAULT 0,
  commission_cents  INTEGER NOT NULL DEFAULT 0,
  net_owed_cents    INTEGER NOT NULL DEFAULT 0,
  status            TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'paid')),
  paid_at           TIMESTAMPTZ,
  notes             TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS marketplace_payouts_trainer_idx ON marketplace_payouts (trainer_id);

ALTER TABLE marketplace_payouts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "trainer reads own payouts" ON marketplace_payouts
  FOR SELECT USING (auth.uid() = trainer_id);
-- No INSERT/UPDATE/DELETE policy: only the admin-gated backend (service-role
-- client) generates/updates payout records in v1.

-- ── assigned_plans (workout) ────────────────────────────────────────────────
-- Existing status check allows active/completed/replaced/paused (confirmed
-- live via pg_constraint, not assumed) -- extend it to also allow 'owned',
-- the new "in the member's library but not the currently active plan" state
-- used for marketplace purchases. Trainer-assigned plans are unaffected:
-- they still land as 'active' immediately, exactly as today.

ALTER TABLE assigned_plans
  ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'trainer_assigned'
    CHECK (source IN ('trainer_assigned', 'marketplace_purchase')),
  ADD COLUMN IF NOT EXISTS source_purchase_id UUID REFERENCES marketplace_purchases(id) ON DELETE SET NULL;

ALTER TABLE assigned_plans DROP CONSTRAINT IF EXISTS assigned_plans_status_check;
ALTER TABLE assigned_plans ADD CONSTRAINT assigned_plans_status_check
  CHECK (status IN ('active', 'completed', 'replaced', 'paused', 'owned'));

CREATE INDEX IF NOT EXISTS assigned_plans_source_purchase_idx ON assigned_plans (source_purchase_id) WHERE source_purchase_id IS NOT NULL;

-- ── assigned_diet_plans (diet) ──────────────────────────────────────────────
-- No status check constraint exists on this table (confirmed live) -- it
-- only has the is_active boolean. library_status is layered on top rather
-- than replacing is_active, so the existing single-active-row query
-- (GET /api/diet-plans/my-plan, .eq('is_active', true).single()) keeps
-- working unmodified; 'owned' rows have is_active=false and are surfaced
-- separately for the plan-library view.

ALTER TABLE assigned_diet_plans
  ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'trainer_assigned'
    CHECK (source IN ('trainer_assigned', 'marketplace_purchase')),
  ADD COLUMN IF NOT EXISTS source_purchase_id UUID REFERENCES marketplace_purchases(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS library_status TEXT NOT NULL DEFAULT 'active'
    CHECK (library_status IN ('active', 'owned'));

CREATE INDEX IF NOT EXISTS assigned_diet_plans_source_purchase_idx ON assigned_diet_plans (source_purchase_id) WHERE source_purchase_id IS NOT NULL;
