const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const { generateWeeklyChallenges } = require('../utils/challengeGenerator');
const {
  ensureXPProfile,
  useFreeze,
  calculateMuscleBalance,
  processCommunityXP,
} = require('../services/xpEngine');
const { XP_CONSTANTS, LEVEL_THRESHOLDS, calculateLevel } = require('../utils/xpCalculator');

const router = express.Router();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

async function auth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Missing auth token' });

  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data?.user) return res.status(401).json({ error: 'Invalid auth token' });

  req.user = data.user;
  next();
}

// ── GET /api/xp/profile ───────────────────────────────────────────────────────

router.get('/profile', auth, async (req, res) => {
  try {
    const profile = await ensureXPProfile(supabase, req.user.id);
    const level = profile.level || 1;
    const levelName = XP_CONSTANTS.LEVEL_NAMES[level] || 'Rookie';
    const nextLevel = level < 20 ? level + 1 : null;
    const nextLevelXP = nextLevel ? (LEVEL_THRESHOLDS[nextLevel] || null) : null;

    res.json({
      totalXP: profile.total_xp,
      level,
      levelName,
      currentStreak: profile.current_streak,
      longestStreak: profile.longest_streak,
      streakMultiplier: profile.streak_multiplier,
      lastActiveDate: profile.last_active_date,
      freezesRemaining: profile.freezes_remaining,
      nextLevelXP,
    });
  } catch (err) {
    console.error('GET /api/xp/profile error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/xp/events ────────────────────────────────────────────────────────

router.get('/events', auth, async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, parseInt(req.query.limit) || 20);
    const from = (page - 1) * limit;
    const to = from + limit - 1;

    const { data, error, count } = await supabase
      .from('xp_events')
      .select('*', { count: 'exact' })
      .eq('user_id', req.user.id)
      .order('created_at', { ascending: false })
      .range(from, to);

    if (error) return res.status(500).json({ error: error.message });

    res.json({
      events: data || [],
      total: count || 0,
      page,
      totalPages: Math.ceil((count || 0) / limit),
    });
  } catch (err) {
    console.error('GET /api/xp/events error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/xp/leaderboard/:type ────────────────────────────────────────────

router.get('/leaderboard/:type', auth, async (req, res) => {
  try {
    const { type } = req.params;
    if (type !== 'gym' && type !== 'global') {
      return res.status(400).json({ error: 'type must be "gym" or "global"' });
    }

    let gymId = null;
    if (type === 'gym') {
      const { data: me } = await supabase
        .from('users')
        .select('gym_id')
        .eq('id', req.user.id)
        .maybeSingle();
      gymId = me?.gym_id;
      if (!gymId) return res.status(400).json({ error: 'You are not linked to a gym' });
    }

    // Fetch top 50 from user_xp joined with users
    let query = supabase
      .from('user_xp')
      .select('user_id, total_xp, level, users!inner(full_name, gym_id)')
      .order('total_xp', { ascending: false })
      .limit(50);

    if (type === 'gym') {
      query = query.eq('users.gym_id', gymId);
    }

    const { data: topRows, error: topErr } = await query;
    if (topErr) return res.status(500).json({ error: topErr.message });

    const leaderboard = (topRows || []).map((row, idx) => ({
      rank: idx + 1,
      userId: row.user_id,
      fullName: row.users?.full_name || 'Unknown',
      totalXP: row.total_xp,
      level: row.level,
      levelName: XP_CONSTANTS.LEVEL_NAMES[row.level] || 'Rookie',
    }));

    // Find requesting user's own rank (if not in top 50)
    const selfInTop = leaderboard.find(r => r.userId === req.user.id);
    let selfRank = null;

    if (!selfInTop) {
      let rankQuery = supabase
        .from('user_xp')
        .select('user_id, total_xp');

      if (type === 'gym') {
        const { data: selfRow } = await supabase
          .from('user_xp')
          .select('total_xp')
          .eq('user_id', req.user.id)
          .maybeSingle();

        if (selfRow) {
          // count rows with more XP in same gym
          const { count } = await supabase
            .from('user_xp')
            .select('user_id, users!inner(gym_id)', { count: 'exact', head: true })
            .eq('users.gym_id', gymId)
            .gt('total_xp', selfRow.total_xp);
          selfRank = { userId: req.user.id, rank: (count || 0) + 1, totalXP: selfRow.total_xp };
        }
      } else {
        const { data: selfRow } = await supabase
          .from('user_xp')
          .select('total_xp')
          .eq('user_id', req.user.id)
          .maybeSingle();

        if (selfRow) {
          const { count } = await supabase
            .from('user_xp')
            .select('user_id', { count: 'exact', head: true })
            .gt('total_xp', selfRow.total_xp);
          selfRank = { userId: req.user.id, rank: (count || 0) + 1, totalXP: selfRow.total_xp };
        }
      }
    }

    res.json({ leaderboard, selfRank: selfInTop || selfRank });
  } catch (err) {
    console.error('GET /api/xp/leaderboard error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/xp/freeze ───────────────────────────────────────────────────────

router.post('/freeze', auth, async (req, res) => {
  try {
    const result = await useFreeze(supabase, req.user.id);
    res.json(result);
  } catch (err) {
    console.error('POST /api/xp/freeze error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/xp/challenges ────────────────────────────────────────────────────

router.get('/challenges', auth, async (req, res) => {
  try {
    const userId = req.user.id;

    // Monday of current week
    const now = new Date();
    const day = now.getDay();
    const diff = day === 0 ? 6 : day - 1;
    const monday = new Date(now);
    monday.setDate(now.getDate() - diff);
    const weekStart = monday.toISOString().split('T')[0];

    const { data: existing, error: fetchErr } = await supabase
      .from('weekly_challenges')
      .select('*')
      .eq('user_id', userId)
      .eq('week_start', weekStart);

    if (fetchErr) return res.status(500).json({ error: fetchErr.message });

    if (existing && existing.length > 0) {
      return res.json({ challenges: existing, weekStart });
    }

    // Generate new challenges from last-week data
    const sevenDaysAgo = new Date(monday);
    sevenDaysAgo.setDate(monday.getDate() - 7);
    const since = sevenDaysAgo.toISOString().split('T')[0];

    const { data: recentLogs } = await supabase
      .from('workout_logs')
      .select('exercises')
      .eq('user_id', userId)
      .gte('completed_at', `${since}T00:00:00.000Z`)
      .lt('completed_at', `${weekStart}T00:00:00.000Z`);

    const { data: recentFood } = await supabase
      .from('food_logs')
      .select('calories, log_date')
      .eq('user_id', userId)
      .gte('log_date', since)
      .lt('log_date', weekStart);

    // Build userData for generator
    const avgE1RM = {};
    let totalWeeklyVolume = 0;

    for (const log of (recentLogs || [])) {
      for (const ex of (log.exercises || [])) {
        let bestE1RM = 0;
        let vol = 0;
        for (const set of (ex.sets || [])) {
          const kg = parseFloat(set.weight_kg || set.kg) || 0;
          const reps = parseInt(set.reps_completed || set.reps) || 0;
          if (!kg || !reps) continue;
          vol += kg * reps;
          const e1rm = kg * (1 + reps / 30);
          if (e1rm > bestE1RM) bestE1RM = e1rm;
        }
        totalWeeklyVolume += vol;
        const key = (ex.name || '').toLowerCase().replace(/\s+/g, '_');
        if (bestE1RM > (avgE1RM[key] || 0)) avgE1RM[key] = Math.round(bestE1RM * 10) / 10;
      }
    }

    const caloriesByDay = {};
    for (const row of (recentFood || [])) {
      caloriesByDay[row.log_date] = (caloriesByDay[row.log_date] || 0) + (parseFloat(row.calories) || 0);
    }
    const calDays = Object.values(caloriesByDay);
    const avgDailyCalories = calDays.length ? Math.round(calDays.reduce((a, b) => a + b, 0) / calDays.length) : 0;

    const userData = {
      avgE1RM,
      avgDailyCalories,
      totalWeeklyVolume,
    };

    const generated = generateWeeklyChallenges(userData);
    const toInsert = generated.map(c => ({
      user_id: userId,
      week_start: weekStart,
      challenge_type: c.challenge_type,
      title: c.title,
      description: c.description,
      target_value: c.target_value,
      xp_reward: c.xp_reward,
      progress: 0,
      completed: false,
    }));

    const { data: inserted, error: insertErr } = await supabase
      .from('weekly_challenges')
      .insert(toInsert)
      .select();

    if (insertErr) return res.status(500).json({ error: insertErr.message });

    res.json({ challenges: inserted || toInsert, weekStart });
  } catch (err) {
    console.error('GET /api/xp/challenges error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/xp/muscle-balance ────────────────────────────────────────────────

router.get('/muscle-balance', auth, async (req, res) => {
  try {
    const result = await calculateMuscleBalance(supabase, req.user.id);
    res.json(result);
  } catch (err) {
    console.error('GET /api/xp/muscle-balance error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/xp/season ────────────────────────────────────────────────────────

router.get('/season', auth, async (req, res) => {
  try {
    const { data: season, error: seasonErr } = await supabase
      .from('challenge_seasons')
      .select('*')
      .eq('is_active', true)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (seasonErr) return res.status(500).json({ error: seasonErr.message });
    if (!season) return res.json({ season: null, participation: null, daysRemaining: 0 });

    const { data: participation } = await supabase
      .from('season_participants')
      .select('*')
      .eq('season_id', season.id)
      .eq('user_id', req.user.id)
      .maybeSingle();

    const endDate = season.end_date ? new Date(season.end_date) : null;
    const daysRemaining = endDate
      ? Math.max(0, Math.ceil((endDate - new Date()) / (1000 * 60 * 60 * 24)))
      : null;

    res.json({ season, participation, daysRemaining });
  } catch (err) {
    console.error('GET /api/xp/season error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/xp/season/create ────────────────────────────────────────────────

router.post('/season/create', auth, async (req, res) => {
  try {
    const { name, startsAt, endsAt } = req.body;
    if (!name || !startsAt || !endsAt) {
      return res.status(400).json({ error: 'name, startsAt, endsAt are required' });
    }

    const { data, error } = await supabase
      .from('challenge_seasons')
      .insert({ name, starts_at: startsAt, ends_at: endsAt, is_active: true })
      .select()
      .single();

    if (error) return res.status(500).json({ error: error.message });
    res.status(201).json(data);
  } catch (err) {
    console.error('POST /api/xp/season/create error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/xp/season/join ──────────────────────────────────────────────────

router.post('/season/join', auth, async (req, res) => {
  try {
    const now = new Date().toISOString();

    const { data: season, error: seasonErr } = await supabase
      .from('challenge_seasons')
      .select('id')
      .eq('is_active', true)
      .lte('starts_at', now)
      .gte('ends_at', now)
      .maybeSingle();

    if (seasonErr) return res.status(500).json({ error: seasonErr.message });
    if (!season) return res.status(400).json({ error: 'No active season' });

    const { data: existing } = await supabase
      .from('season_participants')
      .select('id')
      .eq('season_id', season.id)
      .eq('user_id', req.user.id)
      .maybeSingle();

    if (existing) return res.status(409).json({ error: 'Already joined this season' });

    const { data: userRow } = await supabase
      .from('users')
      .select('gym_id')
      .eq('id', req.user.id)
      .maybeSingle();

    const { data: participation, error: insertErr } = await supabase
      .from('season_participants')
      .insert({
        season_id: season.id,
        user_id: req.user.id,
        gym_id: userRow?.gym_id || null,
        active_days: 0,
        eligible: false,
      })
      .select()
      .single();

    if (insertErr) return res.status(500).json({ error: insertErr.message });
    res.status(201).json(participation);
  } catch (err) {
    console.error('POST /api/xp/season/join error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/xp/season/leaderboard ───────────────────────────────────────────

router.get('/season/leaderboard', auth, async (req, res) => {
  try {
    const type = req.query.type === 'gym' ? 'gym' : 'global';
    const now = new Date().toISOString();

    const { data: season, error: seasonErr } = await supabase
      .from('challenge_seasons')
      .select('id')
      .eq('is_active', true)
      .lte('starts_at', now)
      .gte('ends_at', now)
      .maybeSingle();

    if (seasonErr) return res.status(500).json({ error: seasonErr.message });
    if (!season) return res.status(404).json({ error: 'No active season' });

    let gymId = null;
    if (type === 'gym') {
      const { data: me } = await supabase
        .from('users')
        .select('gym_id')
        .eq('id', req.user.id)
        .maybeSingle();
      gymId = me?.gym_id;
      if (!gymId) return res.status(400).json({ error: 'You are not linked to a gym' });
    }

    let query = supabase
      .from('season_participants')
      .select('user_id, active_days, eligible, user_xp!inner(total_xp, level), users!inner(full_name, gym_id)')
      .eq('season_id', season.id)
      .order('user_xp.total_xp', { ascending: false })
      .limit(50);

    if (type === 'gym') {
      query = query.eq('gym_id', gymId);
    }

    // Only include eligible participants (active_days >= 30) or those approaching eligibility
    query = query.or('eligible.eq.true,active_days.gte.30');

    const { data: rows, error: rankErr } = await query;
    if (rankErr) return res.status(500).json({ error: rankErr.message });

    const leaderboard = (rows || []).map((row, idx) => ({
      rank: idx + 1,
      userId: row.user_id,
      fullName: row.users?.full_name || 'Unknown',
      totalXP: row.user_xp?.total_xp ?? 0,
      level: row.user_xp?.level ?? 1,
      levelName: XP_CONSTANTS.LEVEL_NAMES[row.user_xp?.level ?? 1] || 'Rookie',
      activeDays: row.active_days,
    }));

    res.json({ leaderboard, seasonId: season.id });
  } catch (err) {
    console.error('GET /api/xp/season/leaderboard error:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
