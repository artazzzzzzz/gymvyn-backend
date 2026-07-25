-- Gymvyn Plans: defense-in-depth against duplicate purchases.
-- The app-level check in POST /api/plans/purchases (plansRoutes.js) already
-- returns an existing non-terminal purchase instead of creating a second
-- one; this index closes the race window between two concurrent requests
-- for the same buyer + listing.
CREATE UNIQUE INDEX IF NOT EXISTS plans_purchases_buyer_listing_active_once_idx
  ON plans_purchases (buyer_id, listing_id)
  WHERE status IN ('payment_pending', 'paid', 'delivered');
