const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

async function findExerciseMatches({ spokenName, muscleGroupHint, limit = 5 }) {
  if (!spokenName || !spokenName.trim()) return [];

  const { data, error } = await supabase.rpc('search_exercises_fuzzy', {
    spoken_name: spokenName.trim(),
    muscle_hint: muscleGroupHint || null,
    result_limit: limit,
  });

  if (error) throw new Error(`Fuzzy match failed: ${error.message}`);
  if (!data || data.length === 0) return [];

  return data.map(row => ({
    id: row.id,
    name: row.name,
    muscle_group: row.muscle_group,
    similarity_score: row.similarity_score,
  }));
}

module.exports = { findExerciseMatches };
