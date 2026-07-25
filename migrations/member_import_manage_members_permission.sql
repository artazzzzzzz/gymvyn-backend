-- Add a write-level staff permission for member mutations such as mass import.
-- Existing staff get the permission disabled by default; owners can enable it.

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
      'view_announcements'
    )
  );

INSERT INTO staff_permissions (staff_id, permission_key, enabled)
SELECT gs.id, 'manage_members', false
FROM gym_staff gs
WHERE NOT EXISTS (
  SELECT 1
  FROM staff_permissions sp
  WHERE sp.staff_id = gs.id
    AND sp.permission_key = 'manage_members'
);
