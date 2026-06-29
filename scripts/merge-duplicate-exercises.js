require('dotenv').config({ path: '.env' })
const { createClient } = require('@supabase/supabase-js')

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY
)

// Each pair: keep the first name, delete the second
const DUPLICATES = [
  { keep: 'Bench Dips',                                    remove: 'Bench Dips' },
  { keep: 'Burpee',                                        remove: 'Burpees' },
  { keep: 'Jumping Jack',                                  remove: 'Jumping Jacks' },
  { keep: 'Running',                                       remove: 'Treadmill Running' },
  { keep: 'Sit-up',                                        remove: 'Sit-ups' },
  { keep: 'Stretching - Calf Stretch with Rope',           remove: 'Stretching - Calf Stretch with Strap' },
  { keep: 'Chest Dip',                                     remove: 'Chest Dips' },
  { keep: 'Push Up',                                       remove: 'Push-ups' },
]

const REFERENCING_TABLES = [
  { table: 'workout_set_logs',   column: 'exercise_id' },
  { table: 'exercise_metadata',  column: 'exercise_id' },
  { table: 'exercise_bookmarks', column: 'exercise_id' },
  { table: 'personal_records',   column: 'exercise_id' },
]

async function run() {
  const { data: allExercises, error } = await supabase
    .from('exercises')
    .select('id, name')

  if (error) throw error

  console.log(`Starting exercise count: ${allExercises.length}`)

  const normalise = s => s.toLowerCase().replace(/[^a-z0-9 ]/g, '').trim()

  for (const pair of DUPLICATES) {
    const keepNorm   = normalise(pair.keep)
    const removeNorm = normalise(pair.remove)

    const keepMatches   = allExercises.filter(e => normalise(e.name) === keepNorm)
    const removeMatches = allExercises.filter(e => normalise(e.name) === removeNorm)

    // Same name listed twice — keep lower ID, remove higher
    if (pair.keep === pair.remove) {
      if (keepMatches.length < 2) {
        console.log(`SKIP "${pair.keep}" — only one row found, no duplicate`)
        continue
      }
      const sorted = keepMatches.sort((a, b) => a.id.localeCompare(b.id))
      const keepId   = sorted[0].id
      const removeId = sorted[1].id
      await mergeExercise(keepId, removeId, pair.keep)
      continue
    }

    if (!keepMatches.length) {
      console.log(`SKIP — keep target not found: "${pair.keep}"`)
      continue
    }
    if (!removeMatches.length) {
      console.log(`SKIP — remove target not found: "${pair.remove}"`)
      continue
    }

    const keepId   = keepMatches[0].id
    const removeId = removeMatches[0].id

    if (keepId === removeId) {
      console.log(`SKIP — same row: "${pair.keep}"`)
      continue
    }

    await mergeExercise(keepId, removeId, pair.keep)
  }

  const { data: finalExercises } = await supabase.from('exercises').select('id')
  console.log(`\nFinal exercise count: ${finalExercises?.length ?? '?'}`)
  console.log('\nDone.')
}

async function mergeExercise(keepId, removeId, label) {
  console.log(`\nMerging "${label}": keep=${keepId}, remove=${removeId}`)

  for (const ref of REFERENCING_TABLES) {
    const { data: existingKeep } = await supabase
      .from(ref.table)
      .select('id')
      .eq(ref.column, keepId)
      .limit(1)

    const { data: existingRemove } = await supabase
      .from(ref.table)
      .select('id')
      .eq(ref.column, removeId)
      .limit(1)

    if (!existingRemove || existingRemove.length === 0) {
      console.log(`  ${ref.table}: nothing to migrate`)
      continue
    }

    if (existingKeep && existingKeep.length > 0 && ref.table === 'exercise_metadata') {
      console.log(`  ${ref.table}: both rows exist — deleting duplicate metadata for removed exercise`)
      await supabase.from(ref.table).delete().eq(ref.column, removeId)
    } else {
      const { error } = await supabase
        .from(ref.table)
        .update({ [ref.column]: keepId })
        .eq(ref.column, removeId)
      if (error) console.log(`  ${ref.table}: ERROR — ${error.message}`)
      else console.log(`  ${ref.table}: re-pointed`)
    }
  }

  const { error: delError } = await supabase
    .from('exercises')
    .delete()
    .eq('id', removeId)

  if (delError) console.log(`  exercises: DELETE ERROR — ${delError.message}`)
  else console.log(`  exercises: deleted duplicate row`)
}

run().catch(console.error)
