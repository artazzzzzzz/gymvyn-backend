const express = require('express');
const { z } = require('zod');
const { createClient } = require('@supabase/supabase-js');
const { auth: authenticateToken, requireGymOwner } = require('../middleware/auth');
const { validate } = require('../src/utils/validate');

const router = express.Router();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

// Payout amount capped at ₹10,00,000, matching the membership-plan price cap
// in server.js -- a single payout above that is almost certainly bad input,
// not a real payroll figure. amount was previously only checked for
// `!= null`, so a negative number, NaN, or Infinity all passed through
// straight into the payouts ledger (NaN/Infinity silently became `null` on
// JSON serialization; a negative amount was inserted as-is).
const payoutSchema = z.object({
  staffId: z.string().min(1, 'staffId is required'),
  period_start: z.string().optional().nullable(),
  period_end: z.string().optional().nullable(),
  amount: z.number({ error: 'amount must be a number' })
    .positive('amount must be a positive number')
    .max(1_000_000, 'amount exceeds maximum allowed value'),
  breakdown: z.record(z.any()).optional().nullable(),
  notes: z.string().trim().max(2000, 'notes must be 2000 characters or fewer').optional().nullable(),
});

// ── Helpers ──────────────────────────────────────────────────────────────────

// Resolve the reporting period. Defaults to the current calendar month.
function resolvePeriod(start, end) {
  if (start && end) return { start, end };
  const now = new Date();
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  const first = new Date(Date.UTC(y, m, 1));
  const last = new Date(Date.UTC(y, m + 1, 0));
  return {
    start: first.toISOString().slice(0, 10),
    end: last.toISOString().slice(0, 10),
  };
}

// Verify req.user owns the gym a given staff member belongs to. Returns the
// staff member's gym_id if owned, or null otherwise. Mirrors staffRoutes.js's
// verifyStaffOwnership() (not exported from that file, so duplicated here —
// same precedent as trainerEarningsRoutes.js keeping its own local `ownsGym`).
async function getOwnedStaffGymId(staffId, ownerId) {
  const { data, error } = await supabase
    .from('gym_staff')
    .select('id, gym_id, gyms!gym_staff_gym_id_fkey(owner_id)')
    .eq('id', staffId)
    .maybeSingle();
  if (error) throw error;
  if (!data || data.gyms?.owner_id !== ownerId) return null;
  return data.gym_id;
}

// Unlike trainers (active_clients/sessions_count auto-tracked), staff have no
// activity table to compute an amount from. Only the `fixed` model supports an
// auto-computed "amount owed" (the monthly rate); `hourly` has no outstanding
// concept since hours are entered manually at payout time, not tracked.
function computeAmount(rate) {
  if (!rate) return null;
  if (rate.model === 'fixed') return Number(rate.monthly_rate) || 0;
  return null;
}

// ── Owner-facing routes ────────────────────────────────────────────────────────

