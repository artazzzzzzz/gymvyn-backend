#!/usr/bin/env node
'use strict';

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const fs        = require('fs');
const path      = require('path');
const readline  = require('readline');
const cloudinary = require('cloudinary').v2;
const { createClient } = require('@supabase/supabase-js');

// ── Config ────────────────────────────────────────────────────────────────────

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key:    process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const VIDEO_DIR   = '/Users/artazayaz/Downloads/Exercise (whitout watermark)/exercise (whitout watermark)/men';
const DB_PATH     = path.resolve(__dirname, '../../fitforge-frontend/src/data/exerciseDatabase.js');
const UNMATCHED_OUT = path.resolve(__dirname, 'unmatched_videos.txt');

// ── Helpers ───────────────────────────────────────────────────────────────────

function normalize(str) {
  return str
    .replace(/\([\d]+\)/g, '')   // strip (1), (2), etc.
    .replace(/\([^)]*\)/g, ' ')  // strip other parenthetical content
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function slugify(str) {
  return str
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .trim();
}

function formatDuration(seconds) {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

function scoreMatch(videoFilename, exerciseName) {
  const vn = normalize(videoFilename);
  const en = normalize(exerciseName);

  // 1. Exact match
  if (vn === en) return 100;

  // 2. Substring
  if (vn.includes(en) || en.includes(vn)) return 80;

  // 3. Word overlap
  const vWords = new Set(vn.split(' ').filter(w => w.length > 1));
  const eWords = new Set(en.split(' ').filter(w => w.length > 1));
  if (vWords.size === 0 || eWords.size === 0) return 0;
  let shared = 0;
  for (const w of vWords) if (eWords.has(w)) shared++;
  const score = (shared / Math.max(vWords.size, eWords.size)) * 100;
  return Math.round(score);
}

function prompt(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => rl.question(question, ans => { rl.close(); resolve(ans.trim()); }));
}

// ── Step 1: Load exercise names ───────────────────────────────────────────────

function loadExerciseNames() {
  const content = fs.readFileSync(DB_PATH, 'utf8');
  const matches = [...content.matchAll(/"name":\s*"([^"]+)"/g)];
  return matches.map(m => m[1]);
}

// ── Step 2: Scan video files ──────────────────────────────────────────────────

function collectVideos(dir) {
  const results = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...collectVideos(fullPath));
    } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.mp4')) {
      const muscleGroup = path.basename(path.dirname(fullPath));
      const filename    = path.basename(fullPath, '.mp4');
      results.push({ fullPath, filename, muscleGroup });
    }
  }
  return results;
}

// ── Step 3: Fuzzy match ───────────────────────────────────────────────────────

function buildMatches(videos, exerciseNames) {
  // exercise_name → best video match so far
  const bestByExercise = new Map(); // exerciseName → { video, score }

  const videoResults = videos.map(video => {
    let bestName  = null;
    let bestScore = 0;

    for (const name of exerciseNames) {
      const score = scoreMatch(video.filename, name);
      if (score > bestScore) {
        bestScore = score;
        bestName  = name;
      }
    }

    return { ...video, matchedName: bestScore >= 50 ? bestName : null, score: bestScore };
  });

  // Resolve duplicates: if two videos match the same exercise, keep highest score
  const conflicts = [];
  for (const v of videoResults) {
    if (!v.matchedName) continue;
    const existing = bestByExercise.get(v.matchedName);
    if (!existing) {
      bestByExercise.set(v.matchedName, v);
    } else if (v.score > existing.score) {
      conflicts.push(`  CONFLICT: "${v.filename}" (${v.score}) beats "${existing.filename}" (${existing.score}) for "${v.matchedName}"`);
      bestByExercise.set(v.matchedName, v);
    } else {
      conflicts.push(`  CONFLICT: "${existing.filename}" (${existing.score}) kept over "${v.filename}" (${v.score}) for "${v.matchedName}"`);
    }
  }

  // Rebuild final list: matched = winning video per exercise, unmatched = rest
  const winnerPaths = new Set([...bestByExercise.values()].map(v => v.fullPath));
  const matched   = videoResults.filter(v => v.matchedName && winnerPaths.has(v.fullPath));
  const unmatched = videoResults.filter(v => !v.matchedName || !winnerPaths.has(v.fullPath));

  return { matched, unmatched, conflicts };
}

// ── Step 4: Print preview ─────────────────────────────────────────────────────

