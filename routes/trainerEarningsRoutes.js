const express = require('express');
const { z } = require('zod');
const { createClient } = require('@supabase/supabase-js');
const { validate } = require('../src/utils/validate');
const { auth } = require('../middleware/auth');

const router = express.Router();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

// Payout amount capped at ₹10,00,000, matching the membership-plan price cap
// in server.js -- amount was previously only checked for `!= null`, so a
// negative number, NaN, or Infinity all passed through straight into the
// payouts ledger (NaN/Infinity silently became `null` on JSON serialization;
// a negative amount was inserted as-is).
const payoutSchema = z.object({
  gymId: z.string().min(1, 'gymId is required'),
  trainerId: z.string().min(1, 'trainerId is required'),
  period_start: z.string().optional().nullable(),
  period_end: z.string().optional().nullable(),
  amount: z.number({ error: 'amount must be a number' })
    .positive('amount must be a positive number')
    .max(1_000_000, 'amount exceeds maximum allowed value'),
  breakdown: z.record(z.any()).optional().nullable(),
  notes: z.string().trim().max(2000, 'notes must be 2000 characters or fewer').optional().nullable(),
});

// ── Middleware ───────────────────────────────────────────────────────────────

// Verify req.user owns the gym identified by `gymId` (param or body).
async function ownsGym(userId, gymId) {
  if (!gymId) return false;
  const { data, error } = await supabase
    .from('gyms')
    .select('id')
    .eq('id', gymId)
    .eq('owner_id', userId)
    .maybeSingle();
  if (error) throw error;
  return !!data;
}

function requireGymOwnerParam(req, res, next) {
  ownsGym(req.user.id, req.params.gymId)
    .then((ok) => {
      if (!ok) return res.status(403).json({ error: 'You do not own this gym' });
      next();
    })
    .catch((err) => res.status(500).json({ error: err.message }));
}

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

// Map a list of user ids -> full_name via public.users (de-duped, null-safe).
async function fetchUserNames(ids) {
  const unique = [...new Set((ids || []).filter(Boolean))];
  if (unique.length === 0) return {};
  const { data, error } = await supabase
    .from('users')
    .select('id, full_name')
    .in('id', unique);
  if (error) throw error;
  const map = {};
  for (const u of data || []) map[u.id] = u.full_name;
  return map;
}

function modelIncludesClient(model) {
  return model === 'per_client' || model === 'hybrid' || model === 'both';
}

function modelIncludesSession(model) {
  return model === 'per_session' || model === 'hybrid' || model === 'both';
}

// Compute amount owed for a single trainer given their rate + counts.
function computeAmount(rate, activeClients, sessionsCount) {
  const model = rate?.model || 'per_client';
  const perClient = Number(rate?.per_client_rate) || 0;
  const perSession = Number(rate?.per_session_rate) || 0;
  const clientEarnings = modelIncludesClient(model) ? activeClients * perClient : 0;
  const sessionEarnings = modelIncludesSession(model) ? sessionsCount * perSession : 0;
  return clientEarnings + sessionEarnings;
}

// ── Owner-facing routes ────────────────────────────────────────────────────────

