#!/usr/bin/env node
'use strict';

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const fs        = require('fs');
const path      = require('path');
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

const VIDEO_DIR    = '/Users/artazayaz/Downloads/Exercise (whitout watermark)/exercise (whitout watermark)/men';
const DB_PATH      = path.resolve(__dirname, '../../gymvyn-frontend/src/data/exerciseDatabase.js');
const FAILURES_OUT = path.resolve(__dirname, 'upload-failures-batch2.txt');

// ── Muscle group folder → DB muscle name ──────────────────────────────────────

const FOLDER_MUSCLE_MAP = {
  chest:     'Chest',
  back:      'Back',
  shoulders: 'Shoulders',
  biceps:    'Biceps',
  triceps:   'Triceps',
  abs:       'Core/Abs',
  calves:    'Calves',
  cardio:    'Cardio',
  forearms:  'Forearms',
  trapezius: 'Back', // traps are under Back in the existing DB
};

// For the "Hips" folder — exercise names are a mix of Quads/Hamstrings/Glutes
function muscleFromHips(name) {
  const n = name.toLowerCase();
  if (/curl|femoral|hamstring|rdl|romanian/.test(n)) return 'Hamstrings';
  if (/hip thrust|glute|bridge|abduct|adduct|kickback|rear kick/.test(n)) return 'Glutes';
  if (/stretch|flexibility/.test(n)) return 'Quads';
  // squat, lunge, leg press, leg extension, step, sissy → Quads
  return 'Quads';
}

function getMuscle(folderName, exerciseName) {
  const key = folderName.toLowerCase();
  if (key === 'hips') return muscleFromHips(exerciseName);
  return FOLDER_MUSCLE_MAP[key] || 'Back';
}

// ── Equipment detection ───────────────────────────────────────────────────────

function guessEquipment(name) {
  const n = name.toLowerCase();
  if (/\bez\s?bar\b/.test(n))       return 'EZ Bar';
  if (/barbell|bar grip/.test(n))   return 'Barbell';
  if (/dumbbell/.test(n))           return 'Dumbbell';
  if (/kettlebell/.test(n))         return 'Kettlebell';
  if (/cable/.test(n))              return 'Cable';
  if (/\bband\b|resistance/.test(n)) return 'Resistance Band';
  if (/lever|machine|sled|smith|hack squat machine/.test(n)) return 'Machine';
  if (/treadmill|stationary bike|elliptical|rowing machine|skierg|spin|assault/.test(n)) return 'Machine';
  return 'Bodyweight';
}

// ── Type detection ────────────────────────────────────────────────────────────

function guessType(name) {
  const n = name.toLowerCase();
  if (/squat|deadlift|\bpress\b|row|pull|lunge|clean|dip|push.?up|pushup/.test(n)) return 'Compound';
  return 'Isolation';
}

// ── Difficulty guess ──────────────────────────────────────────────────────────

