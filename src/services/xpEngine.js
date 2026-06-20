const { createClient } = require('@supabase/supabase-js');
const { randomUUID } = require('crypto');
const {
  XP_CONSTANTS,
  LEVEL_THRESHOLDS,
  calculateE1RM,
  calculateImprovementXP,
  calculateVolumeBonus,
  calculateStreakMultiplier,
  calculateLevel,
  applyMultiplier,
  calculateDietXP,
  checkMuscleSkipPenalty,
} = require('../utils/xpCalculator');

const {
  WORKOUT_BASE_XP,
  FORM_COACH_BONUS,
  MAX_WORKOUTS_PER_DAY,
  MAX_PRS_PER_WEEK,
  MIN_WORKOUT_MINUTES,
  DAILY_ACTIVE_XP,
  COMMUNITY_POST_XP,
  MAX_COMMUNITY_XP_PER_DAY,
  MONTHLY_FREEZES,
  MUSCLE_GROUPS,
} = XP_CONSTANTS;

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

function startOfWeekStr() {
  const d = new Date();
  const day = d.getDay(); // 0=Sun
  const diff = day === 0 ? 6 : day - 1; // shift so Monday=0
  d.setDate(d.getDate() - diff);
  return d.toISOString().split('T')[0];
}

// ── 1. ensureXPProfile ────────────────────────────────────────────────────────

async function ensureXPProfile(supabase, userId) {
  const { data: existing, error: fetchErr } = await supabase
    .from('user_xp')
    .select('*')
    .eq('user_id', userId)
    .maybeSingle();

  if (fetchErr) throw fetchErr;
  if (existing) return existing;

  const { data: created, error: insertErr } = await supabase
    .from('user_xp')
    .insert({
      user_id: userId,
      total_xp: 0,
      level: 1,
      current_streak: 0,
      longest_streak: 0,
      streak_multiplier: 1.0,
      last_active_date: null,
      freezes_remaining: MONTHLY_FREEZES,
      freezes_reset_at: firstOfMonthStr(),
    })
    .select()
    .single();

  if (insertErr) throw insertErr;
  return created;
}

// ── 2. recordXPEvent ─────────────────────────────────────────────────────────

async function recordXPEvent(supabase, userId, { source, action, baseXP, multiplier: forcedMultiplier, metadata } = {}) {
  const profile = await ensureXPProfile(supabase, userId);
  const multiplier = forcedMultiplier !== undefined ? forcedMultiplier : (profile.streak_multiplier || 1.0);
  const finalXP = applyMultiplier(baseXP, multiplier);

  const { error: eventErr } = await supabase.from('xp_events').insert({
    id: randomUUID(),
    user_id: userId,
    source,
    action,
    base_xp: baseXP,
    multiplier,
    final_xp: finalXP,
    metadata: metadata || null,
  });
  if (eventErr) throw eventErr;

  const newTotal = Math.max(0, (profile.total_xp || 0) + finalXP);
  const newLevel = calculateLevel(newTotal);

  const { error: updateErr } = await supabase
    .from('user_xp')
    .update({ total_xp: newTotal, level: newLevel, updated_at: new Date().toISOString() })
    .eq('user_id', userId);
  if (updateErr) throw updateErr;

  return { baseXP, multiplier, finalXP, newTotal, newLevel };
}

// ── 3. processWorkoutXP ───────────────────────────────────────────────────────

