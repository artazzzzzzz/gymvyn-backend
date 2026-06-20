const cron = require('node-cron');
const { createClient } = require('@supabase/supabase-js');
const { generateWeeklyChallenges } = require('../utils/challengeGenerator');
const { applyWeeklyMuscleSkipPenalty, calculateE1RM } = require('./xpEngine');

function getSupabase() {
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
}

function todayStr() {
  return new Date().toISOString().split('T')[0];
}

function yesterdayStr() {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return d.toISOString().split('T')[0];
}

function firstOfMonthStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
}

function thisMondayStr() {
  const d = new Date();
  const day = d.getDay();
  const diff = day === 0 ? 6 : day - 1;
  d.setDate(d.getDate() - diff);
  return d.toISOString().split('T')[0];
}

// ── 1. Daily streak check — 19:00 UTC (00:30 IST) ────────────────────────────

async function runDailyStreakCheck() {
  const supabase = getSupabase();
  console.log('[XP Cron] Daily streak check started at', new Date().toISOString());

  try {
    const yesterday = yesterdayStr();
    const firstOfMonth = firstOfMonthStr();

    const { data: rows, error } = await supabase
      .from('user_xp')
      .select('user_id, last_active_date, current_streak, freezes_remaining, freezes_reset_at')
      .not('last_active_date', 'is', null);

    if (error) throw error;

    let broken = 0;
    let freezeReset = 0;

    for (const row of rows || []) {
      const updates = {};

      // Reset streak if last active was before yesterday and streak hasn't already been reset
      if (row.last_active_date < yesterday && row.current_streak > 0) {
        updates.current_streak = 0;
        updates.streak_multiplier = 1.0;
        broken++;
      }

      // Safety-net freeze reset (also done per-user in updateDailyActivity)
      if (row.freezes_reset_at && row.freezes_reset_at < firstOfMonth) {
        updates.freezes_remaining = 6;
        updates.freezes_reset_at = firstOfMonth;
        freezeReset++;
      }

      if (Object.keys(updates).length > 0) {
        const { error: updateErr } = await supabase
          .from('user_xp')
          .update(updates)
          .eq('user_id', row.user_id);
        if (updateErr) console.error(`[XP Cron] streak update failed for ${row.user_id}:`, updateErr.message);
      }
    }

    console.log(`[XP Cron] Daily streak check done — ${broken} streaks broken, ${freezeReset} freeze counts reset`);
  } catch (err) {
    console.error('[XP Cron] Daily streak check crashed:', err.message);
  }
}

// ── 2. Weekly muscle skip penalty — 19:30 UTC Sunday (01:00 IST Monday) ──────

async function runWeeklyMusclePenalty() {
  const supabase = getSupabase();
  console.log('[XP Cron] Weekly muscle skip penalty started at', new Date().toISOString());

  try {
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    const since = sevenDaysAgo.toISOString().split('T')[0];

    const { data: activeUsers, error } = await supabase
      .from('user_xp')
      .select('user_id')
      .gte('last_active_date', since);

    if (error) throw error;

    let penalized = 0;
    let clean = 0;

    for (const { user_id } of activeUsers || []) {
      try {
        const result = await applyWeeklyMuscleSkipPenalty(supabase, user_id);
        if (result.penalty > 0) penalized++;
        else clean++;
      } catch (err) {
        console.error(`[XP Cron] muscle penalty failed for ${user_id}:`, err.message);
      }
    }

    console.log(`[XP Cron] Muscle skip penalties applied: ${penalized} users penalized, ${clean} users clean`);
  } catch (err) {
    console.error('[XP Cron] Weekly muscle penalty crashed:', err.message);
  }
}

// ── 3. Weekly challenge generation — 20:00 UTC Sunday (01:30 IST Monday) ─────