// GET /api/trainer-earnings/owner/:gymId/summary?start=&end=
router.get('/owner/:gymId/summary', auth, requireGymOwnerParam, async (req, res) => {
  try {
    const { gymId } = req.params;
    const { start, end } = resolvePeriod(req.query.start, req.query.end);

    // Trainers affiliated with this gym
    const { data: trainers, error: tErr } = await supabase
      .from('trainer_profiles')
      .select('id, user_id, user:users!trainer_profiles_user_id_fkey(id, full_name)')
      .eq('gym_id', gymId);
    if (tErr) throw tErr;

    const summary = [];
    for (const t of trainers || []) {
      const trainerId = t.user_id;

      // Rate
      const { data: rate } = await supabase
        .from('trainer_payment_rates')
        .select('model, per_client_rate, per_session_rate')
        .eq('gym_id', gymId)
        .eq('trainer_id', trainerId)
        .maybeSingle();

      // Active clients
      const { count: activeClients } = await supabase
        .from('trainer_clients')
        .select('id', { count: 'exact', head: true })
        .eq('trainer_id', trainerId)
        .eq('status', 'active');

      // Sessions in period
      const { count: sessionsCount } = await supabase
        .from('trainer_sessions')
        .select('id', { count: 'exact', head: true })
        .eq('gym_id', gymId)
        .eq('trainer_id', trainerId)
        .gte('session_date', start)
        .lte('session_date', end);

      // Payouts already paid in this period
      const { data: payouts } = await supabase
        .from('trainer_payouts')
        .select('amount')
        .eq('gym_id', gymId)
        .eq('trainer_id', trainerId)
        .gte('paid_at', `${start}T00:00:00Z`)
        .lte('paid_at', `${end}T23:59:59Z`);

      const ac = activeClients || 0;
      const sc = sessionsCount || 0;
      const computed = computeAmount(rate, ac, sc);
      const paid = (payouts || []).reduce((sum, p) => sum + (Number(p.amount) || 0), 0);

      summary.push({
        trainer_id: trainerId,
        full_name: t.user?.full_name || null,
        model: rate?.model || null,
        per_client_rate: rate ? Number(rate.per_client_rate) || 0 : 0,
        per_session_rate: rate ? Number(rate.per_session_rate) || 0 : 0,
        active_clients: ac,
        sessions_count: sc,
        computed_amount: computed,
        paid_amount: paid,
        outstanding: Math.max(0, computed - paid),
      });
    }

    res.json(summary);
  } catch (err) {
    console.error('GET /api/trainer-earnings/owner/:gymId/summary error:', err);
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/trainer-earnings/rate/:trainerId
router.put('/rate/:trainerId', auth, async (req, res) => {
  try {
    const { trainerId } = req.params;
    const { gymId, model, per_client_rate, per_session_rate } = req.body || {};
    if (!gymId) return res.status(400).json({ error: 'gymId is required' });
    if (!model) return res.status(400).json({ error: 'model is required' });

    if (!(await ownsGym(req.user.id, gymId))) {
      return res.status(403).json({ error: 'You do not own this gym' });
    }

    const { data, error } = await supabase
      .from('trainer_payment_rates')
      .upsert(
        {
          gym_id: gymId,
          trainer_id: trainerId,
          model,
          per_client_rate: per_client_rate != null ? Number(per_client_rate) : null,
          per_session_rate: per_session_rate != null ? Number(per_session_rate) : null,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'gym_id,trainer_id' }
      )
      .select()
      .single();
    if (error) throw error;

    res.json(data);
  } catch (err) {
    console.error('PUT /api/trainer-earnings/rate/:trainerId error:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/trainer-earnings/payout
router.post('/payout', auth, validate(payoutSchema), async (req, res) => {
  try {
    const { gymId, trainerId, period_start, period_end, amount, breakdown, notes } = req.body;

    if (!(await ownsGym(req.user.id, gymId))) {
      return res.status(403).json({ error: 'You do not own this gym' });
    }

    const { data, error } = await supabase
      .from('trainer_payouts')
      .insert({
        gym_id: gymId,
        trainer_id: trainerId,
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
    console.error('POST /api/trainer-earnings/payout error:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/trainer-earnings/owner/:gymId/payouts?start=&end=
router.get('/owner/:gymId/payouts', auth, requireGymOwnerParam, async (req, res) => {
  try {
    const { gymId } = req.params;
    const { start, end } = resolvePeriod(req.query.start, req.query.end);

    const { data: payouts, error } = await supabase
      .from('trainer_payouts')
      .select('*')
      .eq('gym_id', gymId)
      .gte('paid_at', `${start}T00:00:00Z`)
      .lte('paid_at', `${end}T23:59:59Z`)
      .order('paid_at', { ascending: false });
    if (error) throw error;

    // trainer_id FKs to auth.users, so join names from public.users manually.
    const names = await fetchUserNames((payouts || []).map((p) => p.trainer_id));
    const result = (payouts || []).map((p) => ({
      ...p,
      trainer: { id: p.trainer_id, full_name: names[p.trainer_id] || null },
    }));

    res.json(result);
  } catch (err) {
    console.error('GET /api/trainer-earnings/owner/:gymId/payouts error:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/trainer-earnings/session
// Caller must be the trainer themselves OR the owner of gymId.
router.post('/session', auth, async (req, res) => {
  try {
    const { gymId, trainerId, clientId, session_date, duration_minutes, notes } = req.body || {};
    if (!trainerId) return res.status(400).json({ error: 'trainerId is required' });
    if (!session_date) return res.status(400).json({ error: 'session_date is required' });

    const isTrainer = req.user.id === trainerId;
    const isOwner = gymId ? await ownsGym(req.user.id, gymId) : false;
    if (!isTrainer && !isOwner) {
      return res.status(403).json({ error: 'Not authorized to log this session' });
    }

    const { data, error } = await supabase
      .from('trainer_sessions')
      .insert({
        gym_id: gymId || null,
        trainer_id: trainerId,
        client_id: clientId || null,
        session_date,
        duration_minutes: duration_minutes != null ? Number(duration_minutes) : null,
        notes: notes || null,
      })
      .select()
      .single();
    if (error) throw error;

    res.json(data);
  } catch (err) {
    console.error('POST /api/trainer-earnings/session error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ── Trainer-facing routes ───────────────────────────────────────────────────────

// GET /api/trainer-earnings/me?start=&end=
router.get('/me', auth, async (req, res) => {
  try {
    const trainerId = req.user.id;
    const { start, end } = resolvePeriod(req.query.start, req.query.end);

    // Own rate
    const { data: rate } = await supabase
      .from('trainer_payment_rates')
      .select('model, per_client_rate, per_session_rate')
      .eq('trainer_id', trainerId)
      .maybeSingle();

    // Active clients
    const { count: activeClients } = await supabase
      .from('trainer_clients')
      .select('id', { count: 'exact', head: true })
      .eq('trainer_id', trainerId)
      .eq('status', 'active');

    // Sessions in period
    const { count: sessionsCount } = await supabase
      .from('trainer_sessions')
      .select('id', { count: 'exact', head: true })
      .eq('trainer_id', trainerId)
      .gte('session_date', start)
      .lte('session_date', end);

    // Payouts received in period
    const { data: payouts } = await supabase
      .from('trainer_payouts')
      .select('amount')
      .eq('trainer_id', trainerId)
      .gte('paid_at', `${start}T00:00:00Z`)
      .lte('paid_at', `${end}T23:59:59Z`);

    const ac = activeClients || 0;
    const sc = sessionsCount || 0;
    const computed = computeAmount(rate, ac, sc);
    const paid = (payouts || []).reduce((sum, p) => sum + (Number(p.amount) || 0), 0);

    res.json({
      rate: rate || null,
      active_clients: ac,
      sessions_count: sc,
      computed_amount: computed,
      paid_amount: paid,
      pending_amount: Math.max(0, computed - paid),
      period: { start, end },
    });
  } catch (err) {
    console.error('GET /api/trainer-earnings/me error:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/trainer-earnings/me/sessions?start=&end=
router.get('/me/sessions', auth, async (req, res) => {
  try {
    const trainerId = req.user.id;
    const { start, end } = resolvePeriod(req.query.start, req.query.end);

    const { data: sessions, error } = await supabase
      .from('trainer_sessions')
      .select('*')
      .eq('trainer_id', trainerId)
      .gte('session_date', start)
      .lte('session_date', end)
      .order('session_date', { ascending: false });
    if (error) throw error;

    // client_id FKs to auth.users, so join names from public.users manually.
    const names = await fetchUserNames((sessions || []).map((s) => s.client_id));
    const result = (sessions || []).map((s) => ({
      ...s,
      client: s.client_id ? { id: s.client_id, full_name: names[s.client_id] || null } : null,
    }));

    res.json(result);
  } catch (err) {
    console.error('GET /api/trainer-earnings/me/sessions error:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/trainer-earnings/me/payouts
router.get('/me/payouts', auth, async (req, res) => {
  try {
    const trainerId = req.user.id;

    const { data, error } = await supabase
      .from('trainer_payouts')
      .select('*')
      .eq('trainer_id', trainerId)
      .order('paid_at', { ascending: false });
    if (error) throw error;

    res.json(data || []);
  } catch (err) {
    console.error('GET /api/trainer-earnings/me/payouts error:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
