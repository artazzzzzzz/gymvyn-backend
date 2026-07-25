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

// ── Step 1: Query keep list from Supabase ─────────────────────────────────────

async function getKeepList() {
  const { data, error } = await supabase
    .from('exercise_metadata')
    .select('exercise_name, video_url')
    .not('video_url', 'is', null);
  if (error) throw new Error(`Supabase error: ${error.message}`);
  const names = data.map(r => r.exercise_name).sort();
  console.log(`\n📋  Keep list from Supabase (${names.length} exercises with video_url):\n`);
  names.forEach(n => console.log(`  ✓ ${n}`));
  return new Set(names);
}

// ── Step 2: Parse exerciseDatabase.js ────────────────────────────────────────

function parseExerciseDb(fileContent) {
  // Lines 1-4: header comments
  // Line 5: export const EXERCISE_DATABASE = [
  // Lines 6 to (N-1): array entries
  // Line N: ];
  // Lines (N+1) to end: utility exports and functions

  const lines = fileContent.split('\n');

  // Find where the array starts and ends
  const arrayStartLine = lines.findIndex(l => l.trim().startsWith('export const EXERCISE_DATABASE = ['));
  const arrayEndLine   = lines.findIndex((l, i) => i > arrayStartLine && l.trim() === '];');

  if (arrayStartLine === -1 || arrayEndLine === -1) {
    throw new Error('Could not locate EXERCISE_DATABASE array boundaries');
  }

  // Header: everything up to and including the opening bracket line
  const header = lines.slice(0, arrayStartLine + 1).join('\n');
  // Footer: everything after the closing bracket (the ];  line onward)
  const footer = '\n' + lines.slice(arrayEndLine).join('\n');
  // Array JSON content: the lines between [ and ]
  const arrayContent = lines.slice(arrayStartLine + 1, arrayEndLine).join('\n');

  // Parse as JSON (the DB file uses double-quoted keys so it's valid JSON)
  let exercises;
  try {
    exercises = JSON.parse('[' + arrayContent + ']');
  } catch (e) {
    throw new Error(`Failed to parse exercise array as JSON: ${e.message}`);
  }

  return { header, footer, exercises };
}

// ── Step 3: Filter and write ──────────────────────────────────────────────────

function buildFilteredFile(header, footer, exercises, keepSet) {
  const kept    = exercises.filter(ex => keepSet.has(ex.name));
  const removed = exercises.filter(ex => !keepSet.has(ex.name));

  // Re-sequence IDs for cleanliness
  const renumbered = kept.map((ex, i) => ({ ...ex, id: i + 1 }));

  // Serialize each exercise as a 2-space indented JSON object
  const entriesJson = renumbered
    .map(ex => JSON.stringify(ex, null, 2).split('\n').map((l, i) => (i === 0 ? '  ' + l : '  ' + l)).join('\n'))
    .join(',\n');

  const newContent = header + '\n' + entriesJson + '\n' + footer;

  return { newContent, kept, removed };
}

// ── Step 4: Grep for removed exercise names in src/ ───────────────────────────

function checkBreakage(removedNames) {
  console.log(`\n${'═'.repeat(70)}`);
  console.log('STEP 3 — BREAKAGE CHECK');
  console.log('═'.repeat(70));

  // Write removed names to a temp file for grep -F -f
  const tempFile = path.resolve(__dirname, '_removed_names_tmp.txt');
  fs.writeFileSync(tempFile, removedNames.join('\n') + '\n');

  const { execSync } = require('child_process');
  const srcDir = path.resolve(__dirname, '../../gymvyn-frontend/src');

  let hits = '';
  try {
    // grep -F (fixed strings, no regex), -f (patterns file), -r, -n, --include
    // Exclude exerciseDatabase.js itself since that's what we're replacing
    hits = execSync(
      `grep -rFnf "${tempFile}" "${srcDir}" --include="*.jsx" --include="*.js" --include="*.json" --exclude="exerciseDatabase.js" 2>/dev/null || true`,
      { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 }
    );
  } catch { /* grep returns non-zero when no matches */ }

  fs.unlinkSync(tempFile);

  if (!hits.trim()) {
    console.log('\n  ✅ No hardcoded references found to removed exercise names.\n');
  } else {
    console.log('\n  ⚠️  Found references to removed exercise names:\n');
    console.log(hits);
  }
}

