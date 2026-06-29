require('dotenv').config({ path: '.env' })
const { createClient } = require('@supabase/supabase-js')
const fs = require('fs')
const path = require('path')

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
)

const MUSCLE_FILES = [
  'back', 'biceps', 'calves', 'cardio', 'chest',
  'core_abs', 'forearms', 'glutes', 'hamstrings',
  'quads', 'shoulders', 'triceps'
]

const MUSCLE_DIR = path.join(process.env.HOME, 'Desktop/exercises_by_muscle')

async function run() {
  // Load all exercises from JSON files
  let allExercises = []
  for (const file of MUSCLE_FILES) {
    const filePath = path.join(MUSCLE_DIR, `${file}.json`)
    if (!fs.existsSync(filePath)) {
      const alt = path.join(MUSCLE_DIR, file)
      if (!fs.existsSync(alt)) { console.log(`MISSING: ${filePath}`); continue }
    }
    const raw = fs.readFileSync(filePath, 'utf8')
    const parsed = JSON.parse(raw)
    const arr = Array.isArray(parsed) ? parsed : Object.values(parsed)
    allExercises = allExercises.concat(arr)
  }
  console.log(`Loaded ${allExercises.length} exercises from JSON files`)

  // Fetch existing exercise names from DB to avoid duplicates
  const { data: existing, error: fetchErr } = await supabase
    .from('exercises')
    .select('name')
  if (fetchErr) throw fetchErr

  const existingNames = new Set(existing.map(e => e.name.toLowerCase().trim()))
  console.log(`DB currently has ${existingNames.size} exercises`)

  // Deduplicate within the JSON files themselves (by name)
  const seen = new Set()
  const toInsert = []
  for (const ex of allExercises) {
    const norm = ex.name.toLowerCase().trim()
    if (seen.has(norm)) continue
    if (existingNames.has(norm)) { seen.add(norm); continue }
    seen.add(norm)
    toInsert.push({
      name: ex.name.trim(),
      muscle_group: ex.muscle_group || null,
      equipment: ex.equipment || null,
      difficulty: ex.difficulty || null,
      video_url: null,
      instructions: null,
    })
  }
  console.log(`New exercises to insert: ${toInsert.length}`)
  console.log(`Skipping ${allExercises.length - toInsert.length} (already in DB or duplicate in JSON)`)

  if (toInsert.length === 0) {
    console.log('Nothing to insert.')
    return
  }

  // Insert in batches of 100
  const BATCH = 100
  let inserted = 0
  let failed = []
  for (let i = 0; i < toInsert.length; i += BATCH) {
    const batch = toInsert.slice(i, i + BATCH)
    const { error } = await supabase.from('exercises').insert(batch)
    if (error) {
      console.log(`Batch ${i}-${i + BATCH} ERROR: ${error.message}`)
      failed = failed.concat(batch.map(e => e.name))
    } else {
      inserted += batch.length
      console.log(`Inserted batch ${i}-${i + BATCH - 1} (${inserted} total so far)`)
    }
  }

  console.log(`\nDone. Inserted: ${inserted}, Failed: ${failed.length}`)
  if (failed.length) console.log('Failed:', failed)

  // Final count
  const { count } = await supabase
    .from('exercises')
    .select('*', { count: 'exact', head: true })
  console.log(`Final DB exercise count: ${count}`)
}

run().catch(console.error)
