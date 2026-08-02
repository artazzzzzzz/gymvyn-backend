const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const { auth } = require('../middleware/auth');
const { ensureXPProfile, useFreeze, calculateMuscleBalance } = require('../src/services/xpEngine');
const { LEVEL_THRESHOLDS } = require('../src/utils/xpCalculator');

const router = express.Router();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const LEVEL_NAMES = {
  1: 'Rookie',  2: 'Rookie',  3: 'Rookie',
  4: 'Iron',    5: 'Iron',    6: 'Iron',    7: 'Iron',
  8: 'Steel',   9: 'Steel',   10: 'Steel',  11: 'Steel',
  12: 'Titan',  13: 'Titan',  14: 'Titan',  15: 'Titan',
  16: 'Forge',  17: 'Forge',  18: 'Forge',  19: 'Forge',
  20: 'Forgemaster',
};

function mondayOfCurrentWeek() {
  const d = new Date();
  const day = d.getDay(); // 0=Sun
  const diff = day === 0 ? 6 : day - 1;
  d.setDate(d.getDate() - diff);
  return d.toISOString().split('T')[0];
}

// GET /api/xp/profile — get user's XP profile
router.get('/profile', auth, async (req, res) => {
  try {
    const row = await ensureXPProfile(supabase, req.user.id);
    const level = row.level || 1;
    const nextLevel = level < 20 ? level + 1 : null;
    res.json({
      totalXP: row.total_xp || 0,
      level,
      levelName: LEVEL_NAMES[level] || 'Rookie',
      currentStreak: row.current_streak || 0,
      longestStreak: row.longest_streak || 0,
      streakMultiplier: row.streak_multiplier || 1,
      lastActiveDate: row.last_active_date || null,
      freezesRemaining: row.freezes_remaining ?? 0,
      nextLevelXP: nextLevel ? (LEVEL_THRESHOLDS[nextLevel] ?? null) : null,
    });
  } catch (err) {
    console.error('GET /api/xp/profile error:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/xp/events — get user's XP event history (paginated)
router.get('/events', auth, async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit) || 30));
    const offset = (page - 1) * limit;

    const { data: events, error } = await supabase
      .from('xp_events')
      .select('id, source, action, base_xp, multiplier, final_xp, metadata, created_at')
      .eq('user_id', req.user.id)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) throw error;
    res.json({ events: events || [], page, hasMore: (events || []).length === limit });
  } catch (err) {
    console.error('GET /api/xp/events error:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/xp/leaderboard/:type — type is 'gym' or 'global'
router.get('/leaderboard/:type', (req, res) => {
  res.status(501).json({ message: 'Not implemented' });
});

// POST /api/xp/freeze — use a streak freeze
router.post('/freeze', auth, async (req, res) => {
  try {
    const result = await useFreeze(supabase, req.user.id);
    if (!result.success) return res.status(400).json({ error: result.reason });
    res.json(result);
  } catch (err) {
    console.error('POST /api/xp/freeze error:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/xp/challenges — get current week's challenges
router.get('/challenges', auth, async (req, res) => {
  try {
    const weekStart = mondayOfCurrentWeek();
    const { data: challenges, error } = await supabase
      .from('weekly_challenges')
      .select('id, challenge_type, title, description, target_value, current_value, completed, reward_xp, week_start')
      .eq('user_id', req.user.id)
      .eq('week_start', weekStart)
      .order('completed', { ascending: true });

    if (error) throw error;
    res.json({ challenges: challenges || [] });
  } catch (err) {
    console.error('GET /api/xp/challenges error:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/xp/muscle-balance — get 7-day muscle group coverage
router.get('/muscle-balance', auth, async (req, res) => {
  try {
    const result = await calculateMuscleBalance(supabase, req.user.id);
    res.json(result);
  } catch (err) {
    console.error('GET /api/xp/muscle-balance error:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/xp/season — get current active season info
router.get('/season', (req, res) => {
  res.status(501).json({ message: 'Not implemented' });
});

module.exports = router;
