const express = require('express');
const { z } = require('zod');
const { createClient } = require('@supabase/supabase-js');
const { auth } = require('../middleware/auth');
const { validate } = require('../src/utils/validate');

const router = express.Router();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

// price is required only when is_paid is true -- enforced with .refine()
// since zod's per-field checks can't see a sibling field.
const lockerCreateSchema = z.object({
  label: z.string({ error: 'label is required' }).trim().min(1, 'label is required'),
  is_paid: z.boolean({ error: 'is_paid must be a boolean' }),
  price: z.number({ error: 'price must be a number' }).optional().nullable(),
}).refine(
  (d) => !d.is_paid || (typeof d.price === 'number' && Number.isFinite(d.price) && d.price > 0),
  { message: 'price must be a positive number when is_paid is true', path: ['price'] }
);

// ── Middleware ────────────────────────────────────────────────────────────────

async function withProfile(req, res, next) {
  const { data, error } = await supabase
    .from('users')
    .select('role, gym_id')
    .eq('id', req.user.id)
    .maybeSingle();

  if (error) return res.status(500).json({ error: 'Failed to load user profile' });
  if (!data)  return res.status(401).json({ error: 'User profile not found' });

  req.profile = data;
  next();
}

// Resolves gym and attaches lockers_enabled flag to req.
async function ownerOnly(req, res, next) {
  if (req.profile.role !== 'gym_owner') {
    return res.status(403).json({ error: 'Gym owner access required' });
  }

  const { data, error } = await supabase
    .from('gyms')
    .select('id, lockers_enabled')
    .eq('owner_id', req.user.id)
    .eq('is_active', true)
    .maybeSingle();

  if (error) return res.status(500).json({ error: 'Failed to resolve gym' });
  if (!data)  return res.status(404).json({ error: 'No active gym found for this owner' });

  req.gymId = data.id;
  req.lockersEnabled = data.lockers_enabled;
  next();
}

// Applied after ownerOnly on every route EXCEPT /settings
function requireLockersEnabled(req, res, next) {
  if (!req.lockersEnabled) {
    return res.status(403).json({ error: 'Locker management is not enabled for this gym' });
  }
  next();
}

// ── Settings (no lockersEnabled check — owner must be able to toggle it ON) ──

// GET /api/lockers/settings
router.get(
  '/settings',
  auth, withProfile, ownerOnly,
  async (req, res) => {
    try {
      res.json({ lockers_enabled: req.lockersEnabled });
    } catch (err) {
      console.error('GET /api/lockers/settings error:', err);
      res.status(500).json({ error: err.message });
    }
  }
);

// PATCH /api/lockers/settings
router.patch(
  '/settings',
  auth, withProfile, ownerOnly,
  async (req, res) => {
    try {
      const { lockers_enabled } = req.body;
      if (typeof lockers_enabled !== 'boolean') {
        return res.status(400).json({ error: 'lockers_enabled must be a boolean' });
      }

      const { error } = await supabase
        .from('gyms')
        .update({ lockers_enabled })
        .eq('id', req.gymId);

      if (error) throw error;
      res.json({ lockers_enabled });
    } catch (err) {
      console.error('PATCH /api/lockers/settings error:', err);
      res.status(500).json({ error: err.message });
    }
  }
);

// ── Expiring soon (must be before /:id) ──────────────────────────────────────

