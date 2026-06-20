// CJS mirror of frontend's src/utils/challengeGenerator.js — keep in sync

function randomBetween(min, max) {
  return min + Math.random() * (max - min);
}

function generateWeeklyChallenges(userData) {
  const { avgE1RM, avgDailyCalories, totalWeeklyVolume } = userData || {};
  const hasWorkoutData = avgE1RM && Object.keys(avgE1RM).length > 0;

  if (!hasWorkoutData) {
    return [
      {
        challenge_type: 'strength',
        title: 'First steps',
        description: 'Complete 3 workouts this week',
        target_value: 3,
        xp_reward: 60,
      },
      {
        challenge_type: 'nutrition',
        title: 'Fuel up',
        description: 'Log meals for 4 days this week',
        target_value: 4,
        xp_reward: 40,
      },
    ];
  }

  const challenges = [];

  const topExercise = Object.entries(avgE1RM).reduce((best, [name, val]) =>
    val > best[1] ? [name, val] : best
  );
  const [exerciseName, currentE1RM] = topExercise;
  const strengthTarget = Math.round(currentE1RM * randomBetween(1.03, 1.05) * 10) / 10;
  challenges.push({
    challenge_type: 'strength',
    title: `${exerciseName.replace(/_/g, ' ')} PR`,
    description: `Hit a new ${exerciseName.replace(/_/g, ' ')} e1RM of ${strengthTarget} kg`,
    target_value: strengthTarget,
    xp_reward: 80,
  });

  if (avgDailyCalories) {
    const calTarget = Math.round(avgDailyCalories * randomBetween(1.03, 1.05));
    challenges.push({
      challenge_type: 'nutrition',
      title: 'Hit your calories',
      description: `Reach ${calTarget} kcal/day on at least 4 out of 7 days`,
      target_value: calTarget,
      xp_reward: 60,
    });
  }

  if (totalWeeklyVolume) {
    const volTarget = Math.round(totalWeeklyVolume * randomBetween(1.03, 1.05));
    challenges.push({
      challenge_type: 'volume',
      title: 'Volume week',
      description: `Accumulate ${volTarget.toLocaleString()} kg of total weekly volume`,
      target_value: volTarget,
      xp_reward: 100,
    });
  }

  return challenges;
}

module.exports = { generateWeeklyChallenges };