async function runWeeklyChallengeGeneration() {
  const supabase = getSupabase();
  console.log('[XP Cron] Weekly challenge generation started at', new Date().toISOString());

  try {
    const weekStart = thisMondayStr();

    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    const since = sevenDaysAgo.toISOString().split('T')[0];

    const { data: allUsers, error } = await supabase
      .from('user_xp')
      .select('user_id');

    if (error) throw error;

    let generated = 0;
    let skipped = 0;

    for (const { user_id } of allUsers || []) {
      try {
        // Skip if challenges already exist for this week
        const { data: existing } = await supabase
          .from('weekly_challenges')
          .select('id')
          .eq('user_id', user_id)
          .eq('week_start', weekStart)
          .limit(1);

        if (existing && existing.length > 0) {
          skipped++;
          continue;
        }

        // Gather last 7 days of workout data
        const { data: workoutLogs } = await supabase
          .from('workout_logs')
          .select('exercises')
          .eq('user_id', user_id)
          .gte('completed_at', `${since}T00:00:00.000Z`)
          .lt('completed_at', `${weekStart}T00:00:00.000Z`);

        const avgE1RM = {};
        let totalWeeklyVolume = 0;

        for (const log of workoutLogs || []) {
          for (const ex of log.exercises || []) {
            let bestE1RM = 0;
            let vol = 0;
            for (const set of ex.sets || []) {
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

        // Gather last 7 days of food data
        const { data: foodLogs } = await supabase
          .from('food_logs')
          .select('calories, log_date')
          .eq('user_id', user_id)
          .gte('log_date', since)
          .lt('log_date', weekStart);

        const caloriesByDay = {};
        for (const row of foodLogs || []) {
          caloriesByDay[row.log_date] = (caloriesByDay[row.log_date] || 0) + (parseFloat(row.calories) || 0);
        }
        const calDays = Object.values(caloriesByDay);
        const avgDailyCalories = calDays.length
          ? Math.round(calDays.reduce((a, b) => a + b, 0) / calDays.length)
          : 0;

        const challenges = generateWeeklyChallenges({ avgE1RM, avgDailyCalories, totalWeeklyVolume });

        const toInsert = challenges.map(c => ({
          user_id,
          week_start: weekStart,
          challenge_type: c.challenge_type,
          title: c.title,
          description: c.description,
          target_value: c.target_value,
          xp_reward: c.xp_reward,
          progress: 0,
          completed: false,
        }));

        const { error: insertErr } = await supabase.from('weekly_challenges').insert(toInsert);
        if (insertErr) {
          console.error(`[XP Cron] challenge insert failed for ${user_id}:`, insertErr.message);
        } else {
          generated++;
        }
      } catch (err) {
        console.error(`[XP Cron] challenge generation failed for ${user_id}:`, err.message);
      }
    }

    console.log(`[XP Cron] Weekly challenges generated for ${generated} users (${skipped} already had challenges)`);
  } catch (err) {
    console.error('[XP Cron] Weekly challenge generation crashed:', err.message);
  }
}

// ── 4. Monthly freeze reset — 00:00 UTC on the 1st (05:30 IST) ───────────────

async function runMonthlyFreezeReset() {
  const supabase = getSupabase();
  console.log('[XP Cron] Monthly freeze reset started at', new Date().toISOString());

  try {
    const firstOfMonth = firstOfMonthStr();

    const { error, count } = await supabase
      .from('user_xp')
      .update({ freezes_remaining: 6, freezes_reset_at: firstOfMonth })
      .lt('freezes_reset_at', firstOfMonth)
      .select('user_id', { count: 'exact', head: true });

    if (error) throw error;
    console.log(`[XP Cron] Monthly freeze reset done — ${count || 0} users updated`);
  } catch (err) {
    console.error('[XP Cron] Monthly freeze reset crashed:', err.message);
  }
}

// ── Initializer ───────────────────────────────────────────────────────────────

function initXPCrons() {
  // Daily streak check — 19:00 UTC = 00:30 IST
  cron.schedule('0 19 * * *', runDailyStreakCheck, { timezone: 'UTC' });

  // Weekly muscle skip penalty — 19:30 UTC Sunday = 01:00 IST Monday
  cron.schedule('30 19 * * 0', runWeeklyMusclePenalty, { timezone: 'UTC' });

  // Weekly challenge generation — 20:00 UTC Sunday = 01:30 IST Monday
  cron.schedule('0 20 * * 0', runWeeklyChallengeGeneration, { timezone: 'UTC' });

  // Monthly freeze reset — 00:00 UTC on 1st = 05:30 IST on 1st
  cron.schedule('0 0 1 * *', runMonthlyFreezeReset, { timezone: 'UTC' });

  console.log('[XP Cron] Scheduled: daily streak check, weekly muscle penalty, weekly challenges, monthly freeze reset');
}

module.exports = { initXPCrons };
