// CJS mirror of frontend's src/utils/xpCalculator.js — keep in sync

const XP_CONSTANTS = {
  WORKOUT_BASE_XP: 25,
  FORM_COACH_BONUS: 5,
  MAX_WORKOUTS_PER_DAY: 2,
  MAX_PRS_PER_WEEK: 3,
  MIN_WORKOUT_MINUTES: 15,
  DAILY_ACTIVE_XP: 10,
  COMMUNITY_POST_XP: 5,
  MAX_COMMUNITY_XP_PER_DAY: 15,
  MONTHLY_FREEZES: 9,
  MUSCLE_GROUPS: ['chest', 'back', 'shoulders', 'legs', 'arms', 'core'],
  LEVEL_NAMES: {
    1: 'Rookie', 2: 'Rookie', 3: 'Rookie',
    4: 'Iron', 5: 'Iron', 6: 'Iron', 7: 'Iron',
    8: 'Steel', 9: 'Steel', 10: 'Steel', 11: 'Steel',
    12: 'Titan', 13: 'Titan', 14: 'Titan', 15: 'Titan',
    16: 'Forge', 17: 'Forge', 18: 'Forge', 19: 'Forge',
    20: 'Forgemaster',
  },
};

const LEVEL_THRESHOLDS = {
  1: 0, 2: 100, 3: 250, 4: 501, 5: 900,
  6: 1300, 7: 2000, 8: 2800, 9: 3600, 10: 5000,
  11: 6500, 12: 8000, 13: 9500, 14: 10000, 15: 11500,
  16: 13000, 17: 14500, 18: 16000, 19: 18000, 20: 18001,
};

function calculateE1RM(weight, reps) {
  return Math.round(weight * (1 + reps / 30) * 10) / 10;
}

function calculateImprovementXP(deltaE1RM, currentE1RM) {
  if (deltaE1RM <= 0) return 0;
  return Math.round(deltaE1RM * (1 + 1.5 * Math.log(currentE1RM / 20)));
}

function calculateVolumeBonus(totalSessionVolume) {
  return Math.min(30, Math.round(totalSessionVolume / 500));
}

function calculateStreakMultiplier(streakDays) {
  if (streakDays >= 31) return 3.0;
  if (streakDays >= 15) return 2.5;
  if (streakDays >= 8) return 2.0;
  if (streakDays >= 4) return 1.5;
  return 1.0;
}

function calculateLevel(totalXP) {
  let level = 1;
  for (const [lvl, threshold] of Object.entries(LEVEL_THRESHOLDS)) {
    if (totalXP >= threshold) level = Number(lvl);
  }
  return level;
}

function applyMultiplier(baseXP, multiplier) {
  return Math.round(baseXP * multiplier);
}

function calculateDietXP(proteinPct, carbsPct, fatPct, mealsLogged) {
  if (mealsLogged < 2) return 0;
  const inRange = (pct) => pct >= 0.8 && pct <= 1.2;
  const proteinOk = inRange(proteinPct);
  const carbsOk = inRange(carbsPct);
  const fatOk = inRange(fatPct);
  let xp = 0;
  if (proteinOk) xp += 15;
  if (carbsOk) xp += 5;
  if (fatOk) xp += 5;
  if (proteinOk && carbsOk && fatOk) xp += 10;
  if (mealsLogged >= 3) xp += 10;
  return xp;
}

function checkMuscleSkipPenalty(muscleGroupsTrainedThisWeek, totalWorkoutsThisWeek) {
  if (totalWorkoutsThisWeek < 3) return { penalty: 0, skippedGroups: [] };
  const allGroups = XP_CONSTANTS.MUSCLE_GROUPS;
  const skippedGroups = allGroups.filter(g => !muscleGroupsTrainedThisWeek.includes(g));
  const penalty = Math.min(30, skippedGroups.length * 15);
  return { penalty, skippedGroups };
}

module.exports = {
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
};