async function processWorkoutXP(supabase, userId, workoutData) {
  const { exercises = [], durationMinutes = 0, usedFormCoach = false } = workoutData;

  if (durationMinutes < MIN_WORKOUT_MINUTES) {
    return { awarded: false, reason: 'Workout too short' };
  }

  const today = todayStr();
  const { data: todayEvents, error: todayErr } = await supabase
    .from('xp_events')
    .select('id')
    .eq('user_id', userId)
    .eq('source', 'train')
    .eq('action', 'workout_complete')
    .gte('created_at', `${today}T00:00:00.000Z`)
    .lt('created_at', `${today}T23:59:59.999Z`);
  if (todayErr) throw todayErr;

  if ((todayEvents || []).length >= MAX_WORKOUTS_PER_DAY) {
    return { awarded: false, reason: 'Daily workout limit reached' };
  }

  let totalVolume = 0;
  for (const ex of exercises) {
    for (const set of (ex.sets || [])) {
      const kg = parseFloat(set.weight_kg || set.kg) || 0;
      const reps = parseInt(set.reps_completed || set.reps) || 0;
      totalVolume += kg * reps;
    }
  }

  const volumeBonus = calculateVolumeBonus(totalVolume);
  const formCoachBonus = usedFormCoach ? FORM_COACH_BONUS : 0;
  const totalWorkoutXP = WORKOUT_BASE_XP + volumeBonus + formCoachBonus;

  const workoutEvent = await recordXPEvent(supabase, userId, {
    source: 'train',
    action: 'workout_complete',
    baseXP: totalWorkoutXP,
    metadata: { volume: totalVolume, exercises: exercises.length, duration: durationMinutes },
  });

  // Check weekly PR cap
  const weekStart = startOfWeekStr();
  const { data: weekPRs } = await supabase
    .from('xp_events')
    .select('id')
    .eq('user_id', userId)
    .eq('action', 'improvement')
    .gte('created_at', `${weekStart}T00:00:00.000Z`);
  const prCountThisWeek = (weekPRs || []).length;

  const improvements = [];
  for (const ex of exercises) {
    const name = ex.name;
    if (!name) continue;

    let bestE1RM = 0;
    for (const set of (ex.sets || [])) {
      const kg = parseFloat(set.weight_kg || set.kg) || 0;
      const reps = parseInt(set.reps_completed || set.reps) || 0;
      if (!kg || !reps) continue;
      const e1rm = calculateE1RM(kg, reps);
      if (e1rm > bestE1RM) bestE1RM = e1rm;
    }
    if (!bestE1RM) continue;

    const { data: existing } = await supabase
      .from('exercise_e1rm')
      .select('current_e1rm, previous_e1rm')
      .eq('user_id', userId)
      .eq('exercise_name', name)
      .maybeSingle();

    if (!existing) {
      await supabase.from('exercise_e1rm').insert({
        user_id: userId,
        exercise_name: name,
        current_e1rm: bestE1RM,
        previous_e1rm: null,
        updated_at: new Date().toISOString(),
      });
      continue;
    }

    if (bestE1RM > existing.current_e1rm) {
      const delta = parseFloat((bestE1RM - existing.current_e1rm).toFixed(1));
      await supabase.from('exercise_e1rm').update({
        previous_e1rm: existing.current_e1rm,
        current_e1rm: bestE1RM,
        updated_at: new Date().toISOString(),
      }).eq('user_id', userId).eq('exercise_name', name);

      if (prCountThisWeek + improvements.length < MAX_PRS_PER_WEEK) {
        const improvXP = calculateImprovementXP(delta, bestE1RM);
        const improvEvent = await recordXPEvent(supabase, userId, {
          source: 'improve',
          action: 'improvement',
          baseXP: improvXP,
          metadata: { exercise: name, old_e1rm: existing.current_e1rm, new_e1rm: bestE1RM, delta },
        });
        improvements.push({ exercise: name, delta, xpEarned: improvEvent.finalXP });
      }
    }
  }

  await updateDailyActivity(supabase, userId);
  await updateChallengeProgress(supabase, userId, 'workout');

  const totalXPEarned = workoutEvent.finalXP + improvements.reduce((s, i) => s + i.xpEarned, 0);
  return {
    awarded: true,
    workoutXP: workoutEvent.finalXP,
    volumeBonus,
    formCoachBonus,
    improvements,
    totalXPEarned,
    newTotal: workoutEvent.newTotal,
    newLevel: workoutEvent.newLevel,
  };
}

// ── 4. processDietXP ──────────────────────────────────────────────────────────