// GET /api/staff-earnings/owner/:gymId/summary?start=&end=
router.get('/owner/:gymId/summary', authenticateToken, requireGymOwner, async (req, res) => {
  try {
    const { gymId } = req.params;
    const { start, end } = resolvePeriod(req.query.start, req.query.end);

    const { data: staffRows, error: sErr } = await supabase
      .from('gym_staff')
      .select('id, role_label, users!gym_staff_user_id_fkey(full_name)')
      .eq('gym_id', gymId)
      .eq('is_active', true);
    if (sErr) throw sErr;

    const summary = [];
    for (const s of staffRows || []) {
      const { data: rate } = await supabase
        .from('staff_payment_rates')
        .select('model, monthly_rate, hourly_rate')
        .eq('gym_id', gymId)
        .eq('staff_id', s.id)
        .maybeSingle();

      const { data: payouts } = await supabase
        .from('staff_payouts')
        .select('amount')
        .eq('gym_id', gymId)
        .eq('staff_id', s.id)
        .gte('paid_at', `${start}T00:00:00Z`)
        .lte('paid_at', `${end}T23:59:59Z`);

      const computed = computeAmount(rate);
      const paid = (payouts || []).reduce((sum, p) => sum + (Number(p.amount) || 0), 0);

      summary.push({
        staff_id: s.id,
        full_name: s.users?.full_name || null,
        role_label: s.role_label,
        model: rate?.model || null,
        monthly_rate: rate ? Number(rate.monthly_rate) || 0 : 0,
        hourly_rate: rate ? Number(rate.hourly_rate) || 0 : 0,
        computed_amount: computed,
        paid_amount: paid,
        outstanding: computed != null ? Math.max(0, computed - paid) : null,
      });
    }

    res.json(summary);
  } catch (err) {
    console.error('GET /api/staff-earnings/owner/:gymId/summary error:', err);
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/staff-earnings/rate/:staffId
router.put('/rate/:staffId', authenticateToken, async (req, res) => {
  try {
    const { staffId } = req.params;
    const { model, monthly_rate, hourly_rate } = req.body || {};
    if (!model || !['fixed', 'hourly'].includes(model)) {
      return res.status(400).json({ error: 'model must be "fixed" or "hourly"' });
    }

    const gymId = await getOwnedStaffGymId(staffId, req.user.id);
    if (!gymId) return res.status(403).json({ error: 'You do not manage this staff member' });

    const { data, error } = await supabase
      .from('staff_payment_rates')
      .upsert(
        {
          gym_id: gymId,
          staff_id: staffId,
          model,
          monthly_rate: model === 'fixed' && monthly_rate != null ? Number(monthly_rate) : null,
          hourly_rate: model === 'hourly' && hourly_rate != null ? Number(hourly_rate) : null,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'gym_id,staff_id' }
      )
      .select()
      .single();
    if (error) throw error;

    res.json(data);
  } catch (err) {
    console.error('PUT /api/staff-earnings/rate/:staffId error:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/staff-earnings/payout
router.post('/payout', authenticateToken, validate(payoutSchema), async (req, res) => {
  try {
    const { staffId, period_start, period_end, amount, breakdown, notes } = req.body;

    const gymId = await getOwnedStaffGymId(staffId, req.user.id);
    if (!gymId) return res.status(403).json({ error: 'You do not manage this staff member' });

    const { data, error } = await supabase
      .from('staff_payouts')
      .insert({
        gym_id: gymId,
        staff_id: staffId,
        period_start: period_start || null,
        period_end: period_end || null,
        amount,
        breakdown: breakdown || null,
        notes: notes || null,
        status: 'paid',
        paid_at: new Date().toISOString(),
      })
      .select()
      .single();
    if (error) throw error;

    res.json(data);
  } catch (err) {
    console.error('POST /api/staff-earnings/payout error:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/staff-earnings/owner/:gymId/payouts?start=&end=
router.get('/owner/:gymId/payouts', authenticateToken, requireGymOwner, async (req, res) => {
  try {
    const { gymId } = req.params;
    const { start, end } = resolvePeriod(req.query.start, req.query.end);

    const { data: payouts, error } = await supabase
      .from('staff_payouts')
      .select('*')
      .eq('gym_id', gymId)
      .gte('paid_at', `${start}T00:00:00Z`)
      .lte('paid_at', `${end}T23:59:59Z`)
      .order('paid_at', { ascending: false });
    if (error) throw error;

    // staff_id FKs to gym_staff (not users directly), so join names manually.
    const staffIds = [...new Set((payouts || []).map((p) => p.staff_id))];
    let namesByStaffId = {};
    if (staffIds.length) {
      const { data: staffRows, error: sErr } = await supabase
        .from('gym_staff')
        .select('id, users!gym_staff_user_id_fkey(full_name)')
        .in('id', staffIds);
      if (sErr) throw sErr;
      for (const s of staffRows || []) namesByStaffId[s.id] = s.users?.full_name || null;
    }

    const result = (payouts || []).map((p) => ({
      ...p,
      staff: { id: p.staff_id, full_name: namesByStaffId[p.staff_id] || null },
    }));

    res.json(result);
  } catch (err) {
    console.error('GET /api/staff-earnings/owner/:gymId/payouts error:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