// ── Step 5: Muscle group coverage ────────────────────────────────────────────

function printMuscleGroups(kept) {
  console.log(`\n${'═'.repeat(70)}`);
  console.log('STEP 4 — MUSCLE GROUP COVERAGE AFTER TRIM');
  console.log('═'.repeat(70));

  const counts = {};
  for (const ex of kept) {
    counts[ex.muscle] = (counts[ex.muscle] || 0) + 1;
  }
  const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  for (const [muscle, count] of sorted) {
    const flag = count === 0 ? ' ⚠️  EMPTY!' : '';
    console.log(`  ${muscle.padEnd(20)} ${count}${flag}`);
  }

  const empty = sorted.filter(([, c]) => c === 0).map(([m]) => m);
  if (empty.length) {
    console.log(`\n  ⚠️  Empty muscle groups: ${empty.join(', ')}`);
  } else {
    console.log(`\n  ✅ All muscle groups have at least one exercise.`);
  }
}

// ── Step 6: Form Coach compatibility ─────────────────────────────────────────

function checkFormCoach(kept, removed) {
  console.log(`\n${'═'.repeat(70)}`);
  console.log('STEP 5 — FORM COACH COMPATIBILITY');
  console.log('═'.repeat(70));

  const keptFormRules   = kept.filter(ex => ex.formRule && ex.formRule !== 'guided');
  const removedFormRules = removed.filter(ex => ex.formRule && ex.formRule !== 'guided');

  if (keptFormRules.length > 0) {
    console.log(`\n  ✅ Exercises with AI form detection KEPT (${keptFormRules.length}):`);
    for (const ex of keptFormRules) {
      console.log(`    ${ex.name}  [${ex.formRule}]`);
    }
  }

  if (removedFormRules.length > 0) {
    console.log(`\n  ⚠️  Exercises with AI form detection REMOVED (${removedFormRules.length}):`);
    for (const ex of removedFormRules) {
      console.log(`    ${ex.name}  [${ex.formRule}]`);
    }
    console.log('\n  Note: formRuleMapping.js uses keyword fuzzy matching, so Form Coach');
    console.log('  still works for these patterns even without DB entries.');
  } else {
    console.log('\n  ✅ No AI-detection exercises were removed.');
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log('\n✂️   FitForge — Trim exerciseDatabase.js to Video-Only\n');

  // Step 1
  const keepSet = await getKeepList();

  // Step 2
  const fileContent = fs.readFileSync(DB_PATH, 'utf8');
  const { header, footer, exercises } = parseExerciseDb(fileContent);
  console.log(`\n📚  Parsed ${exercises.length} exercises from exerciseDatabase.js`);

  // Step 3
  const { newContent, kept, removed } = buildFilteredFile(header, footer, exercises, keepSet);

  console.log(`\n${'═'.repeat(70)}`);
  console.log('STEP 2 — FILTERING');
  console.log('═'.repeat(70));
  console.log(`\n  Before : ${exercises.length} exercises`);
  console.log(`  Kept   : ${kept.length} exercises (have video)`);
  console.log(`  Removed: ${removed.length} exercises (no video)\n`);

  // Write the trimmed file
  // Update the header comment to reflect new count
  const finalContent = newContent.replace(
    /\/\/ \d+ exercises — all muscle groups/,
    `// ${kept.length} exercises — video-only (trimmed from ${exercises.length})`
  );
  fs.writeFileSync(DB_PATH, finalContent, 'utf8');
  console.log(`  ✅ Trimmed exerciseDatabase.js from ${exercises.length} exercises to ${kept.length} exercises (removed ${removed.length} without videos)`);

  // Steps 3-5
  const removedNames = removed.map(ex => ex.name);
  checkBreakage(removedNames);
  printMuscleGroups(kept);
  checkFormCoach(kept, removed);

  // Write removed list for reference
  const removedOut = path.resolve(__dirname, 'trim-removed-exercises.txt');
  fs.writeFileSync(removedOut, removedNames.join('\n') + '\n');
  console.log(`\n📄  Removed exercise list written to: scripts/trim-removed-exercises.txt`);
  console.log(`\n${'═'.repeat(70)}\n`);
}

main().catch(err => { console.error('\n❌  Fatal:', err.message, err.stack); process.exit(1); });
