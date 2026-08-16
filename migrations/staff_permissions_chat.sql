-- Bug 14 (QA re-verification): add a 'chat' staff permission key, matching
-- how the other 10 keys (most recently manage_feed) are defined/stored.
-- Confirmed live: PATCH /api/staff/:staffId/permissions currently 500s with
-- "violates check constraint staff_permissions_permission_key_check" the
-- moment 'chat' is toggled, because the CHECK constraint doesn't know about
-- it yet. This migration widens the constraint to the full current key list.

ALTER TABLE staff_permissions
  DROP CONSTRAINT IF EXISTS staff_permissions_permission_key_check;

ALTER TABLE staff_permissions
  ADD CONSTRAINT staff_permissions_permission_key_check
  CHECK (
    permission_key IN (
      'checkin',
      'view_members',
      'manage_members',
      'view_payments',
      'collect_payment',
      'view_schedule',
      'manage_lockers',
      'view_supplements',
      'view_announcements',
      'manage_feed',
      'chat'
    )
  );

INSERT INTO staff_permissions (staff_id, permission_key, enabled)
SELECT gs.id, 'chat', false
FROM gym_staff gs
WHERE NOT EXISTS (
  SELECT 1
  FROM staff_permissions sp
  WHERE sp.staff_id = gs.id
    AND sp.permission_key = 'chat'
);