// GET /api/lockers/expiring-soon
router.get(
  '/expiring-soon',
  auth, withProfile, ownerOnly, requireLockersEnabled,
  async (req, res) => {
    try {
      const threshold = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString();

      const { data, error } = await supabase
        .from('locker_assignments')
        .select(`
          id, locker_id, member_id, expires_at, duration_days,
          gym_lockers!locker_assignments_locker_id_fkey(label)
        `)
        .eq('gym_id', req.gymId)
        .eq('status', 'active')
        .lte('expires_at', threshold)
        .order('expires_at', { ascending: true });

      if (error) throw error;

      // Fetch member names
      const memberIds = [...new Set((data || []).map(r => r.member_id))];
      const memberMap = {};
      if (memberIds.length > 0) {
        const { data: members } = await supabase
          .from('users')
          .select('id, full_name')
          .in('id', memberIds);
        for (const m of members || []) memberMap[m.id] = m.full_name;
      }

      const result = (data || []).map(r => ({
        assignment_id: r.id,
        locker_id:     r.locker_id,
        locker_label:  r.gym_lockers?.label || null,
        member_id:     r.member_id,
        member_name:   memberMap[r.member_id] || null,
        expires_at:    r.expires_at,
        duration_days: r.duration_days,
      }));

      res.json(result);
    } catch (err) {
      console.error('GET /api/lockers/expiring-soon error:', err);
      res.status(500).json({ error: err.message });
    }
  }
);

// ── Locker CRUD ───────────────────────────────────────────────────────────────

// GET /api/lockers
router.get(
  '/',
  auth, withProfile, ownerOnly, requireLockersEnabled,
  async (req, res) => {
    try {
      const { data: lockers, error } = await supabase
        .from('gym_lockers')
        .select('*')
        .eq('gym_id', req.gymId)
        .order('label', { ascending: true });

      if (error) throw error;

      // For occupied lockers, fetch active assignment + member info
      const occupiedIds = (lockers || [])
        .filter(l => l.status === 'occupied')
        .map(l => l.id);

      const assignmentMap = {};
      if (occupiedIds.length > 0) {
        const { data: assignments } = await supabase
          .from('locker_assignments')
          .select('id, locker_id, member_id, expires_at, duration_days')
          .in('locker_id', occupiedIds)
          .eq('status', 'active');

        const memberIds = [...new Set((assignments || []).map(a => a.member_id))];
        const memberMap = {};
        if (memberIds.length > 0) {
          const { data: members } = await supabase
            .from('users')
            .select('id, full_name, phone')
            .in('id', memberIds);
          for (const m of members || []) memberMap[m.id] = m;
        }

        // Fetch payment status for active assignments
        const assignmentIds = (assignments || []).map(a => a.id);
        const paymentMap = {};
        if (assignmentIds.length > 0) {
          const { data: payments } = await supabase
            .from('locker_payments')
            .select('assignment_id, payment_status, payment_method, paid_at')
            .in('assignment_id', assignmentIds);
          for (const p of payments || []) paymentMap[p.assignment_id] = p;
        }

        for (const a of assignments || []) {
          const member = memberMap[a.member_id] || {};
          assignmentMap[a.locker_id] = {
            assignment_id:  a.id,
            member_id:      a.member_id,
            member_name:    member.full_name || null,
            member_phone:   member.phone     || null,
            expires_at:     a.expires_at,
            duration_days:  a.duration_days,
            payment:        paymentMap[a.id] || null,
          };
        }
      }

      const result = (lockers || []).map(l => ({
        ...l,
        assignment: l.status === 'occupied' ? (assignmentMap[l.id] || null) : null,
      }));

      res.json(result);
    } catch (err) {
      console.error('GET /api/lockers error:', err);
      res.status(500).json({ error: err.message });
    }
  }
);

// POST /api/lockers
router.post(
  '/',
  auth, withProfile, ownerOnly, requireLockersEnabled, validate(lockerCreateSchema),
  async (req, res) => {
    try {
      const { label, is_paid, price } = req.body;

      // Pre-flight uniqueness check for better error message
      const { data: existing } = await supabase
        .from('gym_lockers')
        .select('id')
        .eq('gym_id', req.gymId)
        .eq('label', label)
        .maybeSingle();

      if (existing) {
        return res.status(409).json({ error: `A locker with label "${label}" already exists in this gym` });
      }

      const { data, error } = await supabase
        .from('gym_lockers')
        .insert({
          gym_id:  req.gymId,
          label,
          is_paid,
          price:   is_paid ? price : null,
          status:  'available',
        })
        .select()
        .single();

      if (error) throw error;
      res.status(201).json(data);
    } catch (err) {
      console.error('POST /api/lockers error:', err);
      res.status(500).json({ error: err.message });
    }
  }
);

