#!/usr/bin/env node
'use strict';

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const fs   = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

// ── Config ────────────────────────────────────────────────────────────────────

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const VIDEO_DIR = '/Users/artazayaz/Downloads/Exercise (whitout watermark)/exercise (whitout watermark)/men';
const DB_PATH   = path.resolve(__dirname, '../../gymvyn-frontend/src/data/exerciseDatabase.js');

// ── Helpers (same logic as uploadAllExerciseVideos.js) ────────────────────────

function normalize(str) {
  return str
    .replace(/\([\d]+\)/g, '')
    .replace(/\([^)]*\)/g, ' ')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function scoreMatch(videoFilename, exerciseName) {
  const vn = normalize(videoFilename);
  const en = normalize(exerciseName);
  if (vn === en) return 100;
  if (vn.includes(en) || en.includes(vn)) return 80;
  const vWords = new Set(vn.split(' ').filter(w => w.length > 1));
  const eWords = new Set(en.split(' ').filter(w => w.length > 1));
  if (vWords.size === 0 || eWords.size === 0) return 0;
  let shared = 0;
  for (const w of vWords) if (eWords.has(w)) shared++;
  return Math.round((shared / Math.max(vWords.size, eWords.size)) * 100);
}

function loadExerciseNames() {
  const content = fs.readFileSync(DB_PATH, 'utf8');
  const matches = [...content.matchAll(/"name":\s*"([^"]+)"/g)];
  return matches.map(m => m[1]);
}

function collectVideos(dir) {
  const results = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...collectVideos(fullPath));
    } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.mp4')) {
      const filename = path.basename(fullPath, '.mp4');
      results.push({ fullPath, filename });
    }
  }
  return results;
}

