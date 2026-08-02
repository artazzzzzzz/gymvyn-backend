const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const { auth } = require('../middleware/auth');
const { sendPushToUser } = require('../src/services/notificationService');

const router = express.Router();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

// ── POST /api/class-bookings/:classId ────────────────────────────────────────
// Book a class or join its waitlist.

router.post('/:classId', auth, async (req, res) => {
  try {
    const { classId } = req.params;
    const userId = req.user.id;

    // Verify class exists and is active
    const { data: cls, error: clsErr } = await supabase
      .from('class_schedule')
      .select('id, gym_id, capacity, is_active, class_name')
      .eq('id', classId)
      .maybeSingle();
    if (clsErr) throw clsErr;
    if (!cls) return res.status(404).json({ error: 'Class not found' });
    if (!cls.is_active) return res.status(400).json({ error: 'Class is not active' });

    const capacity = cls.capacity || 0;

    // Count confirmed bookings
    const { count: bookedCount, error: countErr } = await supabase
      .from('class_bookings')
      .select('id', { count: 'exact', head: true })
      .eq('class_id', classId)
      .eq('status', 'booked');
    if (countErr) throw countErr;

    let status, waitlist_position;

    if ((bookedCount || 0) < capacity) {
      status = 'booked';
      waitlist_position = null;
    } else {
      // Count current waitlisted to determine position
      const { count: waitlistCount, error: wErr } = await supabase
        .from('class_bookings')
        .select('id', { count: 'exact', head: true })
        .eq('class_id', classId)
        .eq('status', 'waitlisted');
      if (wErr) throw wErr;
      status = 'waitlisted';
      waitlist_position = (waitlistCount || 0) + 1;
    }

    const { data: booking, error: insertErr } = await supabase
      .from('class_bookings')
      .insert({ user_id: userId, class_id: classId, gym_id: cls.gym_id, status, waitlist_position })
      .select('id, status, waitlist_position')
      .single();

    if (insertErr) {
      // Unique constraint violation → user already has an active booking
      if (insertErr.code === '23505') {
        return res.status(409).json({ error: 'You already have an active booking for this class' });
      }
      throw insertErr;
    }

    res.status(201).json({
      status: booking.status,
      ...(booking.waitlist_position != null && { waitlist_position: booking.waitlist_position }),
    });

    // Fire-and-forget — only for an immediate confirmed booking. A
    // waitlisted user already sees their status in the response above;
    // they get a push later if/when promoted (see the DELETE handler).
    if (status === 'booked') {
      sendPushToUser(supabase, userId, {
        title: 'Booking confirmed',
        body: cls.class_name ? `You're booked for ${cls.class_name}.` : "You're booked for your class.",
        data: { type: 'class_booking_confirmed', classId },
      }).catch(err => console.error('[classBookingRoutes] push dispatch failed:', err.message));
    }
  } catch (err) {
    console.error('POST /api/class-bookings/:classId error:', err);
    res.status(500).json({ error: err.message || 'Failed to book class' });
  }
});

// ── DELETE /api/class-bookings/:classId ──────────────────────────────────────
// Cancel a booking; if the cancelled slot was confirmed, promote the first
// waitlisted user.