async function processDietXP(supabase, userId, dietData) {
  const { mealsLogged = 0, proteinPct = 0, carbsPct = 0, fatPct = 0 } = dietData;

  const dietXP = calculateDietXP(proteinPct, carbsPct, fatPct, mealsLogged);
  if (dietXP === 0) return { awarded: false, reason: 'Need at least 2 meals logged' };

  const today = todayStr();
  const { data: existingEvents } = await supabase
    .from('xp_events')
    .select('id, base_xp')
    .eq('user_id', userId)
    .eq('source', 'fuel')
    .eq('action', 'diet_log')
    .gte('created_at', `${today}T00:00:00.000Z`)
    .lt('created_at', `${today}T23:59:59.999Z`)
    .order('created_at', { ascending: false })
    .limit(1);

  const prevXP = existingEvents?.[0]?.base_xp || 0;
  if (dietXP <= prevXP) return { awarded: false, reason: 'Already awarded' };

  const deltaXP = dietXP - prevXP;
  const event = await recordXPEvent(supabase, userId, {
    source: 'fuel',
    action: 'diet_log',
    baseXP: deltaXP,
    metadata: { mealsLogged, proteinPct, carbsPct, fatPct },
  });

  await updateDailyActivity(supabase, userId);
  await updateChallengeProgress(supabase, userId, 'diet');

  const inRange = (p) => p >= 0.8 && p <= 1.2;
  const proteinOk = inRange(proteinPct);
  const carbsOk = inRange(carbsPct);
  const fatOk = inRange(fatPct);

  return {
    awarded: true,
    dietXP: event.finalXP,
    breakdown: {
      protein: proteinOk ? 15 : 0,
      carbs: carbsOk ? 5 : 0,
      fat: fatOk ? 5 : 0,
      allThreeBonus: proteinOk && carbsOk && fatOk ? 10 : 0,
      mealLogBonus: mealsLogged >= 3 ? 10 : 0,
    },
    newTotal: event.newTotal,
    newLevel: event.newLevel,
  };
}

// ── 5. processCommunityXP ─────────────────────────────────────────────────────

async function processCommunityXP(supabase, userId) {
  const today = todayStr();
  const { data: todayEvents } = await supabase
    .from('xp_events')
    .select('id')
    .eq('user_id', userId)
    .eq('source', 'connect')
    .gte('created_at', `${today}T00:00:00.000Z`)
    .lt('created_at', `${today}T23:59:59.999Z`);

  const cap = Math.floor(MAX_COMMUNITY_XP_PER_DAY / COMMUNITY_POST_XP);
  if ((todayEvents || []).length >= cap) {
    return { awarded: false, reason: 'Daily community XP cap reached' };
  }

  const event = await recordXPEvent(supabase, userId, {
    source: 'connect',
    action: 'community_post',
    baseXP: COMMUNITY_POST_XP,
  });

  await updateDailyActivity(supabase, userId);
  return { awarded: true, xp: event.finalXP };
}

// ── 6. updateDailyActivity ────────────────────────────────────────────────────

async function updateDailyActivity(supabase, userId) {
  const profile = await ensureXPProfile(supabase, userId);
  const today = todayStr();
  const yesterday = yesterdayStr();

  if (profile.last_active_date === today) return;

  let newStreak = 1;
  let newLongest = profile.longest_streak || 0;

  if (profile.last_active_date === yesterday) {
    newStreak = (profile.current_streak || 0) + 1;
  } else if (profile.last_active_date !== null) {
    newStreak = 1;
  }

  if (newStreak > newLongest) newLongest = newStreak;

  const newMultiplier = calculateStreakMultiplier(newStreak);

  // Check freeze reset
  const firstOfMonth = firstOfMonthStr();
  const freezeUpdates = {};
  if (profile.freezes_reset_at < firstOfMonth) {
    freezeUpdates.freezes_remaining = MONTHLY_FREEZES;
    freezeUpdates.freezes_reset_at = firstOfMonth;
  }

  const { error: updateErr } = await supabase
    .from('user_xp')
    .update({
      last_active_date: today,
      current_streak: newStreak,
      longest_streak: newLongest,
      streak_multiplier: newMultiplier,
      ...freezeUpdates,
    })
    .eq('user_id', userId);
  if (updateErr) throw updateErr;

  await recordXPEvent(supabase, userId, {
    source: 'show_up',
    action: 'daily_active',
    baseXP: DAILY_ACTIVE_XP,
  });

  // Track season participation
  try {
    const now = new Date().toISOString();
    const { data: season } = await supabase
      .from('challenge_seasons')
      .select('id')
      .eq('is_active', true)
      .lte('starts_at', now)
      .gte('ends_at', now)
      .maybeSingle();

    if (season) {
      const { data: participation } = await supabase
        .from('season_participants')
        .select('id, active_days')
        .eq('season_id', season.id)
        .eq('user_id', userId)
        .maybeSingle();

      if (participation) {
        const newActiveDays = (participation.active_days || 0) + 1;
        await supabase
          .from('season_participants')
          .update({ active_days: newActiveDays, eligible: newActiveDays >= 30 })
          .eq('id', participation.id);
      }
    }
  } catch (_) {
    // Season tracking is non-fatal
  }
}

