const express = require('express');
const cors = require('cors');
require('dotenv').config();
const { GoogleGenerativeAI } = require('@google/generative-ai');
const { createClient } = require('@supabase/supabase-js');
const cloudinary = require('cloudinary').v2;
const multer = require('multer');
const { CloudinaryStorage } = require('multer-storage-cloudinary');

const app = express();
const PORT = process.env.PORT || 3000;

const allowedOrigins = [
  process.env.FRONTEND_URL || 'https://fitforge-frontend.vercel.app',
  'http://localhost:5173',
  'http://localhost:5174',
  'http://localhost:3000',
];

app.use(cors({
  origin: (origin, callback) => {
    // allow server-to-server requests (no origin) and listed origins
    if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
    callback(new Error(`CORS: origin ${origin} not allowed`));
  },
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

app.use(express.json());

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

const storage = new CloudinaryStorage({
  cloudinary,
  params: {
    folder: 'fitforge/progress',
    allowed_formats: ['jpg', 'jpeg', 'png', 'webp'],
  },
});

const upload = multer({ storage });

// ── Helpers ───────────────────────────────────────────────────────────────────

// Extract JSON from Claude's response even if it's wrapped in markdown code blocks
function extractJson(text) {
  const match = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  return JSON.parse(match ? match[1].trim() : text.trim());
}

// Normalize Claude's weeklyStructure format → frontend's days format
function normalizePlan(planData) {
  const source = planData.weeklyStructure ?? planData.days ?? [];
  const days = source.map(d => ({
    isRest: d.isRestDay ?? d.isRest ?? false,
    focus: d.focus ?? '',
    exercises: (d.exercises ?? []).map(ex => ({
      name: ex.name,
      sets: ex.sets,
      reps: String(ex.reps),
      rest: ex.restSeconds ? `${ex.restSeconds}s` : (ex.rest ?? ''),
      notes: ex.notes ?? '',
    })),
  }));
  return { days };
}

// ── Routes ────────────────────────────────────────────────────────────────────

app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

app.post('/generate-workout-plan', async (req, res) => {
  try {
    const {
      userId,
      goal,
      experience,
      equipment,
      injuries,
      // accept both naming conventions from the frontend profile spread
      daysPerWeek,
      training_days,
    } = req.body;

    const days = daysPerWeek ?? training_days;

    if (!userId || !goal || !experience || !equipment || !days) {
      return res.status(400).json({
        message: 'Missing required fields: userId, goal, experience, equipment, training_days',
      });
    }

    const prompt = `You are an expert fitness coach. Generate a ${days}-day per week workout plan for a gym goer.

User Profile:
- Goal: ${goal}
- Experience: ${experience}
- Equipment: ${equipment}
- Days per week: ${days}
- Injuries/limitations: ${injuries || 'None'}

Return ONLY a valid JSON object — no markdown, no extra text — in this exact format:
{
  "planName": "string",
  "weeklyStructure": [
    {
      "dayNumber": 1,
      "dayName": "Monday",
      "focus": "Chest & Triceps",
      "isRestDay": false,
      "exercises": [
        {
          "name": "Barbell Bench Press",
          "sets": 4,
          "reps": "8-10",
          "restSeconds": 90,
          "notes": "Focus on full range of motion"
        }
      ]
    }
  ],
  "generalTips": ["tip1", "tip2", "tip3"]
}

Rules:
- weeklyStructure must have exactly 7 entries (one per day of the week)
- Rest days must have isRestDay: true and an empty exercises array
- Non-training days beyond the ${days} days/week must be rest days
- Reps can be a range like "8-10" or a number like "12"
- Match exercises strictly to available equipment: ${equipment}`;

    const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });
    const result = await model.generateContent(prompt);
    const responseText = result.response.text();

    const planData = extractJson(responseText);
    const normalized = normalizePlan(planData);

    // Deactivate any existing active plans for this user
    await supabase
      .from('workout_plans')
      .update({ is_active: false })
      .eq('user_id', userId)
      .eq('is_active', true);

    const { error: insertError } = await supabase
      .from('workout_plans')
      .insert({
        user_id: userId,
        goal,
        days_per_week: days,
        plan_data: planData,
        is_active: true,
      });

    if (insertError) throw insertError;

    res.json(normalized);

  } catch (err) {
    console.error('Generate workout plan error:', err);
    res.status(500).json({ message: err.message || 'Failed to generate workout plan' });
  }
});

app.get('/workout-plan/:userId', async (req, res) => {
  try {
    const { userId } = req.params;

    const { data, error } = await supabase
      .from('workout_plans')
      .select('*')
      .eq('user_id', userId)
      .eq('is_active', true)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    if (error) {
      // PGRST116 = no rows found
      if (error.code === 'PGRST116') return res.status(404).json({ message: 'No active plan' });
      throw error;
    }

    res.json(normalizePlan(data.plan_data));

  } catch (err) {
    console.error('Get workout plan error:', err);
    res.status(500).json({ message: err.message || 'Failed to fetch workout plan' });
  }
});

app.get('/diet-plan/:userId', async (req, res) => {
  try {
    const { userId } = req.params;

    const { data, error } = await supabase
      .from('diet_plans')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    if (error) {
      if (error.code === 'PGRST116') return res.status(404).json({ message: 'No diet plan found' });
      throw error;
    }

    res.json(data.plan_data);

  } catch (err) {
    console.error('Get diet plan error:', err);
    res.status(500).json({ message: err.message || 'Failed to fetch diet plan' });
  }
});

app.post('/generate-diet-plan', async (req, res) => {
  try {
    const { userId, weight, height, age, gender, activityLevel, goal } = req.body;

    if (!userId || !weight || !height || !age || !gender || !activityLevel || !goal) {
      return res.status(400).json({
        message: 'Missing required fields: userId, weight, height, age, gender, activityLevel, goal',
      });
    }

    const bmr = gender === 'male'
      ? 10 * weight + 6.25 * height - 5 * age + 5
      : 10 * weight + 6.25 * height - 5 * age - 161;

    const activityMultipliers = {
      sedentary: 1.2,
      light: 1.375,
      moderate: 1.55,
      active: 1.725,
      very_active: 1.9,
    };

    const goalAdjustments = { lose: -300, maintain: 0, gain: 300 };

    const tdee = Math.round(bmr * (activityMultipliers[activityLevel] ?? 1.2));
    const targetCalories = tdee + (goalAdjustments[goal] ?? 0);

    const prompt = `You are a certified Indian nutritionist. Generate a 7-day Indian meal plan for a person with these stats:
- Weight: ${weight}kg, Height: ${height}cm, Age: ${age}, Gender: ${gender}
- Activity level: ${activityLevel}, Goal: ${goal}
- TDEE: ${tdee} kcal/day, Target calories: ${targetCalories} kcal/day

Return ONLY a valid JSON object — no markdown, no extra text — in this exact format:
{
  "tdee": ${tdee},
  "targetCalories": ${targetCalories},
  "macros": {
    "protein": <grams>,
    "carbs": <grams>,
    "fat": <grams>
  },
  "weekPlan": [
    {
      "day": "Monday",
      "meals": [
        {
          "name": "Breakfast",
          "time": "8:00 AM",
          "foods": [
            { "item": "Oats upma", "quantity": "1 bowl (200g)", "calories": 250 }
          ],
          "totalCalories": 250
        }
      ]
    }
  ]
}

Rules:
- weekPlan must have exactly 7 days
- Each day must have meals: Breakfast, Mid-Morning Snack, Lunch, Evening Snack, Dinner
- Use authentic Indian foods (dal, sabzi, roti, rice, idli, dosa, poha, etc.)
- Calories across all meals in a day should sum close to ${targetCalories}
- Macros: protein ~${Math.round(targetCalories * 0.3 / 4)}g, carbs ~${Math.round(targetCalories * 0.45 / 4)}g, fat ~${Math.round(targetCalories * 0.25 / 9)}g`;

    const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });
    const result = await model.generateContent(prompt);
    const responseText = result.response.text();

    const dietPlan = extractJson(responseText);

    const { error: insertError } = await supabase
      .from('diet_plans')
      .insert({
        user_id: userId,
        plan_data: dietPlan,
        created_at: new Date().toISOString(),
      });

    if (insertError) throw insertError;

    res.json(dietPlan);

  } catch (err) {
    console.error('Generate diet plan error:', err);
    res.status(500).json({ message: err.message || 'Failed to generate diet plan' });
  }
});