// PATCH /api/lockers/:id
router.patch(
  '/:id',
  auth, withProfile, ownerOnly, requireLockersEnabled,
  async (req, res) => {
    try {
      const { id } = req.params;

      const { data: existing, error: fetchErr } = await supabase
        .from('gym_lockers')
        .select('id, is_paid, status')
        .eq('id', id)
        .eq('gym_id', req.gymId)
        .maybeSingle();

      if (fetchErr) throw fetchErr;
      if (!existing) return res.status(404).json({ error: 'Locker not found in your gym' });

      const updates = {};
      const body = req.body;

      // Validate is_paid toggle
      if (body.is_paid !== undefined && body.is_paid !== existing.is_paid) {
        if (existing.is_paid === true && body.is_paid === false) {
          // Block if there's an active assignment with an unpaid payment
          const { data: activeAssignment } = await supabase
            .from('locker_assignments')
            .select('id')
            .eq('locker_id', id)
            .eq('status', 'active')
            .maybeSingle();

          if (activeAssignment) {
            const { data: pendingPayment } = await supabase
              .from('locker_payments')
              .select('id')
              .eq('assignment_id', activeAssignment.id)
              .eq('payment_status', 'unpaid')
              .maybeSingle();

            if (pendingPayment) {
              return res.status(409).json({
                error: 'Cannot toggle is_paid off while an active assignment has an unpaid payment. Resolve the payment first.',
              });
            }
          }
        }
        updates.is_paid = body.is_paid;
      }

      if (body.price !== undefined) {
        const newIsPaid = body.is_paid !== undefined ? body.is_paid : existing.is_paid;
        if (newIsPaid) {
          const p = Number(body.price);
          if (!Number.isFinite(p) || p <= 0) {
            return res.status(400).json({ error: 'price must be a positive number when is_paid is true' });
          }
          updates.price = p;
        } else {
          updates.price = null;
        }
      }

      if (body.label !== undefined) {
        if (!body.label.trim()) return res.status(400).json({ error: 'label cannot be empty' });
        // Check uniqueness for the new label
        const { data: labelConflict } = await supabase
          .from('gym_lockers')
          .select('id')
          .eq('gym_id', req.gymId)
          .eq('label', body.label.trim())
          .neq('id', id)
          .maybeSingle();
        if (labelConflict) {
          return res.status(409).json({ error: `A locker with label "${body.label.trim()}" already exists in this gym` });
        }
        updates.label = body.label.trim();
      }

      if (body.status !== undefined) {
        if (!['available', 'occupied', 'maintenance'].includes(body.status)) {
          return res.status(400).json({ error: 'status must be one of: available, occupied, maintenance' });
        }
        updates.status = body.status;
      }

      if (Object.keys(updates).length === 0) {
        return res.status(400).json({ error: 'No valid fields to update' });
      }

      const { data, error } = await supabase
        .from('gym_lockers')
        .update(updates)
        .eq('id', id)
        .eq('gym_id', req.gymId)
        .select()
        .single();

      if (error) throw error;
      res.json(data);
    } catch (err) {
      console.error('PATCH /api/lockers/:id error:', err);
      res.status(500).json({ error: err.message });
    }
  }
);

