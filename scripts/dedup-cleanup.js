#!/usr/bin/env node
'use strict';

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const fs   = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const DB_PATH = path.resolve(__dirname, '../../gymvyn-frontend/src/data/exerciseDatabase.js');

// The 6 names to REMOVE — batch-2 duplicates of the richer original-120 entries
const TO_REMOVE = [
  'Band Assisted Pull-up',
  'Commando Pull-up',
  'Barbell Decline Bench Press',
  'Barbell Incline Bench Press',
  'Cable Standing Crunch',
  'Dumbbell Incline Curl',
];

// ── Parse exerciseDatabase.js ─────────────────────────────────────────────────

function parseExerciseDb(content) {
  const lines = content.split('\n');
  const arrayStartLine = lines.findIndex(l => l.trim().startsWith('export const EXERCISE_DATABASE = ['));
  const arrayEndLine   = lines.findIndex((l, i) => i > arrayStartLine && l.trim() === '];');
  if (arrayStartLine === -1 || arrayEndLine === -1) throw new Error('Cannot locate EXERCISE_DATABASE array');

  const header       = lines.slice(0, arrayStartLine + 1).join('\n');
  const footer       = '\n' + lines.slice(arrayEndLine).join('\n');
  const arrayContent = lines.slice(arrayStartLine + 1, arrayEndLine).join('\n');

  return { header, footer, exercises: JSON.parse('[' + arrayContent + ']') };
}

function writeExerciseDb(header, footer, exercises) {
  const entriesJson = exercises
    .map(ex => JSON.stringify(ex, null, 2).split('\n').map(l => '  ' + l).join('\n'))
    .join(',\n');
  const body = header + '\n' + entriesJson + '\n' + footer;
  return body.replace(
    /\/\/ \d+ exercises[^\n]*/,
    `// ${exercises.length} exercises — video-only`
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log('\n🧹  FitForge — Dedup Cleanup (removing 6 batch-2 duplicates)\n');

  const removeSet = new Set(TO_REMOVE);

  // ── Step 1: Confirm which names exist in exercise_metadata ─────────────────
  console.log('Verifying names in exercise_metadata...');
  const { data: existing, error: fetchErr } = await supabase
    .from('exercise_metadata')
    .select('exercise_name, video_url')
    .in('exercise_name', TO_REMOVE);

  if (fetchErr) throw new Error('Supabase fetch: ' + fetchErr.message);

  console.log(`  Found ${existing.length} of ${TO_REMOVE.length} to-remove names in Supabase:`);
  for (const r of existing) console.log(`    • ${r.exercise_name}`);

  const notFound = TO_REMOVE.filter(n => !existing.find(r => r.exercise_name === n));
  if (notFound.length) {
    console.log(`\n  ⚠️  Not found in exercise_metadata (already cleaned or name mismatch):`);
    for (const n of notFound) console.log(`    - ${n}`);
  }

  // ── Step 2: Delete from exercise_metadata ─────────────────────────────────
  console.log('\n🗑️   Deleting from exercise_metadata...');
  const { error: delErr } = await supabase
    .from('exercise_metadata')
    .delete()
    .in('exercise_name', TO_REMOVE);

  if (delErr) throw new Error('Supabase delete: ' + delErr.message);
  console.log(`  ✅  Deleted ${existing.length} rows`);

  // ── Step 3: Remove from exerciseDatabase.js ────────────────────────────────
  console.log('\n📚  Updating exerciseDatabase.js...');
  const content = fs.readFileSync(DB_PATH, 'utf8');
  const { header, footer, exercises } = parseExerciseDb(content);

  const before = exercises.length;
  const filtered = exercises.filter(ex => !removeSet.has(ex.name));
  const removed  = exercises.filter(ex => removeSet.has(ex.name)).map(e => e.name);
  const after    = filtered.length;

  // Re-sequence IDs
  filtered.forEach((ex, i) => { ex.id = i + 1; });

  fs.writeFileSync(DB_PATH, writeExerciseDb(header, footer, filtered), 'utf8');

  console.log(`  Removed from JS: ${removed.length} entries`);
  for (const n of removed) console.log(`    - ${n}`);
  if (removed.length < TO_REMOVE.length) {
    const missed = TO_REMOVE.filter(n => !removed.includes(n));
    console.log(`  ⚠️  Not found in exerciseDatabase.js:`);
    for (const n of missed) console.log(`    - ${n}`);
  }
  console.log(`  ✅  exerciseDatabase.js: ${before} → ${after} exercises`);

  // ── Step 4: Verify final counts ────────────────────────────────────────────
  console.log('\n🔍  Verifying final counts...');

  const { count: metaCount, error: countErr } = await supabase
    .from('exercise_metadata')
    .select('*', { count: 'exact', head: true })
    .not('video_url', 'is', null);

  if (countErr) throw new Error('Count error: ' + countErr.message);

  console.log(`\n${'═'.repeat(50)}`);
  console.log('FINAL STATE');
  console.log('═'.repeat(50));
  console.log(`  exerciseDatabase.js entries : ${after}`);
  console.log(`  exercise_metadata rows      : ${metaCount}`);
  console.log(`  Match                       : ${after === metaCount ? '✅  YES' : '❌  NO — mismatch!'}`);
  console.log(`  Expected                    : 418`);
  console.log(`  Correct                     : ${after === 418 && metaCount === 418 ? '✅  YES' : '⚠️   CHECK COUNTS'}`);
  console.log('═'.repeat(50) + '\n');
}

main().catch(err => { console.error('\n❌  Fatal:', err.message); process.exit(1); });
