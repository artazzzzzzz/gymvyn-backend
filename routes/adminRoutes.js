const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const { auth, requireAdmin } = require('../middleware/auth');
const { deleteUserCascade } = require('../src/utils/userDeletion');

const router = express.Router();
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

// Every route here runs behind the service-role key, not RLS, so this file
// (not Postgres policy) is the real security boundary -- always keep
// `auth, requireAdmin` on every route added below.
router.use(auth, requireAdmin);

const USER_EDIT_FIELDS = [
  'current_weight', 'height', 'age', 'gender', 'goal', 'experience',
  'activity_level', 'diet_goal', 'calorie_goal', 'protein_goal',
  'carbs_goal', 'fat_goal', 'target_weight', 'training_days',
  'water_goal_ml', 'equipment',
];
const ROLES = ['consumer', 'trainer', 'gym_owner', 'staff'];

// Lets the admin frontend gate itself on the same ADMIN_EMAILS allowlist the
// backend enforces, instead of a hardcoded email baked into the frontend
// bundle. Reaching this route at all already proves `requireAdmin` passed.
router.get('/whoami', async (req, res) => {
  res.json({ email: req.user.email });
});

router.get('/users', async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 20));
    const from = (page - 1) * limit;
    const to = from + limit - 1;

    let query = supabase.from('users').select('id, full_name, role, created_at', { count: 'exact' }).order('created_at', { ascending: false }).range(from, to);
    if (req.query.search) query = query.ilike('full_name', `%${req.query.search}%`);
    if (req.query.role && req.query.role !== 'all') query = query.eq('role', req.query.role);

    const { data, count, error } = await query;
    if (error) throw error;
    const ids = (data || []).map(u => u.id);
    if (ids.length === 0) return res.json({ users: [], total: count ?? 0 });

    const [{ data: wl }, { data: fl }] = await Promise.all([
      supabase.from('workout_logs').select('user_id').in('user_id', ids),
      supabase.from('food_logs').select('user_id').in('user_id', ids),
    ]);
    const wlMap = {}, flMap = {};
    (wl || []).forEach(r => { wlMap[r.user_id] = (wlMap[r.user_id] || 0) + 1; });
    (fl || []).forEach(r => { flMap[r.user_id] = (flMap[r.user_id] || 0) + 1; });

    res.json({
      users: data.map(u => ({ ...u, workoutCount: wlMap[u.id] || 0, foodCount: flMap[u.id] || 0 })),
      total: count ?? 0,
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/users/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    const sevenAgo = new Date();
    sevenAgo.setDate(sevenAgo.getDate() - 7);
    const sevenAgoStr = sevenAgo.toISOString().split('T')[0];

    const [
      { data: user, error: userErr },
      { data: progress },
      { data: workouts },
      { data: activePlan },
      { data: xp },
      { data: foodLogs },
      { data: aiRequests },
      { data: flags },
    ] = await Promise.all([
      supabase.from('users').select('*').eq('id', userId).maybeSingle(),
      supabase.from('progress_entries').select('*').eq('user_id', userId).order('logged_at', { ascending: false }).limit(10),
      supabase.from('workout_logs').select('*').eq('user_id', userId).order('created_at', { ascending: false }),
      supabase.from('user_workout_plans').select('*').eq('user_id', userId).eq('is_active', true).limit(1).maybeSingle(),
      supabase.from('user_xp').select('*').eq('user_id', userId).maybeSingle(),
      supabase.from('food_logs').select('*').eq('user_id', userId).gte('log_date', sevenAgoStr).order('log_date', { ascending: false }),
      supabase.from('ai_requests').select('*').eq('user_id', userId).order('created_at', { ascending: false }).limit(50),
      supabase.from('user_flags').select('*').eq('user_id', userId).maybeSingle(),
    ]);
    if (userErr) throw userErr;
    if (!user) return res.status(404).json({ error: 'User not found' });

    res.json({ user, progress: progress || [], workouts: workouts || [], activePlan: activePlan || null, xp: xp || null, foodLogs: foodLogs || [], aiRequests: aiRequests || [], flags: flags || null });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.patch('/users/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    const updateObj = {};
    USER_EDIT_FIELDS.forEach(field => {
      if (req.body[field] !== undefined) updateObj[field] = req.body[field];
    });
    if (typeof updateObj.equipment === 'string') {
      updateObj.equipment = updateObj.equipment.split(',').map(s => s.trim()).filter(Boolean);
    }
    if (Object.keys(updateObj).length === 0) return res.status(400).json({ error: 'No valid fields to update' });

    const { data, error } = await supabase.from('users').update(updateObj).eq('id', userId).select('*').maybeSingle();
    if (error) throw error;
    if (!data) return res.status(404).json({ error: 'User not found' });
    res.json(data);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.patch('/users/:userId/role', async (req, res) => {
  try {
    const { userId } = req.params;
    const role = String(req.body?.role || '');
    if (!ROLES.includes(role)) return res.status(400).json({ error: `role must be one of ${ROLES.join(', ')}` });

    const { data, error } = await supabase.from('users').update({ role }).eq('id', userId).select('*').maybeSingle();
    if (error) throw error;
    if (!data) return res.status(404).json({ error: 'User not found' });
    res.json(data);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.patch('/users/:userId/flags', async (req, res) => {
  try {
    const { userId } = req.params;
    const patch = { user_id: userId, flagged_at: new Date().toISOString(), flagged_by: req.user.email };
    if (req.body?.notes !== undefined) patch.notes = String(req.body.notes).trim() || null;
    if (req.body?.ai_blocked !== undefined) patch.ai_blocked = !!req.body.ai_blocked;

    const { data, error } = await supabase.from('user_flags').upsert(patch, { onConflict: 'user_id' }).select('*').single();
    if (error) throw error;
    res.json(data);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/users/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    const { data: user, error: userErr } = await supabase.from('users').select('id').eq('id', userId).maybeSingle();
    if (userErr) throw userErr;
    if (!user) return res.status(404).json({ error: 'User not found' });

    await deleteUserCascade(supabase, userId);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/dashboard', async (req, res) => {
  try {
    const now = new Date();
    const thirtyDaysAgo = new Date(now); thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const fourteenDaysAgo = new Date(now); fourteenDaysAgo.setDate(fourteenDaysAgo.getDate() - 14);
    const todayStart = new Date(now); todayStart.setHours(0, 0, 0, 0);

    const [
      { count: totalUsers },
      { data: wlUsers },
      { data: flUsers },
      { count: totalWorkouts },
      { count: totalFood },
      { count: aiToday },
      { data: aiCost },
      { data: signups },
      { count: activePlans },
      { count: nullCalorie },
      { data: recentWorkouts },
      { data: allWlUsers },
      { data: allFlUsers },
      { count: withCalorie },
    ] = await Promise.all([
      supabase.from('users').select('*', { count: 'exact', head: true }),
      supabase.from('workout_logs').select('user_id').gte('created_at', thirtyDaysAgo.toISOString()),
      supabase.from('food_logs').select('user_id').gte('created_at', thirtyDaysAgo.toISOString()),
      supabase.from('workout_logs').select('*', { count: 'exact', head: true }),
      supabase.from('food_logs').select('*', { count: 'exact', head: true }),
      supabase.from('ai_requests').select('*', { count: 'exact', head: true }).gte('created_at', todayStart.toISOString()),
      supabase.from('ai_requests').select('cost_usd').gte('created_at', todayStart.toISOString()),
      supabase.from('users').select('created_at').gte('created_at', thirtyDaysAgo.toISOString()),
      supabase.from('user_workout_plans').select('*', { count: 'exact', head: true }).eq('is_active', true),
      supabase.from('users').select('*', { count: 'exact', head: true }).is('calorie_goal', null),
      supabase.from('workout_logs').select('started_at, created_at').gte('created_at', fourteenDaysAgo.toISOString()),
      supabase.from('workout_logs').select('user_id'),
      supabase.from('food_logs').select('user_id'),
      supabase.from('users').select('*', { count: 'exact', head: true }).not('calorie_goal', 'is', null),
    ]);

    res.json({
      totalUsers: totalUsers ?? 0, wlUsers: wlUsers || [], flUsers: flUsers || [],
      totalWorkouts: totalWorkouts ?? 0, totalFood: totalFood ?? 0,
      aiToday: aiToday ?? 0, aiCost: aiCost || [], signups: signups || [],
      activePlans: activePlans ?? 0, nullCalorie: nullCalorie ?? 0,
      recentWorkouts: recentWorkouts || [], allWlUsers: allWlUsers || [],
      allFlUsers: allFlUsers || [], withCalorie: withCalorie ?? 0,
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Row counts for the Settings page's "Platform Stats" cards and "Database
// Health" table. Runs on the service-role client so counts reflect the real
// totals -- a direct anon-key count from the frontend would be RLS-scoped to
// the caller's own rows on tables like `users`/`workout_logs` (see GAPS.md).
const STATS_TABLES = [
  'users', 'workout_logs', 'food_logs', 'ai_requests', 'exercises',
  'exercise_metadata', 'progress_entries', 'food_vision_cache', 'xp_events', 'user_xp',
];

router.get('/platform-stats', async (req, res) => {
  try {
    const tables = await Promise.all(STATS_TABLES.map(async (table) => {
      const { count, error } = await supabase.from(table).select('*', { count: 'exact', head: true });
      return { table, count: error ? null : (count ?? 0) };
    }));
    const countMap = {};
    tables.forEach(t => { countMap[t.table] = t.count; });

    const { data: aiCostData } = await supabase.from('ai_requests').select('cost_usd');
    const aiCost = (aiCostData || []).reduce((s, r) => s + (r.cost_usd || 0), 0);

    res.json({
      tables,
      stats: {
        users: countMap.users ?? 0,
        exercises: countMap.exercises ?? 0,
        workouts: countMap.workout_logs ?? 0,
        foodLogs: countMap.food_logs ?? 0,
        aiReqs: countMap.ai_requests ?? 0,
        aiCost,
      },
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Backs the Settings/Dashboard "Alerts" banner. Was previously a direct
// anon-key read from gymvyn-admin (AlertsBanner.jsx) of `ai_requests` and
// `users` -- both now RLS-scoped to the caller's own row (see GAPS.md item
// 1's fix), so those queries silently returned near-empty data for any
// admin session instead of the platform-wide totals the alerts need.
router.get('/alerts', async (req, res) => {
  try {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const todayStart = today.toISOString();
    const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    const [
      { data: costs },
      { data: features },
      { count: nullGoals },
      { data: aiByUser },
    ] = await Promise.all([
      supabase.from('ai_requests').select('cost_usd').gte('created_at', todayStart),
      supabase.from('ai_requests').select('feature, success').gte('created_at', since24h),
      supabase.from('users').select('*', { count: 'exact', head: true }).is('calorie_goal', null),
      supabase.from('ai_requests').select('user_id').gte('created_at', todayStart),
    ]);

    res.json({ costs: costs || [], features: features || [], nullGoals: nullGoals ?? 0, aiByUser: aiByUser || [] });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

const AI_FLAG_KEYS = ['AI_VOICE_DIET_ENABLED', 'AI_FOOD_VISION_ENABLED', 'AI_VOICE_WORKOUT_ENABLED'];

router.get('/ai-monitor', async (req, res) => {
  try {
    const [
      { data: ai },
      { data: errors },
      { data: flags },
      { count: cacheCount },
      { data: cacheHits },
      { data: cacheTop },
    ] = await Promise.all([
      supabase.from('ai_requests').select('feature, provider, cost_usd, success, duration_ms, created_at').order('created_at', { ascending: false }).limit(10000),
      supabase.from('ai_requests').select('user_id, feature, error_message, created_at').eq('success', false).order('created_at', { ascending: false }).limit(20),
      supabase.from('feature_flags').select('key, enabled').in('key', AI_FLAG_KEYS),
      supabase.from('food_vision_cache').select('*', { count: 'exact', head: true }),
      supabase.from('food_vision_cache').select('hit_count'),
      supabase.from('food_vision_cache').select('image_hash, hit_count, last_hit_at').order('hit_count', { ascending: false }).limit(5),
    ]);
    const totalHits = (cacheHits || []).reduce((s, r) => s + (r.hit_count || 0), 0);
    res.json({ ai: ai || [], errors: errors || [], flags: flags || [], cache: { count: cacheCount ?? 0, totalHits, top: cacheTop || [] } });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/feature-flags/:key', async (req, res) => {
  try {
    const key = req.params.key;
    if (!AI_FLAG_KEYS.includes(key)) return res.status(400).json({ error: 'Unknown flag key' });
    const enabled = !!req.body?.enabled;
    const { data, error } = await supabase.from('feature_flags').upsert({ key, enabled, updated_at: new Date().toISOString() }, { onConflict: 'key' }).select('key, enabled').single();
    if (error) throw error;
    res.json(data);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/food-vision-cache', async (req, res) => {
  try {
    const { error } = await supabase.from('food_vision_cache').delete().not('image_hash', 'is', null);
    if (error) throw error;
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// `exercises`/`exercise_metadata` only have a public SELECT RLS policy (no
// INSERT/UPDATE/DELETE) -- gymvyn-admin's Exercises.jsx used to write via the
// anon client and every write silently failed (see GAPS.md item 5). These
// routes give admin writes a real path via the service-role client instead of
// opening the RLS policies to direct anon-key writes (which would let any
// signed-in user, not just the admin, tamper with the shared exercise data).
function buildExercisePayload(body) {
  return {
    name: typeof body?.name === 'string' ? body.name.trim() : '',
    muscle_group: body?.muscle_group || null,
    equipment: body?.equipment || null,
    difficulty: body?.difficulty || null,
    video_url: body?.video_url || null,
  };
}

function buildMetadataPayload(exerciseName, body) {
  const instructions = Array.isArray(body?.instructions)
    ? body.instructions.map((s) => String(s).trim()).filter(Boolean)
    : [];
  const proTip = typeof body?.pro_tip === 'string' ? body.pro_tip.trim() : '';
  if (instructions.length === 0 && !proTip) return null;
  return {
    exercise_name: exerciseName,
    instructions: instructions.length > 0 ? instructions : null,
    pro_tip: proTip || null,
  };
}

router.post('/exercises', async (req, res) => {
  try {
    const payload = buildExercisePayload(req.body);
    if (!payload.name) return res.status(400).json({ error: 'name is required' });

    const { data: inserted, error } = await supabase.from('exercises').insert(payload).select().single();
    if (error) throw error;

    const metaPayload = buildMetadataPayload(inserted.name, req.body);
    if (metaPayload) {
      const { error: metaErr } = await supabase.from('exercise_metadata').insert(metaPayload);
      if (metaErr) throw metaErr;
    }

    res.json(inserted);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.patch('/exercises/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { data: existing, error: fetchErr } = await supabase.from('exercises').select('id, name').eq('id', id).maybeSingle();
    if (fetchErr) throw fetchErr;
    if (!existing) return res.status(404).json({ error: 'Exercise not found' });

    const payload = buildExercisePayload(req.body);
    if (!payload.name) return res.status(400).json({ error: 'name is required' });

    if (existing.name !== payload.name) {
      const { error: renameErr } = await supabase
        .from('exercise_metadata')
        .update({ exercise_name: payload.name })
        .eq('exercise_name', existing.name);
      if (renameErr) throw renameErr;
    }

    const { data: updated, error } = await supabase.from('exercises').update(payload).eq('id', id).select().maybeSingle();
    if (error) throw error;
    if (!updated) return res.status(404).json({ error: 'Exercise not found' });

    const metaPayload = buildMetadataPayload(payload.name, req.body);
    if (metaPayload) {
      const { error: metaErr } = await supabase
        .from('exercise_metadata')
        .upsert(metaPayload, { onConflict: 'exercise_name' });
      if (metaErr) throw metaErr;
    }

    res.json(updated);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/exercises/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { data: existing, error: fetchErr } = await supabase.from('exercises').select('id, name').eq('id', id).maybeSingle();
    if (fetchErr) throw fetchErr;
    if (!existing) return res.status(404).json({ error: 'Exercise not found' });

    const [{ error: delErr }, { error: metaDelErr }] = await Promise.all([
      supabase.from('exercises').delete().eq('id', id),
      supabase.from('exercise_metadata').delete().eq('exercise_name', existing.name),
    ]);
    if (delErr) throw delErr;
    if (metaDelErr) throw metaDelErr;

    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