// ── 7. useFreeze ──────────────────────────────────────────────────────────────

async function useFreeze(supabase, userId) {
  const profile = await ensureXPProfile(supabase, userId);
  const today = todayStr();
  const yesterday = yesterdayStr();

  // Reset freezes if needed
  const firstOfMonth = firstOfMonthStr();
  let freezesRemaining = profile.freezes_remaining;
  if (profile.freezes_reset_at < firstOfMonth) {
    freezesRemaining = MONTHLY_FREEZES;
    await supabase.from('user_xp').update({
      freezes_remaining: MONTHLY_FREEZES,
      freezes_reset_at: firstOfMonth,
    }).eq('user_id', userId);
  }

  if (freezesRemaining <= 0) return { success: false, reason: 'No freezes remaining' };
  if (profile.last_active_date === today) return { success: false, reason: 'Already active today, no freeze needed' };
  if (profile.last_active_date === yesterday) return { success: false, reason: 'Streak is intact, no freeze needed' };

  const newCount = freezesRemaining - 1;
  const { error } = await supabase.from('user_xp').update({
    freezes_remaining: newCount,
    last_active_date: yesterday,
  }).eq('user_id', userId);
  if (error) throw error;

  return { success: true, freezesRemaining: newCount, currentStreak: profile.current_streak };
}

// ── 8. calculateMuscleBalance ─────────────────────────────────────────────────

async function calculateMuscleBalance(supabase, userId) {
  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
  const since = sevenDaysAgo.toISOString().split('T')[0];

  const { data: logs, error: logsErr } = await supabase
    .from('workout_logs')
    .select('exercises')
    .eq('user_id', userId)
    .gte('completed_at', `${since}T00:00:00.000Z`);
  if (logsErr) throw logsErr;

  const totalWorkouts = (logs || []).length;
  const exerciseNames = new Set();
  for (const log of (logs || [])) {
    for (const ex of (log.exercises || [])) {
      if (ex.name) exerciseNames.add(ex.name);
    }
  }

  const trainedGroups = new Set();
  if (exerciseNames.size > 0) {
    const { data: metadata } = await supabase
      .from('exercise_metadata')
      .select('exercise_name, muscle_groups')
      .in('exercise_name', [...exerciseNames]);

    for (const row of (metadata || [])) {
      for (const g of (row.muscle_groups || [])) trainedGroups.add(g);
    }
  }

  const trainedArr = [...trainedGroups];
  const { penalty, skippedGroups } = checkMuscleSkipPenalty(trainedArr, totalWorkouts);

  return { trainedGroups: trainedArr, skippedGroups, penalty, totalWorkouts, allGroups: MUSCLE_GROUPS };
}

// ── 9. applyWeeklyMuscleSkipPenalty ──────────────────────────────────────────

async function applyWeeklyMuscleSkipPenalty(supabase, userId) {
  const result = await calculateMuscleBalance(supabase, userId);
  if (result.penalty > 0) {
    const profile = await ensureXPProfile(supabase, userId);
    const newTotal = Math.max(0, (profile.total_xp || 0) - result.penalty);
    const newLevel = calculateLevel(newTotal);

    const { error: eventErr } = await supabase.from('xp_events').insert({
      id: randomUUID(),
      user_id: userId,
      source: 'train',
      action: 'muscle_skip_penalty',
      base_xp: -result.penalty,
      multiplier: 1.0,
      final_xp: -result.penalty,
      metadata: { skippedGroups: result.skippedGroups },
    });
    if (eventErr) throw eventErr;

    const { error: updateErr } = await supabase
      .from('user_xp')
      .update({ total_xp: newTotal, level: newLevel, updated_at: new Date().toISOString() })
      .eq('user_id', userId);
    if (updateErr) throw updateErr;
  }
  return result;
}

// ── 10. updateChallengeProgress ───────────────────────────────────────────────