router.delete('/:classId', auth, async (req, res) => {
  try {
    const { classId } = req.params;
    const userId = req.user.id;

    // Find the user's active booking for this class
    const { data: booking, error: findErr } = await supabase
      .from('class_bookings')
      .select('id, status, waitlist_position')
      .eq('user_id', userId)
      .eq('class_id', classId)
      .in('status', ['booked', 'waitlisted'])
      .maybeSingle();
    if (findErr) throw findErr;
    if (!booking) return res.status(404).json({ error: 'No active booking found for this class' });

    const wasBooked = booking.status === 'booked';
    const wasWaitlisted = booking.status === 'waitlisted';

    // Cancel the booking
    const { error: cancelErr } = await supabase
      .from('class_bookings')
      .update({ status: 'cancelled', cancelled_at: new Date().toISOString() })
      .eq('id', booking.id);
    if (cancelErr) throw cancelErr;

    let promotedUserId = null;

    if (wasBooked) {
      // Promote the first waitlisted user (lowest waitlist_position, oldest created_at)
      const { data: first, error: firstErr } = await supabase
        .from('class_bookings')
        .select('id, user_id, waitlist_position')
        .eq('class_id', classId)
        .eq('status', 'waitlisted')
        .order('waitlist_position', { ascending: true })
        .order('created_at', { ascending: true })
        .limit(1)
        .maybeSingle();
      if (firstErr) throw firstErr;

      if (first) {
        // Promote them
        const { error: promoteErr } = await supabase
          .from('class_bookings')
          .update({ status: 'booked', waitlist_position: null })
          .eq('id', first.id);
        if (promoteErr) throw promoteErr;

        promotedUserId = first.user_id;

        // Decrement positions for everyone remaining on the waitlist
        // (everyone with position > promoted user's position)
        const { error: shiftErr } = await supabase.rpc('decrement_waitlist_positions', {
          p_class_id: classId,
          p_above_position: first.waitlist_position,
        });
        // If the RPC doesn't exist yet, fall back to a JS loop
        if (shiftErr) {
          const { data: remaining, error: remErr } = await supabase
            .from('class_bookings')
            .select('id, waitlist_position')
            .eq('class_id', classId)
            .eq('status', 'waitlisted')
            .gt('waitlist_position', first.waitlist_position);
          if (remErr) throw remErr;
          for (const row of (remaining || [])) {
            await supabase
              .from('class_bookings')
              .update({ waitlist_position: row.waitlist_position - 1 })
              .eq('id', row.id);
          }
        }
      }
    } else if (wasWaitlisted) {
      // Decrement positions for everyone waitlisted with a higher position number
      const { error: shiftErr } = await supabase.rpc('decrement_waitlist_positions', {
        p_class_id: classId,
        p_above_position: booking.waitlist_position,
      });
      if (shiftErr) {
        const { data: remaining, error: remErr } = await supabase
          .from('class_bookings')
          .select('id, waitlist_position')
          .eq('class_id', classId)
          .eq('status', 'waitlisted')
          .gt('waitlist_position', booking.waitlist_position);
        if (remErr) throw remErr;
        for (const row of (remaining || [])) {
          await supabase
            .from('class_bookings')
            .update({ waitlist_position: row.waitlist_position - 1 })
            .eq('id', row.id);
        }
      }
    }

    res.json({
      cancelled: true,
      ...(promotedUserId && { promoted_user_id: promotedUserId }),
    });

    // Fire-and-forget
    if (promotedUserId) {
      const { data: cls } = await supabase
        .from('class_schedule')
        .select('class_name')
        .eq('id', classId)
        .maybeSingle();

      sendPushToUser(supabase, promotedUserId, {
        title: "You're off the waitlist!",
        body: cls?.class_name ? `A spot opened up — you're now booked for ${cls.class_name}.` : "A spot opened up — you're now booked.",
        data: { type: 'class_booking_promoted', classId },
      }).catch(err => console.error('[classBookingRoutes] push dispatch failed:', err.message));
    }
  } catch (err) {
    console.error('DELETE /api/class-bookings/:classId error:', err);
    res.status(500).json({ error: err.message || 'Failed to cancel booking' });
  }
});

// ── GET /api/class-bookings/my ───────────────────────────────────────────────
// Must be defined BEFORE /:classId to prevent 'my' being caught as a classId.
// Returns all upcoming active bookings for the authenticated user.

