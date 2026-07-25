const express = require('express');
const multer = require('multer');
const { createClient } = require('@supabase/supabase-js');
const { auth } = require('../../middleware/auth');
const { requireFeatureFlag } = require('../middleware/aiFeatureFlag');
const { aiRateLimit } = require('../middleware/aiRateLimit');
const { parseVoiceDietLog } = require('../ai/features/voiceDiet');
const { parseFoodPhotos } = require('../ai/features/foodVision');
const { parseVoiceWorkoutLog } = require('../ai/features/voiceWorkout');
const { generateDietPlan } = require('../ai/features/dietPlanGeneration');
const { resolveFoodItemsWithSupabase } = require('../../utils/foodNutritionResolver');

const router = express.Router();
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

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
  const { meal_type, items, log_date, diet_plan_id, plan_day, plan_item_index } = req.body;
  if (!meal_type || !Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'INVALID_BODY', message: 'meal_type and items[] are required.' });
  }

  // If this save is confirming an AI diet-plan item, verify the plan belongs
  // to the caller before tagging log rows with it.
  if (diet_plan_id) {
    const { data: planRow } = await supabase
      .from('user_diet_plans')
      .select('id')
      .eq('id', diet_plan_id)
      .eq('user_id', req.userId)
      .maybeSingle();
    if (!planRow) {
      return res.status(403).json({ error: 'NOT_AUTHORIZED', message: 'Not your diet plan.' });
    }
  }

  // Use client's local date if provided; otherwise derive IST date (UTC+5:30)
  const today = log_date || (() => {
    const ist = new Date(Date.now() + (5 * 60 + 30) * 60 * 1000);
    return ist.toISOString().split('T')[0];
  })();
  const resolvedItems = await resolveFoodItemsWithSupabase(
    supabase,
    items.map(item => ({ ...item, user_id: req.userId }))
  );
  const rows = resolvedItems.map((resolved) => ({
    user_id:   req.userId,
    log_date:  today,
    meal_type,
    food_name: resolved.food_name,
    calories:  resolved.calories,
    protein_g: resolved.protein_g,
    carbs_g:   resolved.carbs_g,
    fat_g:     resolved.fat_g,
    quantity:  resolved.quantity,
    serving_unit: resolved.serving_unit,
    food_id: resolved.food_id ?? null,
    logged_via: diet_plan_id ? 'plan' : 'voice',
    ...(diet_plan_id ? { diet_plan_id, plan_day, plan_item_index } : {}),
  }));

  const { data, error } = await supabase.from('food_logs').insert(rows).select('id');
  if (error) {
    console.error('[POST /api/ai/voice/diet/save]', error);
    return res.status(500).json({ error: 'SAVE_FAILED', message: error.message });
  }

  return res.json({
    saved_count: data.length,
    food_log_ids: data.map(r => r.id),
    nutrition_resolution: resolvedItems,
  });
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
router.post('/workout/generate-plan', auth, aiRateLimit, async (req, res) => {
  try {
    const { goal, experience, trainingDays, preferences, client_user_id } = req.body
    const userId = req.userId

    let targetUserId = userId

    if (client_user_id) {
      const { data: rel } = await supabase
        .from('trainer_clients')
        .select('id')
        .eq('trainer_id', userId)
        .eq('client_id', client_user_id)
        .eq('status', 'active')
        .maybeSingle()

      if (!rel) {
        return res.status(403).json({ error: 'NOT_AUTHORIZED', message: 'You are not linked to this client.' })
      }

      targetUserId = client_user_id
    }

    const { data: profile } = await supabase
      .from('users')
      .select('current_weight, height, age, gender, goal, experience, training_days, priorities')
      .eq('id', targetUserId)
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

// ── POST /api/ai/diet/generate-plan ───────────────────────────────────────────
router.post('/diet/generate-plan', auth, aiRateLimit, async (req, res) => {
  try {
    const {
      client_user_id,
      goal,
      dietary_preferences,
      days = 7,
      meals_per_day,
      calorie_goal,
      protein_goal,
      carbs_goal,
      fat_goal,
    } = req.body;

    if (!client_user_id) {
      return res.status(400).json({ error: 'client_user_id is required' });
    }

    const { data: rel } = await supabase
      .from('trainer_clients')
      .select('id')
      .eq('trainer_id', req.userId)
      .eq('client_id', client_user_id)
      .eq('status', 'active')
      .maybeSingle();

    if (!rel) {
      return res.status(403).json({ error: 'NOT_AUTHORIZED', message: 'You are not linked to this client.' });
    }

    const { data: client } = await supabase
      .from('users')
      .select('calorie_goal, protein_goal, carbs_goal, fat_goal, goal')
      .eq('id', client_user_id)
      .maybeSingle();

    const c = client || {};
    const mealTypes = Array.isArray(meals_per_day) && meals_per_day.length
      ? meals_per_day
      : ['breakfast', 'lunch', 'dinner', 'snack'];

    const planData = await generateDietPlan({
      trainerId: req.userId,
      goal: goal || c.goal || 'general fitness',
      dietaryPreferences: dietary_preferences,
      days: Number(days) || 7,
      mealTypes,
      calorieGoal: calorie_goal ?? c.calorie_goal,
      proteinGoal: protein_goal ?? c.protein_goal,
      carbsGoal: carbs_goal ?? c.carbs_goal,
      fatGoal: fat_goal ?? c.fat_goal,
    });

    // Deactivate any existing active AI diet plan for this client from this trainer
    await supabase
      .from('client_diet_plans')
      .update({ is_active: false })
      .eq('trainer_id', req.userId)
      .eq('client_user_id', client_user_id)
      .eq('is_active', true);

    const { data: saved, error: saveErr } = await supabase
      .from('client_diet_plans')
      .insert({
        trainer_id: req.userId,
        client_user_id,
        name: planData.name,
        description: planData.description,
        plan_data: planData,
        is_active: true,
      })
      .select()
      .single();
    if (saveErr) throw saveErr;

    res.json({ plan: saved });
  } catch (err) {
    console.error('[AI diet generate-plan]', err);
    res.status(500).json({ error: err.message || 'Failed to generate diet plan' });
  }
});

module.exports = router;
