const express = require('express');
const multer = require('multer');
const { createClient } = require('@supabase/supabase-js');
const { requireFeatureFlag } = require('../middleware/aiFeatureFlag');
const { aiRateLimit } = require('../middleware/aiRateLimit');
const { parseVoiceDietLog } = require('../ai/features/voiceDiet');
const { parseFoodPhotos } = require('../ai/features/foodVision');
const { parseVoiceWorkoutLog } = require('../ai/features/voiceWorkout');

const router = express.Router();
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

// ── Auth middleware ────────────────────────────────────────────────────────────
async function auth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Missing auth token' });
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data?.user) return res.status(401).json({ error: 'Invalid auth token' });
  req.userId = data.user.id;
  next();
}

// ── Multer — audio upload, memory storage, 5MB cap ───────────────────────────
const audioUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('audio/')) return cb(null, true);
    cb(new Error('Only audio files are accepted'));
  },
});

// ── Multer — image upload, memory storage, 10MB per file ─────────────────────
const imageUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) return cb(null, true);
    cb(new Error('Only image files are accepted'));
  },
});

// ── GET /api/ai/health ────────────────────────────────────────────────────────
router.get('/health', (req, res) => {
  res.json({
    deepseek: process.env.DEEPSEEK_API_KEY ? 'OK' : 'MISSING',
    gemini:   process.env.GEMINI_API_KEY   ? 'OK' : 'MISSING',
    deepgram: process.env.DEEPGRAM_API_KEY ? 'OK' : 'MISSING',
  });
});

// ── POST /api/ai/voice/diet ───────────────────────────────────────────────────
router.post(
  '/voice/diet',
  auth,
  requireFeatureFlag('AI_VOICE_DIET_ENABLED'),
  aiRateLimit,
  audioUpload.single('audio'),
  async (req, res) => {
    console.log('=== VOICE DIET HANDLER REACHED ===');
    console.log('file:', req.file?.size, req.file?.mimetype);
    console.log('user:', req.userId);

    if (!req.file) {
      return res.status(400).json({ error: 'MISSING_AUDIO', message: 'No audio file uploaded.' });
    }
    if (req.file.size < 1024) {
      return res.status(400).json({ error: 'AUDIO_TOO_SHORT', message: 'Audio file is too short.' });
    }

    console.log('[voice-diet] incoming audio:', {
      mimetype: req.file?.mimetype,
      size: req.file?.size,
      originalname: req.file?.originalname,
      bufferLength: req.file?.buffer?.length,
    });

    try {
      const result = await parseVoiceDietLog({
        userId: req.userId,
        audioBuffer: req.file.buffer,
        mimeType: req.file.mimetype,
      });
      return res.json(result);
    } catch (err) {
      if (err.code === 'EMPTY_TRANSCRIPT') {
        return res.status(422).json({ error: err.code, message: err.message });
      }
      console.error('[voice-diet route] FULL ERROR:', err);
      console.error('[voice-diet route] STACK:', err.stack);
      if (err.cause) console.error('[voice-diet route] CAUSE:', err.cause);
      if (err.response) console.error('[voice-diet route] RESPONSE:', err.response?.data ?? err.response);
      return res.status(500).json({
        error: 'AI_PARSE_FAILED',
        message: err.message,
        stack: process.env.NODE_ENV !== 'production' ? err.stack : undefined,
      });
    }
  }
);

// ── POST /api/ai/voice/diet/save ─────────────────────────────────────────────
router.post('/voice/diet/save', auth, async (req, res) => {
  const { meal_type, items, log_date } = req.body;
  if (!meal_type || !Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'INVALID_BODY', message: 'meal_type and items[] are required.' });
  }

  // Use client's local date if provided; otherwise derive IST date (UTC+5:30)
  const today = log_date || (() => {
    const ist = new Date(Date.now() + (5 * 60 + 30) * 60 * 1000);
    return ist.toISOString().split('T')[0];
  })();
  const rows = items.map(item => ({
    user_id:   req.userId,
    log_date:  today,
    meal_type,
    food_name: item.food_name,
    calories:  item.calories,
    protein_g: item.protein_g,
    carbs_g:   item.carbs_g,
    fat_g:     item.fat_g,
    quantity:  item.quantity,
    serving_unit: item.unit,
  }));

  const { data, error } = await supabase.from('food_logs').insert(rows).select('id');
  if (error) {
    console.error('[POST /api/ai/voice/diet/save]', error);
    return res.status(500).json({ error: 'SAVE_FAILED', message: error.message });
  }

  return res.json({ saved_count: data.length, food_log_ids: data.map(r => r.id) });
});

