-- Keep the database permission catalog aligned with routes/staffRoutes.js.
-- Existing staff receive the new permission disabled by default.

ALTER TABLE public.staff_permissions
  DROP CONSTRAINT IF EXISTS staff_permissions_permission_key_check;

ALTER TABLE public.staff_permissions
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
      'manage_feed'
    )
  );

INSERT INTO public.staff_permissions (staff_id, permission_key, enabled)
SELECT gs.id, 'manage_feed', false
FROM public.gym_staff AS gs
WHERE NOT EXISTS (
  SELECT 1
  FROM public.staff_permissions AS sp
  WHERE sp.staff_id = gs.id
    AND sp.permission_key = 'manage_feed'
);