// DELETE /api/lockers/:id
router.delete(
  '/:id',
  auth, withProfile, ownerOnly, requireLockersEnabled,
  async (req, res) => {
    try {
      const { id } = req.params;

      const { data: existing, error: fetchErr } = await supabase
        .from('gym_lockers')
        .select('id, label')
        .eq('id', id)
        .eq('gym_id', req.gymId)
        .maybeSingle();

      if (fetchErr) throw fetchErr;
      if (!existing) return res.status(404).json({ error: 'Locker not found in your gym' });

      // Block delete if any assignment history exists
      const { count, error: countErr } = await supabase
        .from('locker_assignments')
        .select('id', { count: 'exact', head: true })
        .eq('locker_id', id);

      if (countErr) throw countErr;

      if (count > 0) {
        return res.status(409).json({
          error: `Locker "${existing.label}" has assignment history and cannot be deleted. Set it to maintenance status if it's no longer in use.`,
          has_assignment_history: true,
        });
      }

      const { error } = await supabase
        .from('gym_lockers')
        .delete()
        .eq('id', id)
        .eq('gym_id', req.gymId);

      if (error) throw error;
      res.json({ success: true });
    } catch (err) {
      console.error('DELETE /api/lockers/:id error:', err);
      res.status(500).json({ error: err.message });
    }
  }
);

// ── Assignment routes ─────────────────────────────────────────────────────────

// POST /api/lockers/:id/assign
router.post(
  '/:id/assign',
  auth, withProfile, ownerOnly, requireLockersEnabled,
  async (req, res) => {
    try {
      const { id } = req.params;
      const { member_id, duration_days } = req.body;

      if (!member_id) return res.status(400).json({ error: 'member_id is required' });
      const days = parseInt(duration_days, 10);
      if (!Number.isInteger(days) || days < 1) {
        return res.status(400).json({ error: 'duration_days must be a positive integer' });
      }

      // Fetch locker
      const { data: locker, error: lockerErr } = await supabase
        .from('gym_lockers')
        .select('id, label, status, is_paid, price')
        .eq('id', id)
        .eq('gym_id', req.gymId)
        .maybeSingle();

      if (lockerErr) throw lockerErr;
      if (!locker) return res.status(404).json({ error: 'Locker not found in your gym' });
      if (locker.status !== 'available') {
        return res.status(409).json({ error: `Locker "${locker.label}" is currently ${locker.status} and cannot be assigned` });
      }

      // Validate member belongs to this gym
      const { data: membership, error: memErr } = await supabase
        .from('gym_memberships')
        .select('id, start_date, end_date')
        .eq('gym_id', req.gymId)
        .eq('user_id', member_id)
        .eq('status', 'active')
        .maybeSingle();

      if (memErr) throw memErr;
      const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
      const membershipIsCurrent = membership
        && (!membership.start_date || membership.start_date <= today)
        && (!membership.end_date || membership.end_date >= today);
      if (!membershipIsCurrent) {
        return res.status(400).json({ error: 'Member is not an active member of this gym' });
      }

      const now = new Date();
      const expiresAt = new Date(now.getTime() + days * 24 * 60 * 60 * 1000).toISOString();

      // Insert assignment
      const { data: assignment, error: assignErr } = await supabase
        .from('locker_assignments')
        .insert({
          locker_id:     id,
          gym_id:        req.gymId,
          member_id,
          duration_days: days,
          expires_at:    expiresAt,
          status:        'active',
        })
        .select()
        .single();

      if (assignErr) throw assignErr;

      // Update locker status to occupied
      const { error: lockerUpdateErr } = await supabase
        .from('gym_lockers')
        .update({ status: 'occupied' })
        .eq('id', id);

      if (lockerUpdateErr) {
        // Rollback assignment
        await supabase.from('locker_assignments').delete().eq('id', assignment.id);
        throw lockerUpdateErr;
      }

      // If paid, create unpaid payment record
      let payment = null;
      if (locker.is_paid) {
        const { data: paymentRow, error: payErr } = await supabase
          .from('locker_payments')
          .insert({
            assignment_id:  assignment.id,
            gym_id:         req.gymId,
            amount:         locker.price,
            payment_status: 'unpaid',
          })
          .select()
          .single();

        if (payErr) {
          // Rollback: revert locker + delete assignment
          await supabase.from('gym_lockers').update({ status: 'available' }).eq('id', id);
          await supabase.from('locker_assignments').delete().eq('id', assignment.id);
          throw payErr;
        }
        payment = paymentRow;
      }

      res.status(201).json({ assignment, payment });
    } catch (err) {
      console.error('POST /api/lockers/:id/assign error:', err);
      res.status(500).json({ error: err.message });
    }
  }
);

