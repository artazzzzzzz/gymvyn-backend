-- Gymvyn Plans Phase 1: additive database foundation only.
-- This migration intentionally does not reuse or alter legacy marketplace_* objects,
-- does not process payments, and does not deliver into assigned_* tables.

CREATE TABLE IF NOT EXISTS plans_listings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trainer_id UUID NOT NULL REFERENCES users(id),
  template_type TEXT NOT NULL CHECK (template_type IN ('workout', 'diet')),
  template_id UUID NOT NULL,
  slug TEXT NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  title TEXT NOT NULL CHECK (char_length(trim(title)) BETWEEN 1 AND 160),
  description TEXT NOT NULL DEFAULT '',
  price_inr_paise INTEGER NOT NULL CHECK (price_inr_paise >= 2000),
  price_usd_cents INTEGER NOT NULL CHECK (price_usd_cents >= 100),
  commission_bps INTEGER NOT NULL DEFAULT 500 CHECK (commission_bps = 500),
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'unpublished', 'suspended', 'removed')),
  published_at TIMESTAMPTZ,
  suspended_at TIMESTAMPTZ,
  removed_at TIMESTAMPTZ,
  moderation_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS plans_listings_published_browse_idx
  ON plans_listings (published_at DESC, id) WHERE status = 'published';
CREATE INDEX IF NOT EXISTS plans_listings_trainer_management_idx
  ON plans_listings (trainer_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS plans_listings_slug_lookup_idx ON plans_listings (slug);

CREATE TABLE IF NOT EXISTS plans_listing_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id UUID NOT NULL REFERENCES plans_listings(id) ON DELETE CASCADE,
  template_type TEXT NOT NULL CHECK (template_type IN ('workout', 'diet')),
  template_id UUID NOT NULL,
  template_snapshot_json JSONB NOT NULL,
  title_snapshot TEXT NOT NULL,
  description_snapshot TEXT NOT NULL DEFAULT '',
  price_inr_paise INTEGER NOT NULL CHECK (price_inr_paise >= 2000),
  price_usd_cents INTEGER NOT NULL CHECK (price_usd_cents >= 100),
  commission_bps INTEGER NOT NULL DEFAULT 500 CHECK (commission_bps = 500),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS plans_listing_versions_listing_idx ON plans_listing_versions (listing_id, created_at DESC);

CREATE TABLE IF NOT EXISTS plans_purchases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id UUID NOT NULL REFERENCES plans_listings(id),
  listing_version_id UUID REFERENCES plans_listing_versions(id),
  buyer_id UUID NOT NULL REFERENCES users(id),
  trainer_id UUID NOT NULL REFERENCES users(id),
  template_type TEXT NOT NULL CHECK (template_type IN ('workout', 'diet')),
  template_id UUID NOT NULL,
  currency TEXT NOT NULL CHECK (currency IN ('INR', 'USD')),
  final_price_minor INTEGER NOT NULL CHECK (final_price_minor > 0),
  commission_bps INTEGER NOT NULL DEFAULT 500 CHECK (commission_bps = 500),
  commission_minor INTEGER NOT NULL DEFAULT 0 CHECK (commission_minor >= 0),
  status TEXT NOT NULL DEFAULT 'created' CHECK (status IN ('created', 'payment_pending', 'paid', 'delivered', 'failed', 'refunded_exception')),
  provider_order_id TEXT,
  workout_assigned_plan_id UUID REFERENCES assigned_plans(id),
  diet_assigned_plan_id UUID REFERENCES assigned_diet_plans(id),
  delivered_at TIMESTAMPTZ,
  refund_exception_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (num_nonnulls(workout_assigned_plan_id, diet_assigned_plan_id) <= 1),
  CHECK (status <> 'delivered' OR num_nonnulls(workout_assigned_plan_id, diet_assigned_plan_id) = 1)
);
CREATE INDEX IF NOT EXISTS plans_purchases_buyer_idx ON plans_purchases (buyer_id, created_at DESC);
CREATE INDEX IF NOT EXISTS plans_purchases_listing_idx ON plans_purchases (listing_id, created_at DESC);
CREATE INDEX IF NOT EXISTS plans_purchases_provider_order_idx ON plans_purchases (provider_order_id) WHERE provider_order_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS plans_purchases_workout_delivery_once_idx ON plans_purchases (workout_assigned_plan_id) WHERE workout_assigned_plan_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS plans_purchases_diet_delivery_once_idx ON plans_purchases (diet_assigned_plan_id) WHERE diet_assigned_plan_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS plans_payment_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  purchase_id UUID NOT NULL REFERENCES plans_purchases(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  provider_order_id TEXT,
  provider_payment_id TEXT,
  event_type TEXT NOT NULL,
  event_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS plans_payment_events_purchase_idx ON plans_payment_events (purchase_id, created_at DESC);
CREATE INDEX IF NOT EXISTS plans_payment_events_provider_order_idx ON plans_payment_events (provider, provider_order_id) WHERE provider_order_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS plans_payment_events_provider_payment_once_idx ON plans_payment_events (provider, provider_payment_id) WHERE provider_payment_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS plans_reviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id UUID NOT NULL REFERENCES plans_listings(id),
  purchase_id UUID NOT NULL REFERENCES plans_purchases(id),
  buyer_id UUID NOT NULL REFERENCES users(id),
  rating SMALLINT NOT NULL CHECK (rating BETWEEN 1 AND 5),
  review_text TEXT NOT NULL CHECK (char_length(trim(review_text)) BETWEEN 1 AND 2000),
  status TEXT NOT NULL DEFAULT 'visible' CHECK (status IN ('visible', 'hidden', 'removed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (purchase_id)
);
CREATE INDEX IF NOT EXISTS plans_reviews_listing_visible_idx ON plans_reviews (listing_id, created_at DESC) WHERE status = 'visible';
CREATE INDEX IF NOT EXISTS plans_reviews_buyer_idx ON plans_reviews (buyer_id, created_at DESC);

-- Gymvyn Plans is served through authenticated Express routes using the
-- service-role client. Keep direct Data API access closed by default.
ALTER TABLE plans_listings ENABLE ROW LEVEL SECURITY;
ALTER TABLE plans_listing_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE plans_purchases ENABLE ROW LEVEL SECURITY;
ALTER TABLE plans_payment_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE plans_reviews ENABLE ROW LEVEL SECURITY;