// ── POST /api/ai/voice/workout ────────────────────────────────────────────────
router.post(
  '/voice/workout',
  auth,
  requireFeatureFlag('AI_VOICE_WORKOUT_ENABLED'),
  aiRateLimit,
  audioUpload.single('audio'),
  async (req, res) => {
    if (!req.file) {
      return res.status(400).json({ error: 'MISSING_AUDIO', message: 'No audio file uploaded.' });
    }

    const muscleGroupHint = req.body.muscleGroupHint || null;

    try {
      const result = await parseVoiceWorkoutLog({
        userId: req.userId,
        audioBuffer: req.file.buffer,
        mimeType: req.file.mimetype,
        muscleGroupHint,
      });
      return res.json(result);
    } catch (err) {
      if (err.code === 'EMPTY_TRANSCRIPT') {
        return res.status(422).json({ error: err.code, message: err.message });
      }
      console.error('[POST /api/ai/voice/workout]', err);
      return res.status(500).json({ error: 'AI_PARSE_FAILED', message: 'Failed to parse workout. Please try again.' });
    }
  }
);

// ── POST /api/ai/vision/food ──────────────────────────────────────────────────
router.post(
  '/vision/food',
  auth,
  requireFeatureFlag('AI_FOOD_VISION_ENABLED'),
  aiRateLimit,
  imageUpload.array('images', 3),
  async (req, res) => {
    const files = req.files || [];
    if (files.length < 1 || files.length > 3) {
      return res.status(400).json({ error: 'INVALID_IMAGE_COUNT', message: 'Send 1 to 3 images.' });
    }

    const images = files.map(f => ({ buffer: f.buffer, mimeType: f.mimetype }));

    try {
      const result = await parseFoodPhotos({ userId: req.userId, images });
      return res.json(result);
    } catch (err) {
      if (err.code === 'INVALID_IMAGE_COUNT') {
        return res.status(400).json({ error: err.code, message: err.message });
      }
      console.error('[POST /api/ai/vision/food]', err);
      return res.status(500).json({ error: 'AI_PARSE_FAILED', message: 'Failed to analyse photos. Please try again.' });
    }
  }
);

// ── POST /api/ai/workout/generate-plan ────────────────────────────────────────
router.post('/workout/generate-plan', auth, async (req, res) => {
  try {
    const { goal, experience, trainingDays, preferences } = req.body
    const userId = req.userId

    const { data: profile } = await supabase
      .from('users')
      .select('current_weight, height, age, gender, goal, experience, training_days, priorities')
      .eq('id', userId)
      .maybeSingle()

    const u = profile || {}

    const prompt = `Generate a ${trainingDays}-day workout plan for a ${experience} level person whose goal is ${goal}.

User context: weight ${u.current_weight || '?'}kg, height ${u.height || '?'}cm, age ${u.age || '?'}, priorities: ${(u.priorities || []).join(', ')}.
${preferences ? `Additional preferences: ${preferences}` : ''}

Return ONLY a JSON object with this exact structure — no markdown, no explanation:
{
  "name": "Plan name (short, specific)",
  "description": "One sentence describing the plan",
  "days": [
    {
      "day": 1,
      "name": "Day name e.g. Push — Chest & Shoulders",
      "exercises": [
        {
          "id": "ex_1",
          "name": "Exercise name",
          "muscleGroup": "chest|back|shoulders|biceps|triceps|legs|core|cardio",
          "notes": "Brief form cue",
          "sets": [
            { "set": 1, "reps": "8-10", "kg": "", "rest_seconds": 90 },
            { "set": 2, "reps": "8-10", "kg": "", "rest_seconds": 90 },
            { "set": 3, "reps": "8-10", "kg": "", "rest_seconds": 90 }
          ]
        }
      ]
    }
  ]
}

Rules:
- ${trainingDays} days total, no rest days in the array
- 4-6 exercises per day
- 3-4 sets per exercise
- Reps as a string range e.g. "8-10" or "12-15" or "5"
- kg always empty string (user fills in their own weights)
- rest_seconds: 60 for isolation/hypertrophy, 90-120 for compound strength
- Exercise names must be real, common gym exercises
- Vary muscle groups intelligently across days (push/pull/legs or upper/lower splits)`

    const { callDeepSeek } = require('../ai/clients/deepseek')
    const result = await callDeepSeek({ user: prompt })

    const raw = result.text.trim()
    const clean = raw.replace(/```json|```/g, '').trim()
    const planData = JSON.parse(clean)

    if (!planData.days || !Array.isArray(planData.days)) {
      throw new Error('Invalid plan structure from AI')
    }

    res.json({ plan: planData })
  } catch (err) {
    console.error('[AI workout generate]', err)
    res.status(500).json({ error: err.message || 'Failed to generate plan' })
  }
})

module.exports = router;