router.get('/my', auth, async (req, res) => {
  try {
    const userId = req.user.id;
    const now = new Date().toISOString();

    // Fetch bookings with class details
    const { data: bookings, error: bErr } = await supabase
      .from('class_bookings')
      .select('id, status, waitlist_position, class_id, gym_id, created_at')
      .eq('user_id', userId)
      .in('status', ['booked', 'waitlisted']);
    if (bErr) throw bErr;

    if (!bookings || bookings.length === 0) return res.json([]);

    const classIds = bookings.map(b => b.class_id);
    const gymIds   = [...new Set(bookings.map(b => b.gym_id).filter(Boolean))];

    // Fetch class details
    const { data: classes, error: cErr } = await supabase
      .from('class_schedule')
      .select('id, class_name, description, start_time, end_time, trainer_id, gym_id, capacity, class_type, equipment')
      .in('id', classIds)
      .gte('start_time', now);
    if (cErr) throw cErr;

    const classById = {};
    for (const c of (classes || [])) classById[c.id] = c;

    // Fetch gym names
    const gymById = {};
    if (gymIds.length) {
      const { data: gyms } = await supabase
        .from('gyms')
        .select('id, name')
        .in('id', gymIds);
      for (const g of (gyms || [])) gymById[g.id] = g.name;
    }

    // Fetch trainer names
    const trainerIds = [...new Set(Object.values(classById).map(c => c.trainer_id).filter(Boolean))];
    const trainerById = {};
    if (trainerIds.length) {
      const { data: trainers } = await supabase
        .from('users')
        .select('id, full_name')
        .in('id', trainerIds);
      for (const t of (trainers || [])) trainerById[t.id] = t.full_name;
    }

    // Build response — only include bookings whose class is in the future
    const result = bookings
      .filter(b => classById[b.class_id])
      .map(b => {
        const cls = classById[b.class_id];
        return {
          id:               b.id,
          class_id:         b.class_id,
          status:           b.status,
          waitlist_position: b.waitlist_position,
          class_name:       cls.class_name,
          description:      cls.description,
          start_time:       cls.start_time,
          end_time:         cls.end_time,
          capacity:         cls.capacity,
          class_type:       cls.class_type,
          equipment:        cls.equipment,
          trainer_id:       cls.trainer_id,
          trainer_name:     trainerById[cls.trainer_id] || null,
          gym_id:           b.gym_id,
          gym_name:         gymById[b.gym_id] || null,
        };
      })
      .sort((a, b) => new Date(a.start_time) - new Date(b.start_time));

    return res.json(result);
  } catch (err) {
    console.error('GET /api/class-bookings/my error:', err);
    res.status(500).json({ error: err.message || 'Failed to fetch bookings' });
  }
});

// ── GET /api/class-bookings/class/:classId ───────────────────────────────────
// Returns the booked + waitlisted roster for a class.
// Caller must be the gym owner or the assigned trainer for this class.

router.get('/class/:classId', auth, async (req, res) => {
  try {
    const { classId } = req.params;
    const userId = req.user.id;

    // Fetch class to verify access
    const { data: cls, error: clsErr } = await supabase
      .from('class_schedule')
      .select('id, gym_id, trainer_id')
      .eq('id', classId)
      .maybeSingle();
    if (clsErr) throw clsErr;
    if (!cls) return res.status(404).json({ error: 'Class not found' });

    // Check: caller is the gym owner or the class trainer
    const { data: gym, error: gymErr } = await supabase
      .from('gyms')
      .select('id')
      .eq('id', cls.gym_id)
      .eq('owner_id', userId)
      .eq('is_active', true)
      .maybeSingle();
    if (gymErr) throw gymErr;

    const isOwner   = !!gym;
    const isTrainer = cls.trainer_id === userId;

    if (!isOwner && !isTrainer) {
      return res.status(403).json({ error: 'Not authorised to view this class roster' });
    }

    // Fetch all non-cancelled bookings
    const { data: bookings, error: bErr } = await supabase
      .from('class_bookings')
      .select('id, user_id, status, waitlist_position, created_at')
      .eq('class_id', classId)
      .in('status', ['booked', 'waitlisted'])
      .order('waitlist_position', { ascending: true, nullsFirst: false })
      .order('created_at', { ascending: true });
    if (bErr) throw bErr;

    const userIds = [...new Set((bookings || []).map(b => b.user_id))];
    const userById = {};
    if (userIds.length) {
      const { data: users } = await supabase
        .from('users')
        .select('id, full_name')
        .in('id', userIds);
      for (const u of (users || [])) userById[u.id] = u.full_name;
    }

    const shaped = (bookings || []).map(b => ({
      booking_id:       b.id,
      user_id:          b.user_id,
      full_name:        userById[b.user_id] || null,
      status:           b.status,
      waitlist_position: b.waitlist_position,
      created_at:       b.created_at,
    }));

    return res.json({
      booked:    shaped.filter(b => b.status === 'booked'),
      waitlisted: shaped.filter(b => b.status === 'waitlisted'),
    });
  } catch (err) {
    console.error('GET /api/class-bookings/class/:classId error:', err);
    res.status(500).json({ error: err.message || 'Failed to fetch class roster' });
  }
});

module.exports = router;
