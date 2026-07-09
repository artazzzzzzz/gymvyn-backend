require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const cloudinary = require('cloudinary').v2;
const { createClient } = require('@supabase/supabase-js');

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const VIDEO_DIR = '/Users/artazayaz/Downloads/Exercise (whitout watermark)/exercise (whitout watermark)/men';
const DB_PATH = path.resolve(__dirname, '../../fitforge-frontend/src/data/exerciseDatabase.js');
const UNMATCHED_OUT = path.resolve(__dirname, 'unmatched_videos.txt');

// ── Helpers ───────────────────────────────────────────────────────────────────

function normalize(str) {
  return str
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function slugify(str) {
  return str
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .trim();
}

function formatDuration(seconds) {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

function scoreMatch(filename, exerciseName) {
  const fn = normalize(filename);
  const en = normalize(exerciseName);
  const fnWords = fn.split(' ');
  const enWords = en.split(' ');

  // Substring check
  if (fn.includes(en) || en.includes(fn)) return 100;

  // Word overlap scoring
  const fnInEn = fnWords.filter(w => w.length > 2 && enWords.includes(w)).length;
  const enInFn = enWords.filter(w => w.length > 2 && fnWords.includes(w)).length;
  return fnInEn + enInFn;
}

// ── Load exercise names from exerciseDatabase.js ──────────────────────────────

function loadExerciseNames() {
  const content = fs.readFileSync(DB_PATH, 'utf8');
  const matches = [...content.matchAll(/"name":\s*"([^"]+)"/g)];
  return matches.map(m => m[1]);
}

// ── Recursively collect all .mp4 files ───────────────────────────────────────

function collectVideos(dir) {
  const results = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...collectVideos(full));
    } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.mp4')) {
      results.push(full);
    }
  }
  return results;
}

// ── Match videos to exercise names ───────────────────────────────────────────

function matchVideos(videoPaths, exerciseNames) {
  return videoPaths.map(vp => {
    const filename = path.basename(vp, '.mp4');
    let bestName = null;
    let bestScore = 0;

    for (const name of exerciseNames) {
      const score = scoreMatch(filename, name);
      if (score > bestScore) {
        bestScore = score;
        bestName = name;
      }
    }

    const matched = bestScore >= 2;
    return { filepath: vp, filename, exerciseName: matched ? bestName : null, score: bestScore };
  });
}

// ── Upload to Cloudinary and upsert to Supabase ───────────────────────────────

async function uploadVideo(filepath, exerciseName) {
  const publicId = `gymvyn/exercises/${slugify(exerciseName)}`;

  const result = await cloudinary.uploader.upload(filepath, {
    resource_type: 'video',
    public_id: publicId,
    overwrite: true,
  });

  const videoDuration = result.duration ? formatDuration(result.duration) : null;

  await supabase
    .from('exercise_metadata')
    .upsert(
      {
        exercise_name: exerciseName,
        video_url: result.secure_url,
        video_duration: videoDuration,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'exercise_name' }
    );

  return { url: result.secure_url, duration: videoDuration };
}

// ── CLI prompt ────────────────────────────────────────────────────────────────

function prompt(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => rl.question(question, ans => { rl.close(); resolve(ans.trim()); }));
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log('\n🎬  FitForge Exercise Video Upload Script\n');

  if (!process.env.CLOUDINARY_CLOUD_NAME) {
    console.error('❌  CLOUDINARY_CLOUD_NAME not set in .env — aborting.');
    process.exit(1);
  }

  const exerciseNames = loadExerciseNames();
  console.log(`📚  Loaded ${exerciseNames.length} exercise names from database`);

  const videoPaths = collectVideos(VIDEO_DIR);
  console.log(`🎥  Found ${videoPaths.length} video files\n`);

  const matches = matchVideos(videoPaths, exerciseNames);
  const matched = matches.filter(m => m.exerciseName !== null);
  const unmatched = matches.filter(m => m.exerciseName === null);

  // Print table
  console.log('─'.repeat(90));
  console.log(
    'FILENAME'.padEnd(50) + 'EXERCISE NAME'.padEnd(30) + 'SCORE'
  );
  console.log('─'.repeat(90));
  for (const m of matches) {
    const fn = m.filename.length > 48 ? m.filename.slice(0, 46) + '..' : m.filename;
    const en = m.exerciseName
      ? (m.exerciseName.length > 28 ? m.exerciseName.slice(0, 26) + '..' : m.exerciseName)
      : 'UNMATCHED';
    const score = m.exerciseName ? String(m.score) : '-';
    console.log(fn.padEnd(50) + en.padEnd(30) + score);
  }
  console.log('─'.repeat(90));
  console.log(`\n✅  ${matched.length} matched  |  ❌  ${unmatched.length} unmatched\n`);

  const answer = await prompt(`Upload ${matched.length} matched videos to Cloudinary? (y/n) `);
  if (answer.toLowerCase() !== 'y') {
    console.log('Aborted.');
    process.exit(0);
  }

  console.log('\nUploading...\n');
  let successCount = 0;
  let failCount = 0;

  for (const m of matched) {
    try {
      const { url, duration } = await uploadVideo(m.filepath, m.exerciseName);
      console.log(`✓ ${m.exerciseName} → uploaded (${duration ?? 'n/a'})`);
      successCount++;
    } catch (err) {
      console.error(`✗ ${m.exerciseName} → FAILED: ${err.message}`);
      failCount++;
    }
  }

  // Write unmatched to file
  if (unmatched.length > 0) {
    fs.writeFileSync(UNMATCHED_OUT, unmatched.map(m => m.filename).join('\n') + '\n');
    console.log(`\n📄  Unmatched filenames written to: ${UNMATCHED_OUT}`);
  }

  console.log(`\n🎉  Done — ${successCount} uploaded, ${failCount} failed.\n`);
}

main().catch(err => { console.error(err); process.exit(1); });
