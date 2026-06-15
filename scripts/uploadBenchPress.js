require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const cloudinary = require('cloudinary').v2;
const { createClient } = require('@supabase/supabase-js');

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key:    process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const VIDEO_PATH = '/Users/artazayaz/Downloads/Exercise (whitout watermark)/exercise (whitout watermark)/men/chest/Barbell Bench Press.mp4';
const EXERCISE_NAME = 'Barbell Bench Press';

function formatDuration(seconds) {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

async function main() {
  console.log('Uploading Barbell Bench Press video to Cloudinary...');

  const result = await cloudinary.uploader.upload(VIDEO_PATH, {
    resource_type: 'video',
    folder: 'fitforge/exercises',
    public_id: 'barbell-bench-press',
    overwrite: true,
  });

  const videoDuration = result.duration ? formatDuration(result.duration) : null;
  console.log(`✓ Uploaded: ${result.secure_url}`);
  console.log(`  Duration: ${videoDuration ?? 'unknown'}`);

  const { error } = await supabase
    .from('exercise_metadata')
    .upsert(
      {
        exercise_name: EXERCISE_NAME,
        video_url: result.secure_url,
        video_duration: videoDuration,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'exercise_name' }
    );

  if (error) throw new Error(`Supabase upsert failed: ${error.message}`);
  console.log('✓ Upserted into exercise_metadata');

  const { data, error: fetchErr } = await supabase
    .from('exercise_metadata')
    .select('*')
    .eq('exercise_name', EXERCISE_NAME)
    .single();

  if (fetchErr) throw new Error(`Fetch-back failed: ${fetchErr.message}`);
  console.log('\nRow confirmed in DB:');
  console.log(JSON.stringify(data, null, 2));
}

main().catch(err => { console.error('✗', err.message); process.exit(1); });
