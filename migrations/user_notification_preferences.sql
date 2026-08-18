-- user_notification_preferences.sql
--
-- Adds per-user notification preference storage. Categories reflect the actual
-- push/in-app notification paths that exist in this codebase as of 2026-08:
--   chat          — new chat messages (chatRoutes.js → sendPushToUser)
--   class_bookings — booking confirmations + waitlist promotions (classBookingRoutes.js)
--   gym_announcements — important gym announcements (no push yet; enforcement deferred)
--   trainer_plan  — trainer plan assignment/updates (no push yet; enforcement deferred)
--
-- Default is all enabled (true) so existing users are unaffected. A NULL value
-- on the column is treated the same as all-enabled by the frontend/backend.
--
-- Stored as JSONB on users (same table as share_achievements) to avoid a
-- separate preferences table — matches the existing pattern for user-level
-- boolean settings in this codebase.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS notification_preferences JSONB
  DEFAULT '{"chat":true,"class_bookings":true,"gym_announcements":true,"trainer_plan":true}'::jsonb;
