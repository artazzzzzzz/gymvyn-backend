const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const { deactivateOtherGymMemberships } = require('../src/utils/relationshipAuth');
const { auth } = require('../middleware/auth');

const router = express.Router();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

// GET /api/gym/join-code — gym owner gets their gym's join code
router.get('/join-code', auth, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('gyms')
      .select('join_code')
      .eq('owner_id', req.user.id)
      .eq('is_active', true)
      .maybeSingle();

    if (error) throw error;
    if (!data) return res.status(404).json({ error: 'No gym found for this owner' });

    if (!data.join_code) {
      const code = Math.random().toString(36).substring(2, 8).toUpperCase();
      await supabase.from('gyms').update({ join_code: code }).eq('owner_id', req.user.id);
      data.join_code = code;
    }

    res.json({ join_code: data.join_code });
  } catch (err) {
    console.error('GET /api/gym/join-code error:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/gym/my-gym-code — gym owner gets join code + gym info
router.get('/my-gym-code', auth, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('gyms')
      .select('id, name, join_code')
      .eq('owner_id', req.user.id)
      .eq('is_active', true)
      .maybeSingle();

    if (error) throw error;
    if (!data) return res.status(404).json({ error: 'No gym found for this owner' });

    if (!data.join_code) {
      const code = Math.random().toString(36).substring(2, 8).toUpperCase();
      await supabase.from('gyms').update({ join_code: code }).eq('id', data.id);
      data.join_code = code;
    }

    res.json({ join_code: data.join_code, gym_name: data.name, gym_id: data.id });
  } catch (err) {
    console.error('GET /api/gym/my-gym-code error:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/gym/join — consumer joins a gym by code
router.post('/join', auth, async (req, res) => {
  try {
    const { join_code } = req.body;
    if (!join_code) return res.status(400).json({ error: 'join_code is required' });

    const { data: gym, error: gymErr } = await supabase
      .from('gyms')
      .select('id, name')
      .eq('join_code', join_code.trim().toUpperCase())
      .eq('is_active', true)
      .maybeSingle();

    if (gymErr) throw gymErr;
    if (!gym) return res.status(400).json({ error: 'Invalid gym code' });

    // gym_memberships is the source of truth for "is this user a member of this
    // gym" (owner's member list, My Gym tab). Write it BEFORE users.gym_id so a
    // failed membership insert can never leave users.gym_id pointing at a gym
    // the user isn't actually a member of.
    const { data: existingMembership, error: memLookupErr } = await supabase
      .from('gym_memberships')
      .select('id, status')
      .eq('gym_id', gym.id)
      .eq('user_id', req.user.id)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (memLookupErr) throw memLookupErr;

    await deactivateOtherGymMemberships(supabase, req.user.id, gym.id);

    if (!existingMembership) {
      const { error: memErr } = await supabase
        .from('gym_memberships')
        .insert({
          gym_id: gym.id,
          user_id: req.user.id,
          status: 'active',
          start_date: new Date().toISOString().slice(0, 10),
          metadata: { source: 'join_code' },
        });
      if (memErr) throw memErr;
    } else if (existingMembership.status !== 'active') {
      // Row exists but is inactive (this member unlinked before) — reactivate
      // it instead of silently no-op'ing, so rejoining actually works.
      // end_date is NOT NULL, so mirror the same 30-day default a fresh
      // join_code insert gets.
      const freshStart = new Date().toISOString().slice(0, 10);
      const freshEnd = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
      const { error: reactivateErr } = await supabase
        .from('gym_memberships')
        .update({
          status: 'active',
          start_date: freshStart,
          end_date: freshEnd,
          updated_at: new Date().toISOString(),
        })
        .eq('id', existingMembership.id);
      if (reactivateErr) throw reactivateErr;
    }

    const { error: updateErr } = await supabase
      .from('users')
      .update({ gym_id: gym.id })
      .eq('id', req.user.id);

    if (updateErr) throw updateErr;

    res.json({ success: true, gym_id: gym.id, gym_name: gym.name });
  } catch (err) {
    console.error('POST /api/gym/join error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ── Trainer-initiated "Join Gym by Code" ────────────────────────────────────
// Separate from gyms.join_code (member self-join) so the two flows can never
// cross-consume each other's code. Approval-gated: trainer_profiles.gym_id
// stays NULL (pending_gym_id holds the target) until the owner accepts here.

// GET /api/gym/trainer-join-code — gym owner gets/generates the trainer code
router.get('/trainer-join-code', auth, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('gyms')
      .select('id, trainer_join_code')
      .eq('owner_id', req.user.id)
      .eq('is_active', true)
      .maybeSingle();

    if (error) throw error;
    if (!data) return res.status(404).json({ error: 'No gym found for this owner' });

    if (!data.trainer_join_code) {
      const code = Math.random().toString(36).substring(2, 8).toUpperCase();
      await supabase.from('gyms').update({ trainer_join_code: code }).eq('id', data.id);
      data.trainer_join_code = code;
    }

    res.json({ trainer_join_code: data.trainer_join_code });
  } catch (err) {
    console.error('GET /api/gym/trainer-join-code error:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/gym/trainer-join-requests — gym owner lists pending trainer requests
router.get('/trainer-join-requests', auth, async (req, res) => {
  try {
    const { data: gym, error: gymErr } = await supabase
      .from('gyms')
      .select('id')
      .eq('owner_id', req.user.id)
      .eq('is_active', true)
      .maybeSingle();
    if (gymErr) throw gymErr;
    if (!gym) return res.status(404).json({ error: 'No gym found for this owner' });

    const { data: pending, error: pendingErr } = await supabase
      .from('trainer_profiles')
      .select('id, user_id, bio, specializations, experience_years, updated_at')
      .eq('pending_gym_id', gym.id);
    if (pendingErr) throw pendingErr;

    const userIds = (pending || []).map(p => p.user_id).filter(Boolean);
    let users = [];
    if (userIds.length > 0) {
      const { data: usersData, error: usersErr } = await supabase
        .from('users')
        .select('id, full_name, phone')
        .in('id', userIds);
      if (usersErr) throw usersErr;
      users = usersData || [];
    }
    const userById = new Map(users.map(u => [u.id, u]));

    const requests = (pending || []).map(p => ({
      id: p.id,
      trainer_user_id: p.user_id,
      full_name: userById.get(p.user_id)?.full_name || 'Unknown',
      phone: userById.get(p.user_id)?.phone || null,
      specializations: p.specializations || [],
      experience_years: p.experience_years || 0,
      requested_at: p.updated_at,
    }));

    res.json(requests);
  } catch (err) {
    console.error('GET /api/gym/trainer-join-requests error:', err);
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/gym/trainer-join-requests/:trainerProfileId/accept — approve
router.patch('/trainer-join-requests/:trainerProfileId/accept', auth, async (req, res) => {
  try {
    const { trainerProfileId } = req.params;

    const { data: gym, error: gymErr } = await supabase
      .from('gyms')
      .select('id, name')
      .eq('owner_id', req.user.id)
      .eq('is_active', true)
      .maybeSingle();
    if (gymErr) throw gymErr;
    if (!gym) return res.status(404).json({ error: 'No gym found for this owner' });

    const { data: tp, error: tpErr } = await supabase
      .from('trainer_profiles')
      .select('id, gym_id, pending_gym_id')
      .eq('id', trainerProfileId)
      .maybeSingle();
    if (tpErr) throw tpErr;
    if (!tp) return res.status(404).json({ error: 'Request not found' });

    // Ownership check: the request must actually target this owner's gym.
    if (tp.pending_gym_id !== gym.id) {
      return res.status(404).json({ error: 'Request not found' });
    }

    // One-gym-max: re-check at accept time in case the trainer joined
    // elsewhere between requesting and this approval.
    if (tp.gym_id) {
      return res.status(409).json({ error: 'Trainer already linked to a gym' });
    }

    const { error: updateErr } = await supabase
      .from('trainer_profiles')
      .update({ gym_id: gym.id, pending_gym_id: null, status: 'active', updated_at: new Date().toISOString() })
      .eq('id', trainerProfileId);
    if (updateErr) throw updateErr;

    res.json({ success: true, gym_id: gym.id, gym_name: gym.name });
  } catch (err) {
    console.error('PATCH /api/gym/trainer-join-requests/:trainerProfileId/accept error:', err);
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/gym/trainer-join-requests/:trainerProfileId — decline
router.delete('/trainer-join-requests/:trainerProfileId', auth, async (req, res) => {
  try {
    const { trainerProfileId } = req.params;

    const { data: gym, error: gymErr } = await supabase
      .from('gyms')
      .select('id')
      .eq('owner_id', req.user.id)
      .eq('is_active', true)
      .maybeSingle();
    if (gymErr) throw gymErr;
    if (!gym) return res.status(404).json({ error: 'No gym found for this owner' });

    const { data: tp, error: tpErr } = await supabase
      .from('trainer_profiles')
      .select('id, pending_gym_id')
      .eq('id', trainerProfileId)
      .maybeSingle();
    if (tpErr) throw tpErr;
    if (!tp || tp.pending_gym_id !== gym.id) {
      return res.status(404).json({ error: 'Request not found' });
    }

    const { error: updateErr } = await supabase
      .from('trainer_profiles')
      .update({ pending_gym_id: null, updated_at: new Date().toISOString() })
      .eq('id', trainerProfileId);
    if (updateErr) throw updateErr;

    res.json({ success: true });
  } catch (err) {
    console.error('DELETE /api/gym/trainer-join-requests/:trainerProfileId error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/gym/:gymId/insights — owner-only revenue/occupancy/heatmap ──────

function formatHour12(hour) {
  const period = hour < 12 ? 'A' : 'P';
  let h = hour % 12;
  if (h === 0) h = 12;
  return `${h}${period}`;
}

const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const WEEK_ORDER = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

async function sumPaidAmount(gymId, gte, lt) {
  const { data, error } = await supabase
    .from('payments')
    .select('amount')
    .eq('gym_id', gymId)
    .eq('status', 'paid')
    .gte('paid_at', gte)
    .lt('paid_at', lt);
  if (error) throw error;
  return (data || []).reduce((sum, p) => sum + Number(p.amount), 0);
}

router.get('/:gymId/insights', auth, async (req, res) => {
  try {
    const { gymId } = req.params;

    const { data: gym, error: gymErr } = await supabase
      .from('gyms')
      .select('id')
      .eq('id', gymId)
      .eq('owner_id', req.user.id)
      .maybeSingle();
    if (gymErr) throw gymErr;
    if (!gym) return res.status(404).json({ error: 'No gym found for this owner' });

    const now = new Date();
    const startOfThisMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const startOfNextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    const startOfLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const startOfYear = new Date(now.getFullYear(), 0, 1);
    const monthsElapsed = now.getMonth() + 1;

    // Last 6 months (oldest → newest, including current month).
    const trendMonths = Array.from({ length: 6 }, (_, i) => {
      const d = new Date(now.getFullYear(), now.getMonth() - (5 - i), 1);
      return { start: d, end: new Date(d.getFullYear(), d.getMonth() + 1, 1) };
    });

    const twentyEightDaysAgo = new Date(now.getTime() - 28 * 86400000);

    const [
      thisMonthTotal,
      lastMonthTotal,
      ytdTotal,
      trendTotals,
      checkinsRes,
    ] = await Promise.all([
      sumPaidAmount(gymId, startOfThisMonth.toISOString(), startOfNextMonth.toISOString()),
      sumPaidAmount(gymId, startOfLastMonth.toISOString(), startOfThisMonth.toISOString()),
      sumPaidAmount(gymId, startOfYear.toISOString(), startOfNextMonth.toISOString()),
      Promise.all(trendMonths.map(m => sumPaidAmount(gymId, m.start.toISOString(), m.end.toISOString()))),
      supabase
        .from('check_ins')
        .select('checked_in_at')
        .eq('gym_id', gymId)
        .gte('checked_in_at', twentyEightDaysAgo.toISOString()),
    ]);

    if (checkinsRes.error) throw checkinsRes.error;

    const monthly_trend = trendMonths.map((m, i) => ({
      month: MONTH_LABELS[m.start.getMonth()],
      amount: trendTotals[i],
    }));

    // Heatmap: day-of-week x hour-of-day counts, past 28 days. Zero-filled —
    // no data means zeros, never a fallback to made-up numbers.
    const heatmapCounts = {}; // `${day}|${hour}` -> count
    const weeklyCounts = {}; // day -> count
    WEEK_ORDER.forEach(d => { weeklyCounts[d] = 0; });

    for (const ci of checkinsRes.data || []) {
      if (!ci.checked_in_at) continue;
      const d = new Date(ci.checked_in_at);
      const day = DAY_LABELS[d.getDay()];
      const hour = formatHour12(d.getHours());
      const key = `${day}|${hour}`;
      heatmapCounts[key] = (heatmapCounts[key] || 0) + 1;
      weeklyCounts[day] = (weeklyCounts[day] || 0) + 1;
    }

    const checkin_heatmap = [];
    for (const day of WEEK_ORDER) {
      for (let h = 0; h < 24; h++) {
        const hour = formatHour12(h);
        checkin_heatmap.push({ day, hour, count: heatmapCounts[`${day}|${hour}`] || 0 });
      }
    }

    const occupancy_weekly = WEEK_ORDER.map(day => ({ day, count: weeklyCounts[day] }));

    res.json({
      revenue: {
        this_month: thisMonthTotal,
        last_month: lastMonthTotal,
        avg_per_month: monthsElapsed > 0 ? Math.round(ytdTotal / monthsElapsed) : 0,
        ytd: ytdTotal,
        monthly_trend,
      },
      checkin_heatmap,
      occupancy_weekly,
    });
  } catch (err) {
    console.error('GET /api/gym/:gymId/insights error:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