function guessDifficulty(name) {
  const n = name.toLowerCase();
  if (/stretch|band |bodyweight|crunch|sit.up|plank|jumping jack|jump rope/.test(n)) return 'Beginner';
  if (/snatch|clean|muscle.up|pistol|handstand|dragon|l.sit/.test(n)) return 'Advanced';
  return 'Intermediate';
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function cleanFilename(raw) {
  // Strip (1), (2) etc; also strip trailing parentheticals like "(on bench)"
  return raw
    .replace(/\s*\(\d+\)\s*$/, '')  // trailing (1), (2)
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

// ── Step 1: Scan video folder ─────────────────────────────────────────────────

function collectVideos(dir) {
  const results = [];
  const seen = new Set(); // deduplicate by cleaned name

  for (const folder of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!folder.isDirectory()) continue;
    const folderPath = path.join(dir, folder.name);
    const files = fs.readdirSync(folderPath, { withFileTypes: true });

    for (const file of files) {
      if (!file.isFile() || !file.name.toLowerCase().endsWith('.mp4')) continue;
      const rawName = path.basename(file.name, '.mp4');
      const cleanName = cleanFilename(rawName);

      if (seen.has(cleanName.toLowerCase())) {
        console.log(`  ⚠️  Skipping duplicate: "${file.name}" (already have "${cleanName}")`);
        continue;
      }
      seen.add(cleanName.toLowerCase());

      results.push({
        fullPath:   path.join(folderPath, file.name),
        rawName,
        exerciseName: cleanName,
        folderName:   folder.name,
      });
    }
  }

  return results;
}

// ── Step 2: Get already-uploaded exercises from Supabase ──────────────────────

async function getUploadedNames() {
  const { data, error } = await supabase
    .from('exercise_metadata')
    .select('exercise_name')
    .not('video_url', 'is', null);
  if (error) throw new Error(`Supabase error: ${error.message}`);
  // Store as lowercase for case-insensitive comparison
  return new Set((data || []).map(r => r.exercise_name.toLowerCase()));
}

// ── Step 3: Upload to Cloudinary ──────────────────────────────────────────────

async function uploadVideo(video) {
  const result = await cloudinary.uploader.upload(video.fullPath, {
    resource_type: 'video',
    folder:        'fitforge/exercises',
    public_id:     slugify(video.exerciseName),
    overwrite:     true,
    use_filename:  false,
  });

  return {
    videoUrl:  result.secure_url,
    duration:  result.duration ? formatDuration(result.duration) : null,
  };
}

// ── Step 4: Generate minimal exercise entry ───────────────────────────────────

function generateEntry(video, nextId) {
  const muscle = getMuscle(video.folderName, video.exerciseName);
  return {
    id:               nextId,
    name:             video.exerciseName,
    muscle,
    secondary:        [],
    equipment:        guessEquipment(video.exerciseName),
    difficulty:       guessDifficulty(video.exerciseName),
    mechanics:        guessType(video.exerciseName),
    force:            'N/A',
    instructions:     ['Perform the exercise with proper form and controlled movement.'],
    tips:             ['Focus on muscle engagement throughout the full range of motion.'],
    formRule:         'guided',
  };
}

// ── Step 5: Parse + write exerciseDatabase.js ─────────────────────────────────

function parseExerciseDb(content) {
  const lines = content.split('\n');
  const arrayStartLine = lines.findIndex(l => l.trim().startsWith('export const EXERCISE_DATABASE = ['));
  const arrayEndLine   = lines.findIndex((l, i) => i > arrayStartLine && l.trim() === '];');
  if (arrayStartLine === -1 || arrayEndLine === -1) throw new Error('Cannot find EXERCISE_DATABASE array');

  const header       = lines.slice(0, arrayStartLine + 1).join('\n');
  const footer       = '\n' + lines.slice(arrayEndLine).join('\n');
  const arrayContent = lines.slice(arrayStartLine + 1, arrayEndLine).join('\n');

  let exercises;
  try {
    exercises = JSON.parse('[' + arrayContent + ']');
  } catch (e) {
    throw new Error(`JSON parse failed: ${e.message}`);
  }
  return { header, footer, exercises };
}

function writeExerciseDb(header, footer, exercises) {
  const entriesJson = exercises
    .map(ex =>
      JSON.stringify(ex, null, 2)
        .split('\n')
        .map(l => '  ' + l)
        .join('\n')
    )
    .join(',\n');

  const newContent = header + '\n' + entriesJson + '\n' + footer;

  // Update header comment to reflect new count
  return newContent.replace(
    /\/\/ \d+ exercises[^\n]*/,
    `// ${exercises.length} exercises — video-only`
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log('\n🏋️  FitForge — Add Remaining Exercise Videos\n');

  if (!process.env.CLOUDINARY_CLOUD_NAME) {
    console.error('❌  CLOUDINARY_CLOUD_NAME not set'); process.exit(1);
  }

  // ── Step 1: Scan local videos ──────────────────────────────────────────────
  console.log('📁  Scanning video folder...');
  const allVideos = collectVideos(VIDEO_DIR);
  console.log(`    Found ${allVideos.length} unique videos total\n`);

  // ── Step 2: Filter to unuploaded ──────────────────────────────────────────
  console.log('🗄️   Querying exercise_metadata for already-uploaded...');
  const uploadedNames = await getUploadedNames();
  console.log(`    Already uploaded: ${uploadedNames.size}\n`);

  const toProcess = allVideos.filter(v => !uploadedNames.has(v.exerciseName.toLowerCase()));
  console.log(`📋  Videos to upload: ${toProcess.length}\n`);

  if (toProcess.length === 0) {
    console.log('✅  Nothing to do — all videos already uploaded.\n');
    return;
  }

  // Print the list
  console.log('─'.repeat(60));
  for (const v of toProcess) {
    console.log(`  [${v.folderName}] ${v.exerciseName}`);
  }
  console.log('─'.repeat(60) + '\n');

  // ── Step 3: Upload to Cloudinary ──────────────────────────────────────────
  console.log('☁️   Uploading to Cloudinary...\n');

  const uploaded  = []; // { video, videoUrl, duration }
  const failures  = [];
  const total     = toProcess.length;

  for (let i = 0; i < toProcess.length; i++) {
    const video = toProcess[i];
    const tag   = `(${i + 1}/${total})`;

    try {
      const { videoUrl, duration } = await uploadVideo(video);
      console.log(`  ✓ ${tag} ${video.exerciseName} → ${duration ?? 'n/a'}`);
      uploaded.push({ video, videoUrl, duration });
    } catch (err) {
      console.error(`  ✗ ${tag} ${video.exerciseName} → ${err.message}`);
      failures.push({ name: video.exerciseName, file: video.fullPath, error: err.message });
    }
  }

  if (failures.length > 0) {
    fs.writeFileSync(FAILURES_OUT, failures.map(f => `${f.name}\t${f.error}`).join('\n') + '\n');
    console.log(`\n⚠️   ${failures.length} upload failures written to upload-failures-batch2.txt`);
  }

  console.log(`\n✓  Uploaded: ${uploaded.length}  ✗  Failed: ${failures.length}\n`);

  if (uploaded.length === 0) {
    console.log('Nothing to add to DB.\n');
    return;
  }

  // ── Step 4: Parse exerciseDatabase.js ─────────────────────────────────────
  console.log('📚  Reading exerciseDatabase.js...');
  const fileContent = fs.readFileSync(DB_PATH, 'utf8');
  const { header, footer, exercises: existingExercises } = parseExerciseDb(fileContent);
  console.log(`    Current count: ${existingExercises.length} exercises`);

  const existingNames = new Set(existingExercises.map(e => e.name.toLowerCase()));
  let nextId = Math.max(...existingExercises.map(e => e.id || 0)) + 1;

  // ── Step 5: Generate entries + collect metadata upserts ───────────────────
  console.log('\n⚙️   Generating exercise entries...');

  const newEntries  = [];
  const metaUpserts = [];

  for (const { video, videoUrl, duration } of uploaded) {
    // Skip if already in exerciseDatabase.js (by name)
    if (existingNames.has(video.exerciseName.toLowerCase())) {
      console.log(`  ⏭  ${video.exerciseName} already in exerciseDatabase.js — skipping DB entry`);
      // Still upsert metadata
      metaUpserts.push({
        exercise_name:  video.exerciseName,
        video_url:      videoUrl,
        video_duration: duration,
        updated_at:     new Date().toISOString(),
      });
      continue;
    }

    const entry = generateEntry(video, nextId++);
    newEntries.push(entry);
    existingNames.add(video.exerciseName.toLowerCase());

    metaUpserts.push({
      exercise_name:  video.exerciseName,
      video_url:      videoUrl,
      video_duration: duration,
      updated_at:     new Date().toISOString(),
    });

    console.log(`  + ${video.exerciseName}  [${entry.muscle}]`);
  }

  // ── Step 6: Append + sort exerciseDatabase.js ─────────────────────────────
  console.log(`\n✏️   Appending ${newEntries.length} new entries to exerciseDatabase.js...`);

  const allExercises = [...existingExercises, ...newEntries]
    .sort((a, b) => a.name.localeCompare(b.name));

  // Re-sequence IDs after sort
  allExercises.forEach((ex, i) => { ex.id = i + 1; });

  const finalContent = writeExerciseDb(header, footer, allExercises);
  fs.writeFileSync(DB_PATH, finalContent, 'utf8');

  console.log(`  ✅  exerciseDatabase.js: was ${existingExercises.length}, now ${allExercises.length} (added ${newEntries.length})`);

  // ── Step 7: Upsert exercise_metadata ──────────────────────────────────────
  console.log(`\n💾  Upserting ${metaUpserts.length} rows to exercise_metadata...`);

  // Batch upserts in chunks of 50
  const CHUNK = 50;
  let upsertCount = 0;
  for (let i = 0; i < metaUpserts.length; i += CHUNK) {
    const chunk = metaUpserts.slice(i, i + CHUNK);
    const { error } = await supabase
      .from('exercise_metadata')
      .upsert(chunk, { onConflict: 'exercise_name' });
    if (error) {
      console.error(`  ✗ Supabase upsert error (rows ${i}–${i + chunk.length}): ${error.message}`);
    } else {
      upsertCount += chunk.length;
    }
  }
  console.log(`  ✅  Upserted ${upsertCount} rows`);

  // ── Summary ────────────────────────────────────────────────────────────────
  const muscleCounts = {};
  for (const e of newEntries) {
    muscleCounts[e.muscle] = (muscleCounts[e.muscle] || 0) + 1;
  }

  console.log('\n' + '═'.repeat(60));
  console.log('SUMMARY');
  console.log('═'.repeat(60));
  console.log(`  Videos found to process     : ${toProcess.length}`);
  console.log(`  Successfully uploaded        : ${uploaded.length}`);
  console.log(`  Failed uploads               : ${failures.length}`);
  console.log(`  Added to exerciseDatabase.js : ${newEntries.length}`);
  console.log(`  Upserted to exercise_metadata: ${upsertCount}`);
  console.log(`\n  Muscle group breakdown of new exercises:`);
  for (const [m, c] of Object.entries(muscleCounts).sort()) {
    console.log(`    ${m.padEnd(20)} ${c}`);
  }
  console.log(`\n  Total exercises in app now   : ${allExercises.length}`);
  console.log('═'.repeat(60) + '\n');
}

main().catch(err => { console.error('\n❌  Fatal:', err.message, '\n', err.stack); process.exit(1); });