function printPreview(matched, unmatched, conflicts) {
  const COL1 = 42, COL2 = 36;
  const line = '─'.repeat(COL1 + COL2 + 10);

  console.log('\n' + line);
  console.log('VIDEO FILE'.padEnd(COL1) + 'EXERCISE NAME'.padEnd(COL2) + 'SCORE');
  console.log(line);

  for (const m of matched) {
    const fn = m.filename.length > COL1 - 2
      ? m.filename.slice(0, COL1 - 5) + '...'
      : m.filename;
    const en = m.matchedName.length > COL2 - 2
      ? m.matchedName.slice(0, COL2 - 5) + '...'
      : m.matchedName;
    console.log(fn.padEnd(COL1) + en.padEnd(COL2) + m.score);
  }

  console.log(line);

  if (unmatched.length > 0) {
    console.log(`\nUNMATCHED (${unmatched.length}):`);
    for (const u of unmatched) console.log(`  - ${u.filename}`);
  }

  if (conflicts.length > 0) {
    console.log('\nDUPLICATE CONFLICTS RESOLVED:');
    for (const c of conflicts) console.log(c);
  }

  console.log(`\n✅  ${matched.length} matched  |  ❌  ${unmatched.length} unmatched  |  📁  ${matched.length + unmatched.length} total\n`);
}

// ── Step 5: Upload ────────────────────────────────────────────────────────────

async function getAlreadyUploaded() {
  const { data } = await supabase
    .from('exercise_metadata')
    .select('exercise_name')
    .not('video_url', 'is', null);
  return new Set((data || []).map(r => r.exercise_name));
}

async function uploadOne(video, idx, total) {
  const publicId = `fitforge/exercises/${slugify(video.matchedName)}`;

  const result = await cloudinary.uploader.upload(video.fullPath, {
    resource_type: 'video',
    folder:        'fitforge/exercises',
    public_id:     slugify(video.matchedName),
    overwrite:     true,
    use_filename:  false,
  });

  const duration = result.duration ? formatDuration(result.duration) : null;

  await supabase.from('exercise_metadata').upsert(
    {
      exercise_name:  video.matchedName,
      video_url:      result.secure_url,
      video_duration: duration,
      updated_at:     new Date().toISOString(),
    },
    { onConflict: 'exercise_name' }
  );

  return duration;
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log('\n🎬  FitForge — Upload All Exercise Videos\n');

  if (!process.env.CLOUDINARY_CLOUD_NAME) {
    console.error('❌  CLOUDINARY_CLOUD_NAME not set — check .env'); process.exit(1);
  }

  // Step 1
  const exerciseNames = loadExerciseNames();
  console.log(`📚  ${exerciseNames.length} exercise names loaded`);

  // Step 2
  const videos = collectVideos(VIDEO_DIR);
  console.log(`🎥  ${videos.length} video files found`);

  // Step 3
  const { matched, unmatched, conflicts } = buildMatches(videos, exerciseNames);

  // Step 4
  printPreview(matched, unmatched, conflicts);

  const answer = await prompt(`Proceed with uploading ${matched.length} videos to Cloudinary? (y/n) `);
  if (answer.toLowerCase() !== 'y') { console.log('Aborted.'); process.exit(0); }

  // Step 5
  const alreadyUploaded = await getAlreadyUploaded();
  console.log(`\n⏭   ${alreadyUploaded.size} already in exercise_metadata (will skip)\n`);

  let uploaded = 0, failed = 0, skipped = 0;
  const failedList = [];
  const total = matched.length;

  for (let i = 0; i < matched.length; i++) {
    const video = matched[i];
    const tag   = `(${i + 1}/${total})`;

    if (alreadyUploaded.has(video.matchedName)) {
      console.log(`⏭   ${tag} ${video.matchedName} → already uploaded`);
      skipped++;
      continue;
    }

    try {
      const duration = await uploadOne(video, i + 1, total);
      console.log(`✓ ${tag} ${video.matchedName} → ${duration ?? 'n/a'}`);
      uploaded++;
    } catch (err) {
      console.error(`✗ ${tag} ${video.matchedName} → ERROR: ${err.message}`);
      failedList.push({ name: video.matchedName, file: video.filename, error: err.message });
      failed++;
    }
  }

  // Step 6
  const unmatchedLines = unmatched.map(u => u.filename).join('\n');
  fs.writeFileSync(UNMATCHED_OUT, unmatchedLines + '\n');

  const summary = [
    '',
    '══════════════════════════════════════',
    '  UPLOAD COMPLETE',
    '══════════════════════════════════════',
    `  ✓ Uploaded : ${uploaded}`,
    `  ⏭ Skipped  : ${skipped}`,
    `  ✗ Failed   : ${failed}`,
    `  ❌ Unmatched: ${unmatched.length}`,
    `  📁 Total    : ${videos.length} videos`,
    '══════════════════════════════════════',
  ].join('\n');

  console.log(summary);

  if (failedList.length > 0) {
    console.log('\nFailed uploads:');
    for (const f of failedList) console.log(`  ✗ ${f.name} (${f.file}): ${f.error}`);
  }

  console.log(`\n📄  Unmatched list written to: ${UNMATCHED_OUT}\n`);
}

main().catch(err => { console.error('\n❌  Fatal:', err.message); process.exit(1); });