async function updateChallengeProgress(supabase, userId, eventType) {
  const weekStart = startOfWeekStr();
  const weekEnd = new Date();
  weekEnd.setDate(weekEnd.getDate() + (7 - (weekEnd.getDay() === 0 ? 7 : weekEnd.getDay())));
  const weekEndStr = weekEnd.toISOString().split('T')[0];

  const { data: challenges } = await supabase
    .from('weekly_challenges')
    .select('*')
    .eq('user_id', userId)
    .eq('week_start', weekStart)
    .eq('completed', false);

  if (!challenges || challenges.length === 0) return;

  for (const challenge of challenges) {
    try {
      if (challenge.challenge_type === 'volume' && eventType === 'workout') {
        const { data: logs } = await supabase
          .from('workout_logs')
          .select('exercises')
          .eq('user_id', userId)
          .gte('completed_at', `${weekStart}T00:00:00.000Z`);

        let totalVolume = 0;
        for (const log of logs || []) {
          for (const ex of log.exercises || []) {
            for (const set of ex.sets || []) {
              const kg = parseFloat(set.weight_kg || set.kg) || 0;
              const reps = parseInt(set.reps_completed || set.reps) || 0;
              totalVolume += kg * reps;
            }
          }
        }

        const updates = { progress: totalVolume };
        if (totalVolume >= challenge.target_value) {
          updates.completed = true;
          await supabase.from('weekly_challenges').update(updates).eq('id', challenge.id);
          await recordXPEvent(supabase, userId, {
            source: 'train',
            action: 'challenge_complete',
            baseXP: challenge.xp_reward,
            metadata: { challenge_id: challenge.id, title: challenge.title },
          });
        } else {
          await supabase.from('weekly_challenges').update(updates).eq('id', challenge.id);
        }
      }

      if (challenge.challenge_type === 'strength' && eventType === 'workout') {
        const { data: logs } = await supabase
          .from('workout_logs')
          .select('exercises')
          .eq('user_id', userId)
          .gte('completed_at', `${weekStart}T00:00:00.000Z`);

        let maxE1RM = 0;
        for (const log of logs || []) {
          for (const ex of log.exercises || []) {
            for (const set of ex.sets || []) {
              const kg = parseFloat(set.weight_kg || set.kg) || 0;
              const reps = parseInt(set.reps_completed || set.reps) || 0;
              if (!kg || !reps) continue;
              const e1rm = calculateE1RM(kg, reps);
              if (e1rm > maxE1RM) maxE1RM = e1rm;
            }
          }
        }

        const updates = { progress: maxE1RM };
        if (maxE1RM >= challenge.target_value) {
          updates.completed = true;
          await supabase.from('weekly_challenges').update(updates).eq('id', challenge.id);
          await recordXPEvent(supabase, userId, {
            source: 'improve',
            action: 'challenge_complete',
            baseXP: challenge.xp_reward,
            metadata: { challenge_id: challenge.id, title: challenge.title },
          });
        } else {
          await supabase.from('weekly_challenges').update(updates).eq('id', challenge.id);
        }
      }

      if (challenge.challenge_type === 'nutrition' && eventType === 'diet') {
        const { data: foodLogs } = await supabase
          .from('food_logs')
          .select('calories, log_date')
          .eq('user_id', userId)
          .gte('log_date', weekStart);

        const caloriesByDay = {};
        for (const row of foodLogs || []) {
          caloriesByDay[row.log_date] = (caloriesByDay[row.log_date] || 0) + (parseFloat(row.calories) || 0);
        }
        const daysHit = Object.values(caloriesByDay).filter(cal => cal >= challenge.target_value).length;

        const updates = { progress: daysHit };
        if (daysHit >= 4) {
          updates.completed = true;
          await supabase.from('weekly_challenges').update(updates).eq('id', challenge.id);
          await recordXPEvent(supabase, userId, {
            source: 'fuel',
            action: 'challenge_complete',
            baseXP: challenge.xp_reward,
            metadata: { challenge_id: challenge.id, title: challenge.title },
          });
        } else {
          await supabase.from('weekly_challenges').update(updates).eq('id', challenge.id);
        }
      }
    } catch (err) {
      console.error(`[XP] updateChallengeProgress failed for challenge ${challenge.id}:`, err.message);
    }
  }
}

module.exports = {
  ensureXPProfile,
  recordXPEvent,
  processWorkoutXP,
  processDietXP,
  processCommunityXP,
  updateDailyActivity,
  useFreeze,
  calculateMuscleBalance,
  applyWeeklyMuscleSkipPenalty,
  updateChallengeProgress,
};