function findBestMatch(videoFilename, exerciseNames) {
  let bestName = null, bestScore = 0;
  for (const name of exerciseNames) {
    const score = scoreMatch(videoFilename, name);
    if (score > bestScore) { bestScore = score; bestName = name; }
  }
  return { matchedName: bestScore >= 50 ? bestName : null, score: bestScore };
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log('\n🔍  FitForge — Exercise Video Audit\n');

  // 1. Load exercise names from DB file
  const exerciseNames = loadExerciseNames();
  const exerciseSet = new Set(exerciseNames);
  console.log(`📚  exerciseDatabase.js: ${exerciseNames.length} exercises`);

  // 2. Query exercise_metadata for rows with video_url
  const { data: metaRows, error } = await supabase
    .from('exercise_metadata')
    .select('exercise_name, video_url, thumbnail_url, video_duration')
    .not('video_url', 'is', null);

  if (error) { console.error('Supabase error:', error.message); process.exit(1); }

  const uploadedMap = new Map(); // exercise_name → video_url
  for (const row of metaRows) {
    uploadedMap.set(row.exercise_name, row.video_url);
  }
  console.log(`🗄️   exercise_metadata with video_url: ${uploadedMap.size} rows`);

  // 3. Scan local video folder
  const videos = collectVideos(VIDEO_DIR);
  console.log(`📁  Local .mp4 files: ${videos.length}`);

  // ── Cross-reference ───────────────────────────────────────────────────────

  // List 1: IN DB + HAS VIDEO
  const inDbHasVideo = exerciseNames.filter(n => uploadedMap.has(n));

  // List 2: IN DB + NO VIDEO
  const inDbNoVideo = exerciseNames.filter(n => !uploadedMap.has(n));

  // For local videos: find best match in exerciseNames
  const videoMatches = videos.map(v => {
    const { matchedName, score } = findBestMatch(v.filename, exerciseNames);
    const inSupabase = matchedName ? uploadedMap.has(matchedName) : false;
    return { ...v, matchedName, score, inSupabase };
  });

  // Resolve duplicate video→exercise matches (keep highest score per exercise)
  const bestByExercise = new Map();
  for (const v of videoMatches) {
    if (!v.matchedName) continue;
    const existing = bestByExercise.get(v.matchedName);
    if (!existing || v.score > existing.score) {
      bestByExercise.set(v.matchedName, v);
    }
  }
  const winnerPaths = new Set([...bestByExercise.values()].map(v => v.fullPath));

  // List 3: LOCAL VIDEO + NOT UPLOADED (matched to a DB exercise but not yet in Supabase)
  const localNotUploaded = videoMatches.filter(v =>
    v.matchedName &&
    winnerPaths.has(v.fullPath) &&
    !uploadedMap.has(v.matchedName)
  );

  // List 4: LOCAL VIDEO + NOT IN DB (can't be fuzzy-matched to any exercise at score >= 50)
  const localNotInDb = videoMatches.filter(v => !v.matchedName);

  // ── Print results ──────────────────────────────────────────────────────────

  console.log('\n' + '═'.repeat(70));
  console.log('LIST 1 — IN DB + HAS VIDEO (keep these)');
  console.log('═'.repeat(70));
  for (const n of inDbHasVideo) console.log(`  ✓ ${n}`);
  console.log(`\n  Total: ${inDbHasVideo.length}`);

  console.log('\n' + '═'.repeat(70));
  console.log('LIST 2 — IN DB + NO VIDEO (will be removed in Phase 3)');
  console.log('═'.repeat(70));
  for (const n of inDbNoVideo) console.log(`  ✗ ${n}`);
  console.log(`\n  Total: ${inDbNoVideo.length}`);

  console.log('\n' + '═'.repeat(70));
  console.log('LIST 3 — LOCAL VIDEO + NOT UPLOADED (matched to DB exercise, ready to upload)');
  console.log('═'.repeat(70));
  for (const v of localNotUploaded) {
    console.log(`  [${v.score}] "${v.filename}" → "${v.matchedName}"`);
  }
  console.log(`\n  Total: ${localNotUploaded.length}`);

  console.log('\n' + '═'.repeat(70));
  console.log('LIST 4 — LOCAL VIDEO + NOT IN DB (no fuzzy match in exerciseDatabase.js)');
  console.log('═'.repeat(70));
  for (const v of localNotInDb) console.log(`  - ${v.filename}`);
  console.log(`\n  Total: ${localNotInDb.length}`);

  console.log('\n' + '═'.repeat(70));
  console.log('SUMMARY');
  console.log('═'.repeat(70));
  console.log(`  📚 Total exercises in DB       : ${exerciseNames.length}`);
  console.log(`  ✅ In DB + has video           : ${inDbHasVideo.length}`);
  console.log(`  ❌ In DB + no video            : ${inDbNoVideo.length}`);
  console.log(`  📁 Local video files           : ${videos.length}`);
  console.log(`  🆕 Local + not uploaded        : ${localNotUploaded.length}`);
  console.log(`  🤷 Local + no DB match         : ${localNotInDb.length}`);
  console.log('═'.repeat(70) + '\n');

  // Write lists to files for reference
  fs.writeFileSync(
    path.resolve(__dirname, 'audit-list2-no-video.txt'),
    inDbNoVideo.join('\n') + '\n'
  );
  fs.writeFileSync(
    path.resolve(__dirname, 'audit-list3-not-uploaded.txt'),
    localNotUploaded.map(v => `[${v.score}] "${v.filename}" → "${v.matchedName}"`).join('\n') + '\n'
  );
  fs.writeFileSync(
    path.resolve(__dirname, 'audit-list4-no-db-match.txt'),
    localNotInDb.map(v => v.filename).join('\n') + '\n'
  );

  console.log('📄  Written audit files:');
  console.log('    scripts/audit-list2-no-video.txt');
  console.log('    scripts/audit-list3-not-uploaded.txt');
  console.log('    scripts/audit-list4-no-db-match.txt\n');
}

main().catch(err => { console.error('\n❌  Fatal:', err.message); process.exit(1); });
