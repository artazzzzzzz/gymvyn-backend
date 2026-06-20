require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

function getMuscleGroups(exerciseName) {
  const name = exerciseName.toLowerCase();
  const groups = new Set();

  // Specific overrides first
  if (/\bdeadlift\b/.test(name)) {
    groups.add('back');
    groups.add('legs');
    return [...groups];
  }
  if (/\bdip\b/.test(name)) {
    groups.add('chest');
    groups.add('arms');
    return [...groups];
  }
  if (/overhead press|military press/.test(name)) {
    groups.add('shoulders');
    groups.add('arms');
    return [...groups];
  }

  // Chest
  if (/bench|chest|fly|push.?up|pushup/.test(name)) groups.add('chest');

  // Back
  if (/\brow\b|pull|lat\b|deadlift|back/.test(name)) groups.add('back');

  // Shoulders — "press" but NOT bench press
  if (/shoulder|lateral raise|front raise|shrug/.test(name)) groups.add('shoulders');
  if (/press/.test(name) && !/bench/.test(name)) groups.add('shoulders');

  // Legs
  if (/squat|leg|lunge|calf|deadlift|hip thrust|glute/.test(name)) groups.add('legs');

  // Arms — "extension" but NOT leg extension
  if (/curl|tricep|bicep|\barm\b|hammer/.test(name)) groups.add('arms');
  if (/dip/.test(name)) groups.add('arms');
  if (/extension/.test(name) && !/leg extension/.test(name)) groups.add('arms');

  // Core
  if (/crunch|\bab\b|plank|sit.?up|situp|core|oblique|hanging leg raise/.test(name)) groups.add('core');

  return [...groups];
}

async function seedMuscleGroups() {
  const { data: exercises, error } = await supabase
    .from('exercise_metadata')
    .select('id, exercise_name');

  if (error) {
    console.error('Failed to fetch exercise_metadata:', error.message);
    process.exit(1);
  }

  let updated = 0;
  let unmatched = 0;

  for (const exercise of exercises) {
    const muscleGroups = getMuscleGroups(exercise.exercise_name);

    const { error: updateError } = await supabase
      .from('exercise_metadata')
      .update({ muscle_groups: muscleGroups })
      .eq('id', exercise.id);

    if (updateError) {
      console.error(`Failed to update ${exercise.exercise_name}:`, updateError.message);
      continue;
    }

    if (muscleGroups.length === 0) {
      unmatched++;
    } else {
      updated++;
    }
  }

  console.log(`Updated ${updated} exercises. ${unmatched} exercises unmatched.`);
}

seedMuscleGroups().catch(err => {
  console.error(err);
  process.exit(1);
});