app.post('/upload-progress-photo', upload.single('photo'), async (req, res) => {
  try {
    const { userId, date, notes } = req.body;

    if (!userId || !req.file) {
      return res.status(400).json({ message: 'Missing required fields: userId, photo' });
    }

    const photo_url = req.file.path;
    const public_id = req.file.filename;

    const { data, error } = await supabase
      .from('progress_photos')
      .insert({ user_id: userId, photo_url, public_id, date, notes })
      .select('id, photo_url, public_id, date, notes, created_at')
      .single();

    if (error) throw error;

    res.status(201).json(data);
  } catch (err) {
    console.error('Upload progress photo error:', err);
    res.status(500).json({ message: err.message || 'Failed to upload photo' });
  }
});

app.get('/progress-photos/:userId', async (req, res) => {
  try {
    const { userId } = req.params;

    const { data, error } = await supabase
      .from('progress_photos')
      .select('id, photo_url, public_id, date, notes, created_at')
      .eq('user_id', userId)
      .order('date', { ascending: false });

    if (error) throw error;

    res.json(data);
  } catch (err) {
    console.error('Get progress photos error:', err);
    res.status(500).json({ message: err.message || 'Failed to fetch photos' });
  }
});

app.listen(PORT, () => {
  console.log(`FitForge backend running on http://localhost:${PORT}`);
});
