-- Fixes a real bug found during Prompt 11's live admin-UI walkthrough:
-- resolving a disputed purchase as the actual production admin
-- (adminceo@gmail.com) failed with
--   insert or update on table "marketplace_purchases" violates foreign
--   key constraint "marketplace_purchases_admin_resolved_by_fkey"
-- because that account has an auth.users row (it can log in) but no
-- public.users row (it's never a platform user — see
-- middleware/requireAdmin.js, which checks admin identity purely via an
-- env-var email allowlist against auth.users, never public.users). The
-- FK on admin_resolved_by -> public.users(id) was wrong from the start:
-- it assumed every admin is also an in-app user, which doesn't hold for
-- the real admin account. Every earlier test of this endpoint used a
-- test trainer account temporarily added to ADMIN_EMAILS — those DO have
-- public.users rows, so the bug was invisible until the real admin
-- identity was used for the first time.
alter table marketplace_purchases
  drop constraint marketplace_purchases_admin_resolved_by_fkey;

-- Same bug, same root cause, found immediately after in the same
-- walkthrough: platform_settings.updated_by had the identical FK to
-- public.users(id), and saving the commission rate as the real admin
-- failed the same way.
alter table platform_settings
  drop constraint platform_settings_updated_by_fkey;
