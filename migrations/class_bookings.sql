-- class_bookings table
-- status: 'booked' | 'waitlisted' | 'cancelled'
-- Partial unique index prevents a user from having more than one active booking per class.

CREATE TABLE IF NOT EXISTS class_bookings (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  class_id          uuid NOT NULL REFERENCES class_schedule(id) ON DELETE CASCADE,
  gym_id            uuid NOT NULL,
  status            text NOT NULL CHECK (status IN ('booked', 'waitlisted', 'cancelled')),
  waitlist_position integer,
  created_at        timestamptz NOT NULL DEFAULT now(),
  cancelled_at      timestamptz
);

-- One active booking per user per class
CREATE UNIQUE INDEX IF NOT EXISTS class_bookings_active_unique
  ON class_bookings (user_id, class_id)
  WHERE status IN ('booked', 'waitlisted');

CREATE INDEX IF NOT EXISTS class_bookings_class_id_status ON class_bookings (class_id, status);
CREATE INDEX IF NOT EXISTS class_bookings_user_id_status ON class_bookings (user_id, status);

-- RLS
ALTER TABLE class_bookings ENABLE ROW LEVEL SECURITY;

-- Members can see their own bookings
CREATE POLICY "Users can view own bookings"
  ON class_bookings FOR SELECT
  USING (user_id = auth.uid());

-- Members can insert their own bookings
CREATE POLICY "Users can insert own bookings"
  ON class_bookings FOR INSERT
  WITH CHECK (user_id = auth.uid());

-- Members can cancel their own bookings (update to cancelled)
CREATE POLICY "Users can cancel own bookings"
  ON class_bookings FOR UPDATE
  USING (user_id = auth.uid());

-- Gym owners and staff can view all bookings for their gym's classes
CREATE POLICY "Owners can view gym bookings"
  ON class_bookings FOR SELECT
  USING (
    gym_id IN (
      SELECT id FROM gyms WHERE owner_id = auth.uid()
    )
  );