// PATCH /api/lockers/:id/end-assignment
router.patch(
  '/:id/end-assignment',
  auth, withProfile, ownerOnly, requireLockersEnabled,
  async (req, res) => {
    try {
      const { id } = req.params;

      // Fetch locker
      const { data: locker, error: lockerErr } = await supabase
        .from('gym_lockers')
        .select('id, label, status')
        .eq('id', id)
        .eq('gym_id', req.gymId)
        .maybeSingle();

      if (lockerErr) throw lockerErr;
      if (!locker) return res.status(404).json({ error: 'Locker not found in your gym' });
      if (locker.status !== 'occupied') {
        return res.status(409).json({ error: `Locker "${locker.label}" has no active assignment to end` });
      }

      // Find active assignment
      const { data: assignment, error: assignErr } = await supabase
        .from('locker_assignments')
        .select('id')
        .eq('locker_id', id)
        .eq('gym_id', req.gymId)
        .eq('status', 'active')
        .maybeSingle();

      if (assignErr) throw assignErr;
      if (!assignment) {
        return res.status(404).json({ error: 'No active assignment found for this locker' });
      }

      const now = new Date().toISOString();

      // End the assignment
      const { error: endErr } = await supabase
        .from('locker_assignments')
        .update({ status: 'ended_early', ended_at: now })
        .eq('id', assignment.id);

      if (endErr) throw endErr;

      // Return locker to available
      const { error: revertErr } = await supabase
        .from('gym_lockers')
        .update({ status: 'available' })
        .eq('id', id);

      if (revertErr) throw revertErr;

      res.json({ success: true, assignment_id: assignment.id });
    } catch (err) {
      console.error('PATCH /api/lockers/:id/end-assignment error:', err);
      res.status(500).json({ error: err.message });
    }
  }
);

// PATCH /api/lockers/:id/payment
router.patch(
  '/:id/payment',
  auth, withProfile, ownerOnly, requireLockersEnabled,
  async (req, res) => {
    try {
      const { id } = req.params;
      const { payment_method } = req.body;

      if (!payment_method || !['cash', 'upi'].includes(payment_method)) {
        return res.status(400).json({ error: 'payment_method must be "cash" or "upi"' });
      }

      // Find active assignment for this locker
      const { data: assignment, error: assignErr } = await supabase
        .from('locker_assignments')
        .select('id')
        .eq('locker_id', id)
        .eq('gym_id', req.gymId)
        .eq('status', 'active')
        .maybeSingle();

      if (assignErr) throw assignErr;
      if (!assignment) {
        return res.status(404).json({ error: 'No active assignment found for this locker' });
      }

      // Find unpaid payment for this assignment
      const { data: payment, error: payFetchErr } = await supabase
        .from('locker_payments')
        .select('id, payment_status')
        .eq('assignment_id', assignment.id)
        .maybeSingle();

      if (payFetchErr) throw payFetchErr;
      if (!payment) {
        return res.status(404).json({ error: 'No payment record found for this assignment (locker may be free)' });
      }
      if (payment.payment_status === 'paid') {
        return res.status(409).json({ error: 'Payment has already been marked as paid' });
      }

      const { data: updated, error: payUpdateErr } = await supabase
        .from('locker_payments')
        .update({
          payment_status: 'paid',
          payment_method,
          paid_at: new Date().toISOString(),
        })
        .eq('id', payment.id)
        .select()
        .single();

      if (payUpdateErr) throw payUpdateErr;
      res.json(updated);
    } catch (err) {
      console.error('PATCH /api/lockers/:id/payment error:', err);
      res.status(500).json({ error: err.message });
    }
  }
);

module.exports = router;
