const express = require('express');
const { createClient } = require('@supabase/supabase-js');

const router = express.Router();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

// ── 1RM helper ────────────────────────────────────────────────────────────────
const estimate1RM = (weight, reps) =>
  reps === 1 ? weight : Math.round(weight * (1 + reps / 30));

// ── Auth middleware ───────────────────────────────────────────────────────────
async function auth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Missing auth token' });

  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data?.user) return res.status(401).json({ error: 'Invalid auth token' });

  req.user = data.user;
  next();
}

// ── GET /api/exercises/:name/metadata ────────────────────────────────────────
router.get('/:name/metadata', async (req, res) => {
  const name = decodeURIComponent(req.params.name);
  const { data, error } = await supabase
    .from('exercise_metadata')
    .select('video_url, thumbnail_url, video_duration')
    .eq('exercise_name', name)
    .maybeSingle();

  if (error) return res.status(500).json({ error: error.message });
  return res.json({ data: data || null });
});

// ── GET /api/exercises/:name/stats ────────────────────────────────────────────
router.get('/:name/stats', auth, async (req, res) => {
  const name = decodeURIComponent(req.params.name);

  const { data: logs, error } = await supabase
    .from('workout_logs')
    .select('completed_at, exercises')
    .eq('user_id', req.user.id)
    .filter('exercises', 'cs', JSON.stringify([{ name }]));

  if (error) return res.status(500).json({ error: error.message });
  if (!logs || logs.length === 0) return res.json({ data: null });

  let heaviest_weight = 0;
  let best_1rm = 0;
  let total_sets = 0;
  let best_session_volume = 0;
  let personal_best = null;
  const chart_data = [];

  for (const log of logs) {
    const exercises = Array.isArray(log.exercises) ? log.exercises : [];
    const matching = exercises.filter(e => e.name === name);

    let session_volume = 0;
    for (const ex of matching) {
      const sets = Array.isArray(ex.sets) ? ex.sets : [];
      for (const set of sets) {
        const w = parseFloat(set.weight_kg) || 0;
        const r = parseInt(set.reps_completed) || 0;
        if (!w || !r) continue;

        total_sets++;
        session_volume += w * r;

        if (w > heaviest_weight) heaviest_weight = w;

        const rm = estimate1RM(w, r);
        if (rm > best_1rm) {
          best_1rm = rm;
          personal_best = { weight: w, reps: r, est_1rm: rm, date: log.completed_at };
        }
      }
    }

    if (session_volume > best_session_volume) best_session_volume = session_volume;

    const sessionMaxWeight = matching
      .flatMap(e => (e.sets || []).map(s => parseFloat(s.weight_kg) || 0))
      .reduce((max, v) => Math.max(max, v), 0);
    const sessionMaxRM = matching
      .flatMap(e => (e.sets || []).map(s => estimate1RM(parseFloat(s.weight_kg) || 0, parseInt(s.reps_completed) || 0)))
      .reduce((max, v) => Math.max(max, v), 0);

    chart_data.push({
      date: log.completed_at,
      heaviest: sessionMaxWeight,
      est_1rm: sessionMaxRM,
      volume: session_volume,
    });
  }

  chart_data.sort((a, b) => new Date(a.date) - new Date(b.date));

  return res.json({
    data: {
      heaviest_weight,
      best_1rm,
      total_sets,
      best_session_volume,
      personal_best,
      chart_data,
    },
  });
});

// ── GET /api/exercises/:name/history ─────────────────────────────────────────
router.get('/:name/history', auth, async (req, res) => {
  const name = decodeURIComponent(req.params.name);
  const page = parseInt(req.query.page) || 0;
  const limit = parseInt(req.query.limit) || 10;
  const from = page * limit;
  const to = from + limit - 1;

  const { data: logs, error, count } = await supabase
    .from('workout_logs')
    .select('id, completed_at, exercises', { count: 'exact' })
    .eq('user_id', req.user.id)
    .filter('exercises', 'cs', JSON.stringify([{ name }]))
    .order('completed_at', { ascending: false })
    .range(from, to);

  if (error) return res.status(500).json({ error: error.message });

  // Find personal best 1RM across this page for PR flagging
  let overallBest1RM = 0;
  for (const log of logs || []) {
    const exercises = Array.isArray(log.exercises) ? log.exercises : [];
    for (const ex of exercises.filter(e => e.name === name)) {
      for (const set of (ex.sets || [])) {
        const rm = estimate1RM(parseFloat(set.weight_kg) || 0, parseInt(set.reps_completed) || 0);
        if (rm > overallBest1RM) overallBest1RM = rm;
      }
    }
  }

  const sessions = (logs || []).map(log => {
    const exercises = Array.isArray(log.exercises) ? log.exercises : [];
    const matching = exercises.filter(e => e.name === name);
    const allSets = matching.flatMap(ex => (ex.sets || []));

    let volume = 0;
    const setsWithPR = allSets.map((set, idx) => {
      const w = parseFloat(set.weight_kg) || 0;
      const r = parseInt(set.reps_completed) || 0;
      volume += w * r;
      const rm = estimate1RM(w, r);
      return {
        index: idx + 1,
        weight: w,
        reps: r,
        is_pr: rm === overallBest1RM && overallBest1RM > 0,
      };
    });

    return {
      id: log.id,
      date: log.completed_at,
      sets_count: allSets.length,
      volume,
      sets: setsWithPR,
    };
  });

  return res.json({ data: sessions, total: count || 0, page, limit });
});

// ── GET /api/exercises/:name/bookmark ────────────────────────────────────────
router.get('/:name/bookmark', auth, async (req, res) => {
  const name = decodeURIComponent(req.params.name);
  const { data, error } = await supabase
    .from('exercise_bookmarks')
    .select('id')
    .eq('user_id', req.user.id)
    .eq('exercise_name', name)
    .maybeSingle();

  if (error) return res.status(500).json({ error: error.message });
  return res.json({ bookmarked: !!data });
});

// ── POST /api/exercises/:name/bookmark ───────────────────────────────────────
router.post('/:name/bookmark', auth, async (req, res) => {
  const name = decodeURIComponent(req.params.name);
  const { error } = await supabase
    .from('exercise_bookmarks')
    .upsert({ user_id: req.user.id, exercise_name: name }, { onConflict: 'user_id,exercise_name' });

  if (error) return res.status(500).json({ error: error.message });
  return res.json({ bookmarked: true });
});

// ── DELETE /api/exercises/:name/bookmark ─────────────────────────────────────
router.delete('/:name/bookmark', auth, async (req, res) => {
  const name = decodeURIComponent(req.params.name);
  const { error } = await supabase
    .from('exercise_bookmarks')
    .delete()
    .eq('user_id', req.user.id)
    .eq('exercise_name', name);

  if (error) return res.status(500).json({ error: error.message });
  return res.json({ bookmarked: false });
});

module.exports = router;
