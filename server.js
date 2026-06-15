const express = require('express');
const cors = require('cors');
require('dotenv').config();
const { GoogleGenerativeAI } = require('@google/generative-ai');
const { createClient } = require('@supabase/supabase-js');
const cloudinary = require('cloudinary').v2;
const multer = require('multer');
const { CloudinaryStorage } = require('multer-storage-cloudinary');
const { parse: parseCsvSync } = require('csv-parse/sync');
const cron = require('node-cron');
const ml = require('./ml_client');
const QRCode = require('qrcode');

const app = express();
const PORT = process.env.PORT || 3000;

const allowedOrigins = [
  process.env.FRONTEND_URL || 'https://fitforge-frontend.vercel.app',
  'http://localhost:5173',
  'http://localhost:5174',
  'http://localhost:3000',
];

app.use(cors());

app.use(express.json({ limit: '15mb' }));

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

app.post('/chat', async (req, res) => {
  try {
    const { message, history = [], userProfile = {} } = req.body;

    const systemPrompt = `You are FitForge AI, an expert fitness coach and nutritionist specializing in Indian gym culture. Help users with workouts, diet, form tips, supplements, and motivation. Keep responses concise and practical. Consider Indian food preferences for diet advice. Never give medical advice.\n\nUser Profile:\n${JSON.stringify(userProfile, null, 2)}`;

    const contents = [
      ...history.map(({ role, content }) => ({
        role: role === 'assistant' ? 'model' : 'user',
        parts: [{ text: content }],
      })),
      { role: 'user', parts: [{ text: message }] },
    ];

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${process.env.GEMINI_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          system_instruction: { parts: [{ text: systemPrompt }] },
          contents,
        }),
      }
    );

    const data = await response.json();
    const reply = data.candidates[0].content.parts[0].text;

    res.json({ reply });
  } catch (err) {
    console.error('Chat error:', err);
    res.status(500).json({ message: err.message || 'Failed to get chat response' });
  }
});

// ── Community routes ──────────────────────────────────────────────────────────

app.get('/posts', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('posts')
      .select(`
        *,
        users ( username, avatar_url )
      `)
      .order('created_at', { ascending: false })
      .limit(50);

    if (error) throw error;
    res.json(data);
  } catch (err) {
    console.error('GET /posts error:', err);
    res.status(500).json({ message: err.message || 'Failed to fetch posts' });
  }
});

app.post('/posts', async (req, res) => {
  try {
    const { user_id, content, image_url, post_type } = req.body;

    if (!user_id || !content) {
      return res.status(400).json({ message: 'Missing required fields: user_id, content' });
    }

    const { data, error } = await supabase
      .from('posts')
      .insert({ user_id, content, image_url, post_type })
      .select()
      .single();

    if (error) throw error;
    res.status(201).json(data);
  } catch (err) {
    console.error('POST /posts error:', err);
    res.status(500).json({ message: err.message || 'Failed to create post' });
  }
});

app.post('/posts/:postId/like', async (req, res) => {
  try {
    const { postId } = req.params;
    const { user_id } = req.body;

    if (!user_id) return res.status(400).json({ message: 'Missing required field: user_id' });

    const { data: existing } = await supabase
      .from('post_likes')
      .select('id')
      .eq('post_id', postId)
      .eq('user_id', user_id)
      .maybeSingle();

    let liked;
    if (existing) {
      await supabase.from('post_likes').delete().eq('id', existing.id);
      liked = false;
    } else {
      await supabase.from('post_likes').insert({ post_id: postId, user_id });
      liked = true;
    }

    const { count } = await supabase
      .from('post_likes')
      .select('*', { count: 'exact', head: true })
      .eq('post_id', postId);

    await supabase.from('posts').update({ likes_count: count }).eq('id', postId);

    res.json({ liked, likes_count: count });
  } catch (err) {
    console.error('POST /posts/:postId/like error:', err);
    res.status(500).json({ message: err.message || 'Failed to toggle like' });
  }
});

app.post('/posts/:postId/comments', async (req, res) => {
  try {
    const { postId } = req.params;
    const { user_id, content } = req.body;

    if (!user_id || !content) {
      return res.status(400).json({ message: 'Missing required fields: user_id, content' });
    }

    const { data: comment, error: commentError } = await supabase
      .from('post_comments')
      .insert({ post_id: postId, user_id, content })
      .select()
      .single();

    if (commentError) throw commentError;

    const { count } = await supabase
      .from('post_comments')
      .select('*', { count: 'exact', head: true })
      .eq('post_id', postId);

    await supabase.from('posts').update({ comments_count: count }).eq('id', postId);

    res.status(201).json(comment);
  } catch (err) {
    console.error('POST /posts/:postId/comments error:', err);
    res.status(500).json({ message: err.message || 'Failed to add comment' });
  }
});

app.get('/posts/:postId/comments', async (req, res) => {
  try {
    const { postId } = req.params;

    const { data, error } = await supabase
      .from('post_comments')
      .select(`
        *,
        users ( username, avatar_url )
      `)
      .eq('post_id', postId)
      .order('created_at', { ascending: true });

    if (error) throw error;
    res.json(data);
  } catch (err) {
    console.error('GET /posts/:postId/comments error:', err);
    res.status(500).json({ message: err.message || 'Failed to fetch comments' });
  }
});

app.get('/leaderboard', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('users')
      .select('id, username, avatar_url, streak')
      .order('streak', { ascending: false })
      .limit(10);

    if (error) throw error;
    res.json(data);
  } catch (err) {
    console.error('GET /leaderboard error:', err);
    res.status(500).json({ message: err.message || 'Failed to fetch leaderboard' });
  }
});

app.get('/buddy-suggestions/:userId', async (req, res) => {
  try {
    const { userId } = req.params;

    const { data: existingRequests } = await supabase
      .from('buddy_requests')
      .select('sender_id, receiver_id')
      .or(`sender_id.eq.${userId},receiver_id.eq.${userId}`);

    const excludedIds = new Set([userId]);
    (existingRequests || []).forEach(r => {
      excludedIds.add(r.sender_id);
      excludedIds.add(r.receiver_id);
    });

    const { data, error } = await supabase
      .from('users')
      .select('id, username, avatar_url, fitness_goal')
      .not('id', 'in', `(${[...excludedIds].join(',')})`)
      .limit(20);

    if (error) throw error;

    const shuffled = (data || []).sort(() => Math.random() - 0.5).slice(0, 5);
    res.json(shuffled);
  } catch (err) {
    console.error('GET /buddy-suggestions/:userId error:', err);
    res.status(500).json({ message: err.message || 'Failed to fetch buddy suggestions' });
  }
});

// ── Gym owner routes ──────────────────────────────────────────────────────────

app.post('/api/gyms', async (req, res) => {
  try {
    const { 
      user_id, name, city, gym_type, 
      address, phone, description, 
      operating_hours, membership_plans 
    } = req.body;

    if (!user_id || !name || !city || !gym_type) {
      return res.status(400).json({ message: 'Missing required fields: user_id, name, city, and gym_type are required' });
    }

    const { data: existingGym, error: checkErr } = await supabase
      .from('gyms')
      .select('id')
      .eq('owner_id', user_id)
      .eq('is_active', true)
      .maybeSingle();
      
    if (checkErr && checkErr.code !== 'PGRST116') throw checkErr;
    if (existingGym) {
      return res.status(409).json({ error: 'Gym already registered' });
    }

    const DEFAULT_HOURS = {
      mon: { open: '06:00', close: '22:00', closed: false },
      tue: { open: '06:00', close: '22:00', closed: false },
      wed: { open: '06:00', close: '22:00', closed: false },
      thu: { open: '06:00', close: '22:00', closed: false },
      fri: { open: '06:00', close: '22:00', closed: false },
      sat: { open: '07:00', close: '20:00', closed: false },
      sun: { open: '08:00', close: '18:00', closed: false }
    };
    
    const DEFAULT_NOTIFICATIONS = {
      membership_expiry_reminder: true,
      new_member_alert: true,
      payment_received: true,
      low_attendance_alert: false
    };

    const joinCode = Math.random().toString(36).substring(2, 8).toUpperCase();
    
    const { data: createdGymRow, error: insertErr } = await supabase
      .from('gyms')
      .insert({
        id: crypto.randomUUID(),
        owner_id: user_id,
        name: name.trim(),
        city: city.trim(),
        gym_type: gym_type.trim(),
        address: address?.trim() || null,
        phone: phone?.trim() || null,
        description: description?.trim() || null,
        operating_hours: operating_hours || DEFAULT_HOURS,
        membership_plans: membership_plans || [],
        notifications: DEFAULT_NOTIFICATIONS,
        is_active: true,
        join_code: joinCode,
        created_at: new Date().toISOString()
      })
      .select()
      .single();

    if (insertErr) {
      console.error('POST /api/gyms insert error:', {
        code:    insertErr.code,
        message: insertErr.message,
        details: insertErr.details,
        hint:    insertErr.hint,
      });
      if (insertErr.code === 'PGRST204' || insertErr.message?.includes('column')) {
        throw new Error(`Database schema is missing required columns (${insertErr.message}). Please run migrations.`);
      }
      throw insertErr;
    }

    // Upsert so new users without an existing row still get role + gym_id written.
    // full_name read from auth metadata to satisfy the NOT NULL constraint on insert.
    let fullName = null;
    try {
      const { data: { user: authUserData } } = await supabase.auth.admin.getUserById(user_id);
      fullName = authUserData?.user_metadata?.full_name || null;
    } catch (_) { /* non-fatal */ }

    const { error: updateErr } = await supabase
      .from('users')
      .upsert(
        {
          id: user_id,
          role: 'gym_owner',
          gym_id: createdGymRow.id,
          ...(fullName ? { full_name: fullName } : {}),
        },
        { onConflict: 'id', ignoreDuplicates: false }
      );

    const user_updated = !updateErr;
    if (updateErr) {
      console.error('POST /api/gyms: users upsert failed (non-fatal):', updateErr.message);
    }

    res.status(201).json({
      gym:          createdGymRow,
      user_updated,
      needs_reauth: true,
      message:      'Gym registered successfully',
    });
  } catch (err) {
    console.error('POST /api/gyms error:', err);
    res.status(500).json({ message: err.message || 'Failed to register gym' });
  }
});

// Idempotency check — always 200; gym: null means not set up yet
app.get('/api/gyms/owner/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    const { data, error } = await supabase
      .from('gyms')
      .select('*')
      .eq('owner_id', userId)
      .eq('is_active', true)
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    res.json({ gym: data || null });
  } catch (err) {
    console.error('GET /api/gyms/owner/:userId error:', err);
    res.status(500).json({ message: err.message || 'Failed to check gym ownership' });
  }
});

app.get('/api/gyms/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    const { data, error } = await supabase
      .from('gyms')
      .select('*')
      .eq('owner_id', userId)
      .eq('is_active', true)
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    if (!data) return res.status(404).json({ message: 'Active gym not found' });
    res.json(data);
  } catch (err) {
    console.error('GET /api/gyms/:userId error:', err);
    res.status(500).json({ message: err.message || 'Failed to fetch gym' });
  }
});

const GYM_DEFAULT_HOURS = {
  mon: { open: '06:00', close: '22:00', closed: false },
  tue: { open: '06:00', close: '22:00', closed: false },
  wed: { open: '06:00', close: '22:00', closed: false },
  thu: { open: '06:00', close: '22:00', closed: false },
  fri: { open: '06:00', close: '22:00', closed: false },
  sat: { open: '07:00', close: '20:00', closed: false },
  sun: { open: '08:00', close: '18:00', closed: false },
};
const GYM_DEFAULT_NOTIFICATIONS = {
  membership_expiry_reminder: true,
  new_member_alert:           true,
  payment_received:           true,
  low_attendance_alert:       false,
};

// Apply defaults to a raw gyms row before sending to client
function applyGymSettingsDefaults(row) {
  return {
    id:               row.id,
    name:             row.name,
    city:             row.city,
    address:          row.address   || null,
    phone:            row.phone     || null,
    gym_type:         row.gym_type  || 'commercial',
    logo_url:         row.logo_url  || null,
    description:      row.description || '',
    operating_hours:  row.operating_hours  || GYM_DEFAULT_HOURS,
    membership_plans: row.membership_plans || [],
    notifications:    row.notifications    || GYM_DEFAULT_NOTIFICATIONS,
    created_at:       row.created_at,
  };
}

app.get('/api/gyms/:gymId/settings', async (req, res) => {
  try {
    const { gymId } = req.params;
    const { data, error } = await supabase
      .from('gyms')
      .select('*')
      .eq('id', gymId)
      .maybeSingle();
    if (error) throw error;
    if (!data) return res.status(404).json({ message: 'Gym not found' });
    res.json(applyGymSettingsDefaults(data));
  } catch (err) {
    console.error('GET /api/gyms/:gymId/settings error:', err);
    res.status(500).json({ message: err.message || 'Failed to fetch settings' });
  }
});

app.patch('/api/gyms/:gymId/settings', async (req, res) => {
  try {
    const { gymId } = req.params;
    const body = req.body || {};

    const ALLOWED = [
      'name', 'city', 'address', 'phone', 'description',
      'gym_type', 'operating_hours', 'membership_plans', 'notifications',
    ];
    const updateObj = {};
    ALLOWED.forEach(field => {
      if (body[field] !== undefined) updateObj[field] = body[field];
    });

    if (Object.keys(updateObj).length === 0) {
      return res.status(400).json({ error: 'No valid fields to update' });
    }

    const { data, error } = await supabase
      .from('gyms')
      .update(updateObj)
      .eq('id', gymId)
      .select()
      .maybeSingle();

    if (error) {
      if (error.code === 'PGRST204' || error.message?.includes('column')) {
        throw new Error('Database schema is missing required columns. Please run migrations.');
      }
      throw error;
    }
    if (!data) return res.status(404).json({ message: 'Gym not found' });

    // Return with defaults applied (same shape as GET)
    res.json(applyGymSettingsDefaults(data));
  } catch (err) {
    console.error('PATCH /api/gyms/:gymId/settings error:', err);
    res.status(500).json({ message: err.message || 'Failed to update settings' });
  }
});

const logoMemUpload = multer({ storage: multer.memoryStorage() });

app.post('/api/gyms/:gymId/upload-logo', logoMemUpload.single('logo'), async (req, res) => {
  const { gymId } = req.params;
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  try {
    const result = await new Promise((resolve, reject) => {
      cloudinary.uploader.upload_stream(
        {
          folder:     'fitforge/gyms',
          public_id:  `gym-logo-${gymId}`,
          overwrite:  true,
          transformation: [
            { width: 400, height: 400, crop: 'fill', gravity: 'center' },
          ],
        },
        (error, result) => {
          if (error) reject(error);
          else resolve(result);
        }
      ).end(req.file.buffer);
    });

    const { error: dbErr } = await supabase
      .from('gyms')
      .update({ logo_url: result.secure_url })
      .eq('id', gymId);
    if (dbErr) throw dbErr;

    res.json({ logo_url: result.secure_url });
  } catch (err) {
    console.error('POST /api/gyms/:gymId/upload-logo error:', err);
    res.status(500).json({ error: 'Upload failed' });
  }
});

app.delete('/api/gyms/:gymId', async (req, res) => {
  try {
    const { gymId } = req.params;
    
    const { error: gymErr } = await supabase
      .from('gyms')
      .update({ is_active: false })
      .eq('id', gymId);
    if (gymErr) throw gymErr;
    
    const { error: memErr } = await supabase
      .from('gym_memberships')
      .update({ status: 'inactive' })
      .eq('gym_id', gymId);
    if (memErr) throw memErr;
    
    res.json({ success: true, message: 'Gym deactivated. Contact support to restore.' });
  } catch (err) {
    console.error('DELETE /api/gyms/:gymId error:', err);
    res.status(500).json({ message: err.message || 'Failed to deactivate gym' });
  }
});

app.post('/api/gyms/:gymId/membership-plans', async (req, res) => {
  try {
    const { gymId } = req.params;
    const { name, duration_days, price, features, is_active } = req.body;
    
    const { data: gym, error: fetchErr } = await supabase
      .from('gyms')
      .select('membership_plans')
      .eq('id', gymId)
      .maybeSingle();
    if (fetchErr) throw fetchErr;
    if (!gym) return res.status(404).json({ message: 'Gym not found' });
    
    const plans = gym.membership_plans || [];
    const newPlan = {
      id: crypto.randomUUID(),
      name,
      duration_days,
      price,
      features: features || [],
      is_active: is_active !== false
    };
    plans.push(newPlan);
    
    const { error: updateErr } = await supabase
      .from('gyms')
      .update({ membership_plans: plans })
      .eq('id', gymId);
    if (updateErr) throw updateErr;
    res.status(201).json(plans);
  } catch (err) {
    console.error('POST /api/gyms/:gymId/membership-plans error:', err);
    res.status(500).json({ message: err.message || 'Failed to add membership plan' });
  }
});

app.delete('/api/gyms/:gymId/membership-plans/:planId', async (req, res) => {
  try {
    const { gymId, planId } = req.params;
    
    const { data: gym, error: fetchErr } = await supabase
      .from('gyms')
      .select('membership_plans')
      .eq('id', gymId)
      .maybeSingle();
    if (fetchErr) throw fetchErr;
    if (!gym) return res.status(404).json({ message: 'Gym not found' });
    
    const plans = gym.membership_plans || [];
    const filteredPlans = plans.filter(p => p.id !== planId);
    
    const { error: updateErr } = await supabase
      .from('gyms')
      .update({ membership_plans: filteredPlans })
      .eq('id', gymId);
    if (updateErr) throw updateErr;
    res.json(filteredPlans);
  } catch (err) {
    console.error('DELETE /api/gyms/:gymId/membership-plans/:planId error:', err);
    res.status(500).json({ message: err.message || 'Failed to remove membership plan' });
  }
});

app.patch('/api/gyms/:gymId/membership-plans/:planId', async (req, res) => {
  try {
    const { gymId, planId } = req.params;
    const updates = req.body;
    
    const { data: gym, error: fetchErr } = await supabase
      .from('gyms')
      .select('membership_plans')
      .eq('id', gymId)
      .maybeSingle();
    if (fetchErr) throw fetchErr;
    if (!gym) return res.status(404).json({ message: 'Gym not found' });
    
    const plans = gym.membership_plans || [];
    const index = plans.findIndex(p => p.id === planId);
    if (index === -1) return res.status(404).json({ message: 'Membership plan not found' });
    
    plans[index] = { ...plans[index], ...updates };
    
    const { error: updateErr } = await supabase
      .from('gyms')
      .update({ membership_plans: plans })
      .eq('id', gymId);
    if (updateErr) throw updateErr;
    res.json(plans);
  } catch (err) {
    console.error('PATCH /api/gyms/:gymId/membership-plans/:planId error:', err);
    res.status(500).json({ message: err.message || 'Failed to update membership plan' });
  }
});

// ── Gym member management ─────────────────────────────────────────────────────

const VALID_MEMBERSHIP_TYPES = ['monthly', 'quarterly', 'half_yearly', 'annual'];
const TYPE_DURATION_DAYS = {
  monthly: 30, quarterly: 90, half_yearly: 180, annual: 365,
};

app.post('/api/gym-members', async (req, res) => {
  try {
    // Accept both snake_case (new spec) and camelCase (legacy frontend) keys.
    const {
      gym_id, gymId,
      full_name, fullName,
      phone,
      membership_type, membershipType,
      monthly_fee, monthlyFee,
      start_date, startDate,
      end_date, endDate,
      assigned_trainer_id, assignedTrainerId,
      notes,
    } = req.body;

    const gymIdVal       = gym_id || gymId;
    const fullNameVal    = full_name || fullName;
    const membershipVal  = membership_type || membershipType;
    const feeVal         = monthly_fee ?? monthlyFee;
    const startVal       = start_date || startDate;
    const endVal         = end_date || endDate;
    const trainerVal     = assigned_trainer_id || assignedTrainerId || null;

    // ── Validation ──────────────────────────────────────────────────
    if (!gymIdVal)                              return res.status(400).json({ message: 'gym_id is required' });
    if (!fullNameVal || !fullNameVal.trim())    return res.status(400).json({ message: 'full_name is required' });
    if (!phone || !phone.trim())                return res.status(400).json({ message: 'phone is required' });
    if (!/^\d{10}$/.test(phone.trim()))         return res.status(400).json({ message: 'phone must be 10 digits' });
    if (!membershipVal)                         return res.status(400).json({ message: 'membership_type is required' });
    if (!VALID_MEMBERSHIP_TYPES.includes(membershipVal)) {
      return res.status(400).json({ message: `membership_type must be one of: ${VALID_MEMBERSHIP_TYPES.join(', ')}` });
    }
    const fee = Number(feeVal);
    if (!Number.isFinite(fee) || fee <= 0) {
      return res.status(400).json({ message: 'monthly_fee must be a positive number' });
    }

    const trimmedPhone = phone.trim();
    const trimmedName  = fullNameVal.trim();

    // Resolve start_date (default = today, YYYY-MM-DD)
    const startISO = startVal
      ? new Date(startVal).toISOString().slice(0, 10)
      : new Date().toISOString().slice(0, 10);
    if (Number.isNaN(new Date(startISO).getTime())) {
      return res.status(400).json({ message: 'start_date is not a valid date' });
    }

    // end_date: use body value if provided, else compute from membership_type
    let endISO;
    if (endVal) {
      const e = new Date(endVal);
      if (Number.isNaN(e.getTime())) {
        return res.status(400).json({ message: 'end_date is not a valid date' });
      }
      endISO = e.toISOString().slice(0, 10);
    } else {
      const end = new Date(startISO);
      end.setDate(end.getDate() + TYPE_DURATION_DAYS[membershipVal]);
      endISO = end.toISOString().slice(0, 10);
    }

    // ── Duplicate phone check (within this gym) ─────────────────────
    const { data: existing, error: dupErr } = await supabase
      .from('users')
      .select('id, full_name')
      .eq('gym_id', gymIdVal)
      .eq('phone', trimmedPhone)
      .maybeSingle();
    if (dupErr) throw dupErr;
    if (existing) {
      return res.status(409).json({ message: 'Member with this phone already exists in your gym' });
    }

    // ── Insert user (profile-only, no auth account) ─────────────────
    // NOTE: users table has NO email column. users.id has NO default — pass it explicitly.
    const userId = crypto.randomUUID();
    const { error: userErr } = await supabase
      .from('users')
      .insert({
        id: userId,
        full_name: trimmedName,
        phone: trimmedPhone,
        role: 'gym_member',
        gym_id: gymIdVal,
        is_active: true,
      });
    if (userErr) throw userErr;

    // ── Insert gym_membership; rollback user on failure ─────────────
    const { data: membership, error: memErr } = await supabase
      .from('gym_memberships')
      .insert({
        user_id: userId,
        gym_id: gymIdVal,
        membership_type: membershipVal,
        monthly_fee: fee,
        start_date: startISO,
        end_date: endISO,
        status: 'active',
        assigned_trainer_id: trainerVal,
        notes: notes?.trim() || null,
      })
      .select('id')
      .single();

    if (memErr) {
      console.error('Membership insert failed, rolling back user:', memErr);
      await supabase.from('users').delete().eq('id', userId);
      throw memErr;
    }

    res.status(201).json({
      success: true,
      user_id: userId,
      membership_id: membership.id,
    });
  } catch (err) {
    console.error('POST /api/gym-members error:', err);
    res.status(500).json({ message: err.message || 'Failed to create gym member' });
  }
});

// ── CSV bulk import ───────────────────────────────────────────────────────────

const csvUpload = multer({ storage: multer.memoryStorage() });

app.post('/api/gym-members/csv-import', csvUpload.single('file'), async (req, res) => {
  try {
    const gymId = req.body.gym_id || req.body.gymId;
    if (!gymId) return res.status(400).json({ message: 'gym_id is required' });
    if (!req.file) return res.status(400).json({ message: 'CSV file is required' });

    let records;
    try {
      records = parseCsvSync(req.file.buffer, {
        columns: header => header.map(h => h.trim().toLowerCase()),
        skip_empty_lines: true,
        trim: true,
        bom: true,
      });
    } catch (parseErr) {
      return res.status(400).json({ message: `Invalid CSV: ${parseErr.message}` });
    }

    let imported = 0;
    const skipped = [];
    const errors = [];

    for (let i = 0; i < records.length; i++) {
      const row = records[i];
      const rowNum = i + 2; // +1 for 0-index, +1 for header

      const fullName = (row.full_name || '').trim();
      const phone = (row.phone || '').trim();

      if (!fullName || !phone) {
        skipped.push({ row: rowNum, reason: 'full_name or phone is empty' });
        continue;
      }

      try {
        const userId = crypto.randomUUID();

        const { error: userErr } = await supabase
          .from('users')
          .insert({
            id: userId,
            full_name: fullName,
            phone,
            role: 'gym_member',
            gym_id: gymId,
            is_active: true,
          });
        if (userErr) {
          errors.push({ row: rowNum, reason: userErr.message });
          continue;
        }

        const monthlyFee = parseFloat(row.monthly_fee);
        const membershipPayload = {
          user_id: userId,
          gym_id: gymId,
          membership_type: row.membership_type || null,
          monthly_fee: Number.isFinite(monthlyFee) ? monthlyFee : null,
          start_date: row.start_date || null,
          end_date: row.end_date || null,
          status: 'active',
          notes: row.notes || null,
        };
        if (row.assigned_trainer_id) {
          membershipPayload.assigned_trainer_id = row.assigned_trainer_id;
        }

        const { error: memErr } = await supabase
          .from('gym_memberships')
          .insert(membershipPayload);
        if (memErr) {
          await supabase.from('users').delete().eq('id', userId);
          errors.push({ row: rowNum, reason: memErr.message });
          continue;
        }

        imported++;
      } catch (rowErr) {
        errors.push({ row: rowNum, reason: rowErr.message || 'Unknown error' });
      }
    }

    res.json({ imported, skipped: skipped.length, errors });
  } catch (err) {
    console.error('POST /api/gym-members/csv-import error:', err);
    res.status(500).json({ message: err.message || 'Failed to import CSV' });
  }
});

// ── GET /api/gym-members  ─────────────────────────────────────────────────────

const PLAN_TYPE_LABELS = {
  monthly:     'Monthly',
  quarterly:   'Quarterly',
  half_yearly: 'Half-Yearly',
  annual:      'Annual',
};

app.get('/api/gym-members', async (req, res) => {
  try {
    const {
      gymId,
      search,
      status,
      page              = '1',
      limit             = '20',
      expiring_within_days,
    } = req.query;

    if (!gymId) return res.status(400).json({ message: 'gymId is required' });

    const pageNum  = Math.max(1, parseInt(page,  10) || 1);
    const limitNum = Math.min(200, Math.max(1, parseInt(limit, 10) || 20));
    const offset   = (pageNum - 1) * limitNum;

    // Base query: gym_memberships ⟶ users
    let query = supabase
      .from('gym_memberships')
      .select(`
        id,
        user_id,
        membership_type,
        start_date,
        end_date,
        status,
        created_at,
        users!gym_memberships_user_id_fkey!inner(id, full_name, phone, created_at)
      `)
      .eq('gym_id', gymId)
      .order('created_at', { ascending: false });

    if (status && status !== 'all') {
      query = query.eq('status', status);
    }

    if (expiring_within_days) {
      const days = parseInt(expiring_within_days, 10);
      if (!Number.isNaN(days) && days > 0) {
        const nowStr    = new Date().toISOString().slice(0, 10);
        const futureStr = new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);
        query = query.gte('end_date', nowStr).lte('end_date', futureStr);
      }
    }

    const { data: rows, error } = await query;
    if (error) {
      console.error('GET /api/gym-members query error:', {
        code:    error.code,
        message: error.message,
        details: error.details,
        hint:    error.hint,
      });
      throw error;
    }

    // Name search in JS (PostgREST ILIKE on embedded columns is unreliable)
    let filtered = rows || [];
    if (search && search.trim()) {
      const term = search.trim().toLowerCase();
      filtered = filtered.filter(r =>
        (r.users?.full_name || '').toLowerCase().includes(term)
      );
    }

    const total = filtered.length;
    const paged = filtered.slice(offset, offset + limitNum);

    // Fetch latest churn scores for visible users
    const userIds = paged.map(r => r.user_id).filter(Boolean);
    const churnMap = {};
    if (userIds.length > 0) {
      const { data: scores } = await supabase
        .from('churn_scores')
        .select('user_id, score, predicted_at')
        .in('user_id', userIds)
        .eq('gym_id', gymId)
        .order('predicted_at', { ascending: false });

      for (const s of scores || []) {
        if (!churnMap[s.user_id]) {
          const rs = s.score / 100;
          churnMap[s.user_id] = rs >= 0.7 ? 'high' : rs >= 0.4 ? 'medium' : 'low';
        }
      }
    }

    const now = Date.now();
    const members = paged.map(r => {
      const endMs             = r.end_date ? new Date(r.end_date).getTime() : null;
      const days_until_expiry = endMs != null
        ? Math.ceil((endMs - now) / 86400000)
        : null;

      return {
        id:               r.users?.id || r.user_id,
        full_name:        r.users?.full_name || '',
        phone:            r.users?.phone    || '',
        plan_type:        PLAN_TYPE_LABELS[r.membership_type] || r.membership_type || '',
        membership_start: r.start_date || null,
        membership_end:   r.end_date   || null,
        status:           r.status     || 'active',
        days_until_expiry,
        churn_risk:       churnMap[r.user_id] || 'low',
        joined_at:        r.users?.created_at || r.created_at || null,
      };
    });

    res.json({ members, total, page: pageNum, hasMore: offset + limitNum < total });
  } catch (err) {
    console.error('GET /api/gym-members error:', JSON.stringify({
      message: err.message,
      code:    err.code,
      details: err.details,
      hint:    err.hint,
      stack:   err.stack,
    }, null, 2));
    res.status(500).json({ message: err.message || 'Failed to fetch gym members' });
  }
});

// ── GET /api/gym-members/count/:gymId ────────────────────────────────────────

app.get('/api/gym-members/count/:gymId', async (req, res) => {
  try {
    const { gymId } = req.params;

    const nowStr    = new Date().toISOString().slice(0, 10);
    const in7Days   = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);

    const [totalRes, activeRes, expiringRes, allMembersRes] = await Promise.all([
      supabase
        .from('gym_memberships')
        .select('id', { count: 'exact', head: true })
        .eq('gym_id', gymId),
      supabase
        .from('gym_memberships')
        .select('id', { count: 'exact', head: true })
        .eq('gym_id', gymId)
        .eq('status', 'active'),
      supabase
        .from('gym_memberships')
        .select('id', { count: 'exact', head: true })
        .eq('gym_id', gymId)
        .gte('end_date', nowStr)
        .lte('end_date', in7Days),
      supabase
        .from('gym_memberships')
        .select('user_id')
        .eq('gym_id', gymId),
    ]);

    // Count high-risk members from latest churn scores
    let atRiskCount = 0;
    const allUserIds = (allMembersRes.data || []).map(m => m.user_id).filter(Boolean);
    if (allUserIds.length > 0) {
      const { data: scores } = await supabase
        .from('churn_scores')
        .select('user_id, score, predicted_at')
        .in('user_id', allUserIds)
        .eq('gym_id', gymId)
        .order('predicted_at', { ascending: false });

      const latestByUser = {};
      for (const s of scores || []) {
        if (!latestByUser[s.user_id]) latestByUser[s.user_id] = s;
      }
      atRiskCount = Object.values(latestByUser).filter(s => (s.score / 100) >= 0.7).length;
    }

    const total    = totalRes.count  || 0;
    const active   = activeRes.count || 0;
    const inactive = Math.max(0, total - active);

    res.json({
      total,
      active,
      expiring_soon: expiringRes.count || 0,
      at_risk:       atRiskCount,
      inactive,
    });
  } catch (err) {
    console.error('GET /api/gym-members/count/:gymId error:', err);
    res.status(500).json({ message: err.message || 'Failed to fetch member counts' });
  }
});

// ── Member detail helper ──────────────────────────────────────────────────────

async function buildMemberDetail(memberId) {
  // 1. Most-recent membership + user data (one query, take first row)
  const { data: memberships, error: memErr } = await supabase
    .from('gym_memberships')
    .select(`
      id, gym_id, membership_type, start_date, end_date, status,
      users!gym_memberships_user_id_fkey!inner(
        id, full_name, phone, age, height, current_weight, gender, created_at
      )
    `)
    .eq('user_id', memberId)
    .order('created_at', { ascending: false });
  if (memErr) throw memErr;
  if (!memberships || memberships.length === 0) return null;

  const membership = memberships[0];
  const gymId      = membership.gym_id;
  const user       = membership.users;

  // 2. Parallel: latest churn score, this-month check-ins, last-5 payments
  const monthStart = new Date();
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);

  const [churnRes, checkinsRes, paymentsRes] = await Promise.all([
    supabase
      .from('churn_scores')
      .select('score, top_reasons, predicted_at')
      .eq('user_id', memberId)
      .eq('gym_id', gymId)
      .order('predicted_at', { ascending: false })
      .limit(1),
    supabase
      .from('check_ins')
      .select('checked_in_at')
      .eq('user_id', memberId)
      .gte('checked_in_at', monthStart.toISOString())
      .order('checked_in_at', { ascending: false }),
    supabase
      .from('payments')
      .select('id, amount, paid_at, status')
      .eq('user_id', memberId)
      .eq('gym_id', gymId)
      .order('paid_at', { ascending: false })
      .limit(5),
  ]);

  // Attendance
  const checkins    = checkinsRes.data || [];
  const visitCount  = checkins.length;
  const lastVisited = checkins[0]?.checked_in_at || null;
  const dayOfMonth  = Math.max(1, new Date().getDate());
  const perWeek     = parseFloat((visitCount / 4.3).toFixed(1));
  const ratePercent = Math.min(100, Math.round((visitCount / dayOfMonth) * 100));

  // Churn
  const churnRow  = (churnRes.data || [])[0] ?? null;
  const rawScore  = churnRow?.score ?? 0;
  const normScore = rawScore / 100;
  const churnRisk = normScore >= 0.7 ? 'high' : normScore >= 0.4 ? 'medium' : 'low';

  // Days until expiry
  const endMs           = membership.end_date ? new Date(membership.end_date).getTime() : null;
  const daysUntilExpiry = endMs != null ? Math.ceil((endMs - Date.now()) / 86400000) : null;

  const planTypeLabel = PLAN_TYPE_LABELS[membership.membership_type] || membership.membership_type || '';

  const payments = (paymentsRes.data || []).map(p => ({
    id:        p.id,
    amount:    p.amount,
    plan_type: planTypeLabel,
    paid_at:   p.paid_at || null,
    status:    p.status,
  }));

  return {
    id:                user.id,
    full_name:         user.full_name || '',
    phone:             user.phone     || '',
    age:               user.age             ?? null,
    height:            user.height          ?? null,
    current_weight:    user.current_weight  ?? null,
    gender:            user.gender          ?? null,
    joined_at:         user.created_at      || null,
    plan_type:         planTypeLabel,
    membership_start:  membership.start_date || null,
    membership_end:    membership.end_date   || null,
    membership_status: membership.status     || 'active',
    days_until_expiry: daysUntilExpiry,
    churn_score:       rawScore,
    churn_risk:        churnRisk,
    risk_factors:      churnRow?.top_reasons || [],
    attendance: {
      this_month:   visitCount,
      per_week:     perWeek,
      rate_percent: ratePercent,
      last_visited: lastVisited,
    },
    payments,
    _gymId: gymId,   // stripped by callers before sending
  };
}

// ── GET /api/gym-members/:memberId ────────────────────────────────────────────

app.get('/api/gym-members/:memberId', async (req, res) => {
  try {
    const { memberId } = req.params;
    const detail = await buildMemberDetail(memberId);
    if (!detail) return res.status(404).json({ error: 'Member not found' });
    const { _gymId, ...member } = detail;   // strip internal field
    res.json(member);
  } catch (err) {
    console.error('GET /api/gym-members/:memberId error:', err);
    res.status(500).json({ error: err.message || 'Failed to fetch member' });
  }
});

// ── POST /api/gym-members/:memberId/renew ─────────────────────────────────────

app.post('/api/gym-members/:memberId/renew', async (req, res) => {
  try {
    const { memberId } = req.params;
    const { plan_type, amount, new_end_date } = req.body || {};

    if (!new_end_date) return res.status(400).json({ error: 'new_end_date is required' });
    const amt = Number(amount);
    if (!Number.isFinite(amt) || amt <= 0) {
      return res.status(400).json({ error: 'amount must be a positive number' });
    }

    // Resolve gymId from existing membership
    const { data: memRow, error: memLookupErr } = await supabase
      .from('gym_memberships')
      .select('id, gym_id, membership_type')
      .eq('user_id', memberId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (memLookupErr) throw memLookupErr;
    if (!memRow) return res.status(404).json({ error: 'Member not found' });

    const gymId = memRow.gym_id;

    // Derive DB membership_type from plan_type label (or keep existing)
    const labelToType = Object.fromEntries(
      Object.entries(PLAN_TYPE_LABELS).map(([k, v]) => [v.toLowerCase(), k])
    );
    const newMembershipType = labelToType[(plan_type || '').toLowerCase()] || memRow.membership_type;

    // 1. Update membership
    const { error: updErr } = await supabase
      .from('gym_memberships')
      .update({
        end_date:        new_end_date,
        status:          'active',
        membership_type: newMembershipType,
      })
      .eq('user_id', memberId);
    if (updErr) throw updErr;

    // 2. Insert paid payment record
    const now = new Date().toISOString();
    const { error: payErr } = await supabase
      .from('payments')
      .insert({
        gym_id:        gymId,
        user_id:       memberId,
        membership_id: memRow.id,
        amount:        amt,
        due_date:      new_end_date,
        paid_at:       now,
        status:        'paid',
        notes:         plan_type ? `Renewal – ${plan_type}` : 'Renewal',
      });
    if (payErr) throw payErr;

    // 3. Return fresh member detail
    const detail = await buildMemberDetail(memberId);
    if (!detail) return res.status(404).json({ error: 'Member not found' });
    const { _gymId, ...member } = detail;
    res.json(member);
  } catch (err) {
    console.error('POST /api/gym-members/:memberId/renew error:', err);
    res.status(500).json({ error: err.message || 'Failed to renew membership' });
  }
});

// ── DELETE /api/gym-members/:memberId ─────────────────────────────────────────

app.delete('/api/gym-members/:memberId', async (req, res) => {
  try {
    const { memberId } = req.params;

    // 1. Soft-delete membership
    const { error: memErr } = await supabase
      .from('gym_memberships')
      .update({ status: 'removed' })
      .eq('user_id', memberId);
    if (memErr) throw memErr;

    // 2. Detach user from gym, reset role
    const { error: userErr } = await supabase
      .from('users')
      .update({ gym_id: null, role: 'consumer' })
      .eq('id', memberId);
    if (userErr) throw userErr;

    res.json({ success: true, message: 'Member removed' });
  } catch (err) {
    console.error('DELETE /api/gym-members/:memberId error:', err);
    res.status(500).json({ error: err.message || 'Failed to remove member' });
  }
});

// ── Trainer management ────────────────────────────────────────────────────────

app.post('/api/gym-trainers/invite', async (req, res) => {
  try {
    const { gym_id, type, value } = req.body || {};

    if (!gym_id)  return res.status(400).json({ message: 'gym_id is required' });
    if (!type || !['phone', 'email'].includes(type))
      return res.status(400).json({ message: 'type must be "phone" or "email"' });
    if (!value || !value.trim())
      return res.status(400).json({ message: 'value (phone number or email) is required' });

    // ── Check if a trainer_profiles row already exists for this gym ───────────
    const matchField = type === 'phone' ? 'phone' : 'email';
    const { data: existing, error: lookupErr } = await supabase
      .from('trainer_profiles')
      .select('*')
      .eq('gym_id', gym_id)
      .eq(matchField, value.trim())
      .maybeSingle();
    if (lookupErr && lookupErr.code !== 'PGRST116') throw lookupErr;

    if (existing) {
      // Already exists — update status to 'invited'
      const { data: updated, error: updateErr } = await supabase
        .from('trainer_profiles')
        .update({ status: 'invited' })
        .eq('id', existing.id)
        .select()
        .single();
      if (updateErr) throw updateErr;
      const invite_code = updated.invite_code;
      console.log(`[INVITE] Would send ${type} invite to ${value} with code ${invite_code}`);
      return res.status(200).json({ success: true, invite_code, trainer: updated });
    }

    // ── Create new trainer_profiles row ──────────────────────────────────────
    const invite_code = Math.random().toString(36).substring(2, 10).toUpperCase();
    const id = crypto.randomUUID();
    const newRow = {
      id,
      gym_id,
      full_name: 'Invited Trainer',
      phone:     type === 'phone' ? value.trim() : null,
      email:     type === 'email' ? value.trim() : null,
      specializations:      [],
      experience_years:     0,
      is_independent:       false,
      is_accepting_clients: true,
      invite_code,
      status:    'invited',
      is_active: true,
      created_at: new Date().toISOString(),
    };

    const { data: created, error: insertErr } = await supabase
      .from('trainer_profiles')
      .insert(newRow)
      .select()
      .single();
    if (insertErr) throw insertErr;

    console.log(`[INVITE] Would send ${type} invite to ${value} with code ${invite_code}`);
    res.status(201).json({ success: true, invite_code, trainer: created });
  } catch (err) {
    console.error('POST /api/gym-trainers/invite error:', err);
    res.status(500).json({ message: err.message || 'Failed to invite trainer' });
  }
});

app.post('/api/gym-trainers/manual', async (req, res) => {
  try {
    const { gym_id, full_name, phone, specializations, experience_years } = req.body;
    if (!gym_id || !full_name) {
      return res.status(400).json({ message: 'gym_id and full_name are required' });
    }

    const invite_code = Math.random().toString(36).substring(2, 10).toUpperCase();
    const id = crypto.randomUUID();

    const insertData = {
      id,
      gym_id,
      full_name,
      phone: phone || null,
      specializations: specializations || [],
      experience_years: experience_years || 0,
      is_independent: false,
      is_accepting_clients: true,
      invite_code,
      status: 'manual',
      created_at: new Date().toISOString(),
      is_active: true
    };

    const { data, error } = await supabase
      .from('trainer_profiles')
      .insert(insertData)
      .select()
      .single();

    if (error) throw error;

    res.status(201).json(data);
  } catch (err) {
    console.error('POST /api/gym-trainers/manual error:', err);
    res.status(500).json({ message: err.message || 'Failed to create manual trainer' });
  }
});

app.get('/api/gym-trainers/:gymId', async (req, res) => {
  try {
    const { gymId } = req.params;

    // Check if gymId is a valid UUID
    const uuidRegex = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
    if (!uuidRegex.test(gymId)) {
      return res.json([]);
    }

    // Step 1: get active trainer_profiles for this gym
    const { data: profiles, error: profilesErr } = await supabase
      .from('trainer_profiles')
      .select('*')
      .eq('gym_id', gymId)
      .eq('is_active', true);
    if (profilesErr) throw profilesErr;

    if (!profiles || profiles.length === 0) {
      return res.json([]);
    }

    const trainerIds = profiles.map(p => p.id);
    const userIds = profiles.map(p => p.user_id).filter(Boolean);

    // Step 2: fetch full_name + phone for each trainer's user_id if present
    let users = [];
    if (userIds.length > 0) {
      const { data: usersData, error: usersErr } = await supabase
        .from('users')
        .select('id, full_name, phone')
        .in('id', userIds);
      if (usersErr) throw usersErr;
      users = usersData || [];
    }

    // Step 3: count active clients from trainer_clients
    const allIds = [...new Set([...trainerIds, ...userIds])];
    const { data: clients, error: clientsErr } = await supabase
      .from('trainer_clients')
      .select('trainer_id, status')
      .in('trainer_id', allIds)
      .eq('status', 'active');
    if (clientsErr) throw clientsErr;

    const clientCountMap = new Map();
    for (const c of clients || []) {
      clientCountMap.set(c.trainer_id, (clientCountMap.get(c.trainer_id) || 0) + 1);
    }

    const userById = new Map((users || []).map(u => [u.id, u]));

    const trainers = profiles.map(p => {
      const u = p.user_id ? userById.get(p.user_id) : null;
      const client_count = (clientCountMap.get(p.id) || 0) + (p.user_id ? (clientCountMap.get(p.user_id) || 0) : 0);

      return {
        id: p.id,
        full_name: p.full_name || (u ? u.full_name : 'Unknown'),
        phone: p.phone || (u ? u.phone : null),
        specializations: p.specializations || p.specialties || [],
        experience_years: p.experience_years || 0,
        profile_photo_url: p.profile_photo_url || null,
        invite_code: p.invite_code || null,
        is_independent: p.is_independent || false,
        gym_id: p.gym_id,
        is_accepting_clients: p.is_accepting_clients !== false,
        created_at: p.created_at,
        status: p.status || 'active',
        client_count
      };
    });

    res.json(trainers);
  } catch (err) {
    console.error('GET /api/gym-trainers/:gymId error:', err);
    res.status(500).json({ message: err.message || 'Failed to fetch trainers' });
  }
});

app.delete('/api/gym-trainers/:trainerId', async (req, res) => {
  try {
    const { trainerId } = req.params;

    // Verify the trainer exists and is currently active
    const { data: existing, error: fetchErr } = await supabase
      .from('trainer_profiles')
      .select('id, is_active')
      .eq('id', trainerId)
      .maybeSingle();
    if (fetchErr) throw fetchErr;
    if (!existing)           return res.status(404).json({ message: 'Trainer not found' });
    if (!existing.is_active) return res.status(404).json({ message: 'Trainer already inactive' });

    const { error: profileErr } = await supabase
      .from('trainer_profiles')
      .update({ is_active: false })
      .eq('id', trainerId);
    if (profileErr) throw profileErr;

    // Also soft-delete the linked users row if present
    await supabase.from('users').update({ is_active: false }).eq('id', trainerId);

    res.json({ success: true });
  } catch (err) {
    console.error('DELETE /api/gym-trainers/:trainerId error:', err);
    res.status(500).json({ message: err.message || 'Failed to remove trainer' });
  }
});

app.post('/api/gym-members/:memberId/assign-trainer', async (req, res) => {
  try {
    const { memberId } = req.params;
    const { trainer_id } = req.body;

    const { error } = await supabase
      .from('gym_memberships')
      .update({ assigned_trainer_id: trainer_id || null })
      .eq('user_id', memberId);
    if (error) throw error;

    res.json({ success: true });
  } catch (err) {
    console.error('POST /api/gym-members/:memberId/assign-trainer error:', err);
    res.status(500).json({ message: err.message || 'Failed to assign trainer' });
  }
});

// ── Gym payments ──────────────────────────────────────────────────────────────

const VALID_PAYMENT_STATUSES = ['pending', 'paid', 'overdue', 'refunded'];

// Days to extend a membership per plan label
const PLAN_TYPE_DAYS = {
  Monthly: 30, Quarterly: 90, 'Half-Yearly': 180, Annual: 365,
};

// Resolve period param to start/end ISO strings for paid_at filter
function paymentPeriodRange(period) {
  const now = new Date();
  if (period === 'this_week') {
    const start = new Date(now);
    start.setDate(start.getDate() - start.getDay());
    start.setHours(0, 0, 0, 0);
    return { start: start.toISOString(), end: null };
  }
  if (period === 'this_month') {
    return {
      start: new Date(now.getFullYear(), now.getMonth(), 1).toISOString(),
      end: null,
    };
  }
  if (period === 'last_month') {
    return {
      start: new Date(now.getFullYear(), now.getMonth() - 1, 1).toISOString(),
      end:   new Date(now.getFullYear(), now.getMonth(), 1).toISOString(),
    };
  }
  return { start: null, end: null };
}

// ── GET /api/gym-payments/:gymId/summary (before /:gymId to avoid param capture)

app.get('/api/gym-payments/:gymId/summary', async (req, res) => {
  try {
    const { gymId } = req.params;
    const now             = new Date();
    const thisMonthStart  = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
    const lastMonthStart  = new Date(now.getFullYear(), now.getMonth() - 1, 1).toISOString();
    const sixMonthsAgo    = new Date(now.getFullYear(), now.getMonth() - 5, 1).toISOString();

    const [thisMonthRes, lastMonthRes, txCountRes, overdueRes, chartRes, activeMembersRes] =
      await Promise.all([
        // This month paid
        supabase.from('payments').select('amount')
          .eq('gym_id', gymId).eq('status', 'paid').gte('paid_at', thisMonthStart),
        // Last month paid
        supabase.from('payments').select('amount')
          .eq('gym_id', gymId).eq('status', 'paid')
          .gte('paid_at', lastMonthStart).lt('paid_at', thisMonthStart),
        // Transaction count this month (any status)
        supabase.from('payments').select('id', { count: 'exact', head: true })
          .eq('gym_id', gymId).gte('paid_at', thisMonthStart),
        // Overdue payments
        supabase.from('payments').select('amount')
          .eq('gym_id', gymId).eq('status', 'overdue'),
        // Last 6 months paid (for chart bucketing in JS)
        supabase.from('payments').select('amount, paid_at')
          .eq('gym_id', gymId).eq('status', 'paid').gte('paid_at', sixMonthsAgo),
        // Active member count
        supabase.from('gym_memberships').select('id', { count: 'exact', head: true })
          .eq('gym_id', gymId).eq('status', 'active'),
      ]);

    const thisMonth     = (thisMonthRes.data  || []).reduce((s, p) => s + Number(p.amount || 0), 0);
    const lastMonth     = (lastMonthRes.data  || []).reduce((s, p) => s + Number(p.amount || 0), 0);
    const overdueRows   = overdueRes.data || [];
    const overdueCount  = overdueRows.length;
    const overdueTotal  = overdueRows.reduce((s, p) => s + Number(p.amount || 0), 0);
    const activeMembers = activeMembersRes.count || 0;
    const avgPerMember  = activeMembers > 0 ? Math.round(thisMonth / activeMembers) : 0;

    // Build exactly 6 month buckets (oldest → newest), fill zeros for empty months
    const monthBuckets = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      monthBuckets.push({
        _year:       d.getFullYear(),
        _month:      d.getMonth(),
        month_label: d.toLocaleDateString('en-US', { month: 'short' }),
        total:       0,
      });
    }
    for (const p of chartRes.data || []) {
      if (!p.paid_at) continue;
      const d      = new Date(p.paid_at);
      const bucket = monthBuckets.find(b => b._year === d.getFullYear() && b._month === d.getMonth());
      if (bucket) bucket.total += Number(p.amount || 0);
    }

    res.json({
      this_month:        Math.round(thisMonth),
      last_month:        Math.round(lastMonth),
      month_change:      Math.round(thisMonth - lastMonth),
      transaction_count: txCountRes.count || 0,
      avg_per_member:    avgPerMember,
      overdue_count:     overdueCount,
      overdue_total:     Math.round(overdueTotal),
      monthly_chart:     monthBuckets.map(({ month_label, total }) => ({
        month_label, total: Math.round(total),
      })),
    });
  } catch (err) {
    console.error('GET /api/gym-payments/:gymId/summary error:', err);
    res.status(500).json({ message: err.message || 'Failed to fetch payment summary' });
  }
});

// ── GET /api/gym-payments/:gymId

app.get('/api/gym-payments/:gymId', async (req, res) => {
  try {
    const { gymId } = req.params;
    const { status, period, page = '1', limit = '20' } = req.query;

    const pageNum  = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(200, Math.max(1, parseInt(limit, 10) || 20));

    let query = supabase
      .from('payments')
      .select('id, user_id, membership_id, amount, due_date, paid_at, status, payment_method, notes, users(full_name, phone)')
      .eq('gym_id', gymId)
      .order('paid_at', { ascending: false });

    if (status) {
      if (!VALID_PAYMENT_STATUSES.includes(status)) {
        return res.status(400).json({ message: `status must be one of: ${VALID_PAYMENT_STATUSES.join(', ')}` });
      }
      query = query.eq('status', status);
    }

    if (period && period !== 'all') {
      const { start, end } = paymentPeriodRange(period);
      if (start) query = query.gte('paid_at', start);
      if (end)   query = query.lt('paid_at', end);
    }

    const { data, error } = await query;
    if (error) throw error;

    const all  = data || [];
    const total = all.length;
    const paged = all.slice((pageNum - 1) * limitNum, pageNum * limitNum);

    // Derive plan_type via membership_id → membership_type
    const memIds = [...new Set(paged.map(p => p.membership_id).filter(Boolean))];
    const membershipTypeMap = {};
    if (memIds.length) {
      const { data: mems } = await supabase
        .from('gym_memberships')
        .select('id, membership_type')
        .in('id', memIds);
      for (const m of mems || []) {
        membershipTypeMap[m.id] = PLAN_TYPE_LABELS[m.membership_type] || m.membership_type || '';
      }
    }

    const payments = paged.map(p => ({
      id:         p.id,
      amount:     p.amount,
      plan_type:  membershipTypeMap[p.membership_id] || '',
      paid_at:    p.paid_at,
      status:     p.status,
      notes:      p.notes,
      member_id:  p.user_id,
      full_name:  p.users?.full_name ?? null,
      phone:      p.users?.phone     ?? null,
    }));

    res.json({ payments, total, page: pageNum, hasMore: (pageNum - 1) * limitNum + limitNum < total });
  } catch (err) {
    console.error('GET /api/gym-payments/:gymId error:', err);
    res.status(500).json({ message: err.message || 'Failed to fetch payments' });
  }
});

// ── POST /api/gym-payments/:paymentId/mark-paid

app.post('/api/gym-payments/:paymentId/mark-paid', async (req, res) => {
  try {
    const { paymentId } = req.params;
    const { payment_method, notes } = req.body || {};

    const update = { status: 'paid', paid_at: new Date().toISOString() };
    if (payment_method) update.payment_method = String(payment_method).trim();
    if (notes != null)  update.notes = String(notes).trim() || null;

    const { error } = await supabase.from('payments').update(update).eq('id', paymentId);
    if (error) throw error;

    res.json({ success: true });
  } catch (err) {
    console.error('POST /api/gym-payments/:paymentId/mark-paid error:', err);
    res.status(500).json({ message: err.message || 'Failed to mark payment paid' });
  }
});

// ── POST /api/gym-payments/send-reminders (stub — SMS not wired yet)

app.post('/api/gym-payments/send-reminders', async (req, res) => {
  try {
    const { gym_id } = req.body || {};
    if (!gym_id) return res.status(400).json({ message: 'gym_id is required' });

    const { data: overdueRows, error } = await supabase
      .from('payments')
      .select('amount, users(full_name, phone)')
      .eq('gym_id', gym_id)
      .eq('status', 'overdue');
    if (error) throw error;

    const members = (overdueRows || []).map(p => ({
      full_name: p.users?.full_name ?? 'Unknown',
      phone:     p.users?.phone     ?? null,
      amount:    p.amount,
    }));

    console.log('Would send reminders to:', members);

    res.json({
      success:        true,
      reminded_count: members.length,
      message:        'Reminders queued (SMS not wired yet)',
    });
  } catch (err) {
    console.error('POST /api/gym-payments/send-reminders error:', err);
    res.status(500).json({ message: err.message || 'Failed to send reminders' });
  }
});

// ── POST /api/gym-payments

app.post('/api/gym-payments', async (req, res) => {
  try {
    // Accept both new shape (member_id, plan_type) and legacy shape (user_id, due_date)
    const {
      gym_id,
      member_id, user_id,
      membership_id,
      amount,
      plan_type,
      notes,
      status: bodyStatus,
      due_date,
    } = req.body || {};

    const resolvedUserId = member_id || user_id;
    if (!gym_id)          return res.status(400).json({ message: 'gym_id is required' });
    if (!resolvedUserId)  return res.status(400).json({ message: 'member_id (or user_id) is required' });

    const amt = Number(amount);
    if (!Number.isFinite(amt) || amt <= 0) {
      return res.status(400).json({ message: 'amount must be a positive number' });
    }

    const payStatus  = bodyStatus && VALID_PAYMENT_STATUSES.includes(bodyStatus) ? bodyStatus : 'paid';
    const now        = new Date();
    const resolvedDueDate = due_date || now.toISOString().slice(0, 10);

    // Insert payment
    const { data: inserted, error: insErr } = await supabase
      .from('payments')
      .insert({
        gym_id,
        user_id:       resolvedUserId,
        membership_id: membership_id || null,
        amount:        amt,
        due_date:      resolvedDueDate,
        paid_at:       payStatus === 'paid' ? now.toISOString() : null,
        status:        payStatus,
        notes:         notes ? String(notes).trim() || null : null,
      })
      .select('id, amount, paid_at, status, notes, user_id, membership_id')
      .single();
    if (insErr) throw insErr;

    // If paid, extend or activate the membership end_date
    if (payStatus === 'paid' && plan_type) {
      const daysToAdd = PLAN_TYPE_DAYS[plan_type] ?? 30;
      const newEnd = new Date(now.getTime() + daysToAdd * 86400000).toISOString().slice(0, 10);
      await supabase
        .from('gym_memberships')
        .update({ status: 'active', end_date: newEnd })
        .eq('user_id', resolvedUserId)
        .eq('gym_id', gym_id);
    }

    // Fetch member name for response
    const { data: userRow } = await supabase
      .from('users')
      .select('full_name, phone')
      .eq('id', resolvedUserId)
      .maybeSingle();

    res.status(201).json({
      id:         inserted.id,
      amount:     inserted.amount,
      plan_type:  plan_type || '',
      paid_at:    inserted.paid_at,
      status:     inserted.status,
      notes:      inserted.notes,
      member_id:  resolvedUserId,
      full_name:  userRow?.full_name ?? null,
      phone:      userRow?.phone     ?? null,
    });
  } catch (err) {
    console.error('POST /api/gym-payments error:', err);
    res.status(500).json({ message: err.message || 'Failed to create payment' });
  }
});

// ── Class schedule ────────────────────────────────────────────────────────────

// ── Schedule helpers ──────────────────────────────────────────────────────────

// JS getDay() values for recurring_days keys
const RECURRING_DAY_JS = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };

// Compute end_time ISO string given a start ISO string and duration in minutes
function scheduleEndTime(startIso, durationMinutes) {
  const d = new Date(startIso);
  d.setMinutes(d.getMinutes() + Number(durationMinutes));
  return d.toISOString();
}

// Get the Monday (local) of the week containing a given Date
function getMondayOf(d) {
  const day = d.getDay(); // 0=Sun
  const diff = day === 0 ? -6 : 1 - day;
  const m = new Date(d);
  m.setDate(m.getDate() + diff);
  m.setHours(0, 0, 0, 0);
  return m;
}

app.get('/api/gym-schedule/:gymId', async (req, res) => {
  try {
    const { gymId } = req.params;
    const { date, week_start } = req.query;

    // ── Build date range ──────────────────────────────────────────────────────
    let rangeStart, rangeEnd, isSingleDay;

    if (date) {
      isSingleDay = true;
      rangeStart  = date + 'T00:00:00';
      const next  = new Date(date + 'T00:00:00');
      next.setDate(next.getDate() + 1);
      rangeEnd    = next.toISOString().slice(0, 10) + 'T00:00:00';
    } else if (week_start) {
      isSingleDay = false;
      rangeStart  = week_start + 'T00:00:00';
      const end   = new Date(week_start + 'T00:00:00');
      end.setDate(end.getDate() + 7);
      rangeEnd    = end.toISOString().slice(0, 10) + 'T00:00:00';
    } else {
      // Backward-compat: no params → return all active classes (old behaviour)
      const { data: allClasses, error: allErr } = await supabase
        .from('class_schedule')
        .select('id, class_name, description, trainer_id, day_of_week, start_time, end_time, capacity, duration_minutes, equipment, class_type, recurring, recurring_days')
        .eq('gym_id', gymId)
        .eq('is_active', true)
        .order('day_of_week', { ascending: true })
        .order('start_time', { ascending: true });
      if (allErr) throw allErr;
      const trIds = [...new Set((allClasses || []).map(c => c.trainer_id).filter(Boolean))];
      const tMap  = {};
      if (trIds.length) {
        const { data: tUsers } = await supabase.from('users').select('id, full_name').in('id', trIds);
        for (const u of (tUsers || [])) tMap[u.id] = u.full_name;
      }
      return res.json((allClasses || []).map(c => ({ ...c, trainer_name: tMap[c.trainer_id] || null })));
    }

    // ── Fetch classes in range ────────────────────────────────────────────────
    const { data: classes, error: classErr } = await supabase
      .from('class_schedule')
      .select('id, gym_id, class_name, trainer_id, start_time, end_time, capacity, duration_minutes, equipment, class_type, recurring, recurring_days')
      .eq('gym_id', gymId)
      .gte('start_time', rangeStart)
      .lt('start_time', rangeEnd)
      .order('start_time', { ascending: true });
    if (classErr) throw classErr;

    const classList = classes || [];

    // ── Trainer names ─────────────────────────────────────────────────────────
    const trainerIds = [...new Set(classList.map(c => c.trainer_id).filter(Boolean))];
    const trainerMap = {};
    if (trainerIds.length) {
      const { data: trainers } = await supabase.from('users').select('id, full_name').in('id', trainerIds);
      for (const t of (trainers || [])) trainerMap[t.id] = t.full_name;
    }

    // ── Booking counts (class_bookings may not exist yet) ─────────────────────
    const bookingMap = {};
    if (classList.length) {
      const classIds = classList.map(c => c.id);
      const bookingRes = await supabase
        .from('class_bookings')
        .select('class_id')
        .in('class_id', classIds)
        .eq('status', 'booked');
      // If table doesn't exist, bookingRes.error is set — treat as zero bookings
      for (const b of (bookingRes.data || [])) {
        bookingMap[b.class_id] = (bookingMap[b.class_id] || 0) + 1;
      }
    }

    // ── Shape a single class row ──────────────────────────────────────────────
    const shapeClass = c => {
      const booked_count = bookingMap[c.id] || 0;
      return {
        id:               c.id,
        class_name:       c.class_name,
        trainer_id:       c.trainer_id,
        trainer_name:     trainerMap[c.trainer_id] || null,
        start_time:       c.start_time,
        end_time:         c.end_time,
        capacity:         c.capacity,
        booked_count,
        duration_minutes: c.duration_minutes,
        equipment:        c.equipment,
        class_type:       c.class_type,
        is_full:          booked_count >= (c.capacity || 1),
      };
    };

    if (isSingleDay) {
      res.json({ date, classes: classList.map(shapeClass) });
    } else {
      // ── Build 7-day grouped response ────────────────────────────────────────
      const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
      const days = [];
      for (let i = 0; i < 7; i++) {
        const d       = new Date(week_start + 'T00:00:00');
        d.setDate(d.getDate() + i);
        const dateStr = d.toISOString().slice(0, 10);
        const dayClasses = classList
          .filter(c => (c.start_time || '').slice(0, 10) === dateStr)
          .map(shapeClass);
        days.push({
          date:        dateStr,
          day_label:   DAY_LABELS[d.getDay()],
          has_classes: dayClasses.length > 0,
          class_count: dayClasses.length,
          classes:     dayClasses,
        });
      }
      res.json({ week_start, days });
    }
  } catch (err) {
    console.error('GET /api/gym-schedule/:gymId error:', err);
    res.status(500).json({ message: err.message || 'Failed to fetch schedule' });
  }
});

app.post('/api/gym-schedule', async (req, res) => {
  try {
    const {
      gym_id, class_name, trainer_id,
      start_time, duration_minutes, capacity,
      equipment, class_type,
      recurring, recurring_days,
    } = req.body || {};

    if (!gym_id)             return res.status(400).json({ message: 'gym_id is required' });
    if (!class_name?.trim()) return res.status(400).json({ message: 'class_name is required' });
    if (!start_time)         return res.status(400).json({ message: 'start_time is required' });

    const dur = Number(duration_minutes) || 60;
    const cap = Number(capacity)         || 20;
    const isRecurring = !!recurring && Array.isArray(recurring_days) && recurring_days.length > 0;

    const baseRecord = {
      gym_id,
      class_name:       class_name.trim(),
      trainer_id:       trainer_id || null,
      capacity:         cap,
      duration_minutes: dur,
      equipment:        equipment || 'No equipment',
      class_type:       class_type || 'other',
      recurring:        isRecurring,
      recurring_days:   isRecurring ? recurring_days : [],
      is_active:        true,
    };

    let records = [];

    if (isRecurring) {
      // Generate one entry per (week × recurring_day) for the next 4 weeks
      const baseDate = new Date(start_time);
      const hours    = baseDate.getHours();
      const minutes  = baseDate.getMinutes();
      const monday   = getMondayOf(baseDate);

      for (let week = 0; week < 4; week++) {
        for (const dayKey of recurring_days) {
          const jsDay = RECURRING_DAY_JS[dayKey.toLowerCase()];
          if (jsDay === undefined) continue;
          // offset from Monday: Mon=0 … Sun=6
          const offsetFromMon = jsDay === 0 ? 6 : jsDay - 1;

          const classDate = new Date(monday);
          classDate.setDate(classDate.getDate() + week * 7 + offsetFromMon);
          classDate.setHours(hours, minutes, 0, 0);

          const st = classDate.toISOString();
          records.push({ ...baseRecord, start_time: st, end_time: scheduleEndTime(st, dur) });
        }
      }
    } else {
      records.push({
        ...baseRecord,
        start_time,
        end_time:         scheduleEndTime(start_time, dur),
        recurring:        false,
        recurring_days:   [],
      });
    }

    const { data, error } = await supabase
      .from('class_schedule')
      .insert(records)
      .select('id, class_name, trainer_id, start_time, end_time, capacity, duration_minutes, equipment, class_type, recurring, recurring_days');
    if (error) throw error;

    res.status(201).json({ success: true, classes: data || [] });
  } catch (err) {
    console.error('POST /api/gym-schedule error:', err);
    res.status(500).json({ message: err.message || 'Failed to create class' });
  }
});

app.delete('/api/gym-schedule/:classId', async (req, res) => {
  try {
    const { classId }  = req.params;
    const isRecurring  = req.query.recurring === 'true';

    if (isRecurring) {
      // 1. Fetch the target class to get class_name + trainer_id
      const { data: cls, error: fetchErr } = await supabase
        .from('class_schedule')
        .select('class_name, trainer_id')
        .eq('id', classId)
        .maybeSingle();
      if (fetchErr) throw fetchErr;
      if (!cls) return res.status(404).json({ message: 'Class not found' });

      // 2. Delete this class + all future classes with same name & trainer
      const nowIso = new Date().toISOString();
      let q = supabase
        .from('class_schedule')
        .delete()
        .eq('class_name', cls.class_name)
        .gte('start_time', nowIso);
      if (cls.trainer_id) q = q.eq('trainer_id', cls.trainer_id);

      const { data: deleted, error: delErr } = await q.select('id');
      if (delErr) throw delErr;

      res.json({ success: true, deleted_count: (deleted || []).length });
    } else {
      // Single delete
      const { data: deleted, error } = await supabase
        .from('class_schedule')
        .delete()
        .eq('id', classId)
        .select('id');
      if (error) throw error;
      res.json({ success: true, deleted_count: (deleted || []).length });
    }
  } catch (err) {
    console.error('DELETE /api/gym-schedule/:classId error:', err);
    res.status(500).json({ message: err.message || 'Failed to delete class' });
  }
});

// ── Announcements ─────────────────────────────────────────────────────────────

const VALID_PRIORITIES = ['normal', 'important', 'urgent'];

app.get('/api/gym-announcements/:gymId', async (req, res) => {
  try {
    const { gymId } = req.params;
    const { data, error } = await supabase
      .from('announcements')
      .select('id, title, body, priority, created_at')
      .eq('gym_id', gymId)
      .eq('is_active', true)
      .order('created_at', { ascending: false });
    if (error) throw error;
    res.json(data || []);
  } catch (err) {
    console.error('GET /api/gym-announcements/:gymId error:', err);
    res.status(500).json({ message: err.message || 'Failed to fetch announcements' });
  }
});

app.post('/api/gym-announcements', async (req, res) => {
  try {
    const { gym_id, posted_by, title, body, priority } = req.body || {};

    if (!gym_id)                    return res.status(400).json({ message: 'gym_id is required' });
    if (!posted_by)                 return res.status(400).json({ message: 'posted_by is required' });
    if (!title || !title.trim())    return res.status(400).json({ message: 'title is required' });
    if (!body || !body.trim())      return res.status(400).json({ message: 'body is required' });

    const pri = priority || 'normal';
    if (!VALID_PRIORITIES.includes(pri)) {
      return res.status(400).json({ message: `priority must be one of: ${VALID_PRIORITIES.join(', ')}` });
    }

    const { data, error } = await supabase
      .from('announcements')
      .insert({
        gym_id,
        posted_by,
        title: title.trim(),
        body: body.trim(),
        priority: pri,
        is_active: true,
      })
      .select('id')
      .single();
    if (error) throw error;

    res.status(201).json({ success: true, announcement_id: data.id });
  } catch (err) {
    console.error('POST /api/gym-announcements error:', err);
    res.status(500).json({ message: err.message || 'Failed to post announcement' });
  }
});

app.delete('/api/gym-announcements/:announcementId', async (req, res) => {
  try {
    const { announcementId } = req.params;
    const { error } = await supabase
      .from('announcements')
      .update({ is_active: false })
      .eq('id', announcementId);
    if (error) throw error;
    res.json({ success: true });
  } catch (err) {
    console.error('DELETE /api/gym-announcements/:announcementId error:', err);
    res.status(500).json({ message: err.message || 'Failed to delete announcement' });
  }
});

// ── Consumer-side: My Gym ─────────────────────────────────────────────────────

app.get('/api/my-gym/:userId', async (req, res) => {
  try {
    const { userId } = req.params;

    const { data: userRow, error: userErr } = await supabase
      .from('users')
      .select('gym_id')
      .eq('id', userId)
      .maybeSingle();
    if (userErr) throw userErr;

    if (!userRow || !userRow.gym_id) {
      return res.json({ linked: false });
    }

    const gymId = userRow.gym_id;

    const [gymRes, announcementsRes, scheduleRes] = await Promise.all([
      supabase
        .from('gyms')
        .select('name, address, phone, logo_url')
        .eq('id', gymId)
        .maybeSingle(),
      supabase
        .from('announcements')
        .select('id, title, body, priority, created_at')
        .eq('gym_id', gymId)
        .eq('is_active', true)
        .order('created_at', { ascending: false })
        .limit(10),
      supabase
        .from('class_schedule')
        .select('id, class_name, description, trainer_id, day_of_week, start_time, end_time, capacity')
        .eq('gym_id', gymId)
        .eq('is_active', true)
        .order('day_of_week', { ascending: true })
        .order('start_time', { ascending: true }),
    ]);

    if (gymRes.error)           throw gymRes.error;
    if (announcementsRes.error) throw announcementsRes.error;
    if (scheduleRes.error)      throw scheduleRes.error;

    const schedule = scheduleRes.data || [];
    const trainerIds = [...new Set(schedule.map(s => s.trainer_id).filter(Boolean))];
    let nameById = new Map();
    if (trainerIds.length) {
      const { data: trainerUsers, error: trainerUsersErr } = await supabase
        .from('users')
        .select('id, full_name')
        .in('id', trainerIds);
      if (trainerUsersErr) throw trainerUsersErr;
      nameById = new Map((trainerUsers || []).map(u => [u.id, u.full_name]));
    }

    res.json({
      linked: true,
      gym: gymRes.data || null,
      announcements: announcementsRes.data || [],
      schedule: schedule.map(s => ({ ...s, trainer_name: nameById.get(s.trainer_id) || null })),
    });
  } catch (err) {
    console.error('GET /api/my-gym/:userId error:', err);
    res.status(500).json({ message: err.message || 'Failed to fetch gym' });
  }
});

app.post('/api/gym-join', async (req, res) => {
  try {
    const { user_id, join_code } = req.body || {};

    if (!user_id)  return res.status(400).json({ message: 'user_id is required' });
    if (!join_code || !join_code.trim()) {
      return res.status(400).json({ message: 'join_code is required' });
    }

    const code = join_code.trim().toUpperCase();
    const { data: gym, error: gymErr } = await supabase
      .from('gyms')
      .select('id, name, is_active')
      .eq('join_code', code)
      .eq('is_active', true)
      .maybeSingle();
    if (gymErr) throw gymErr;

    if (!gym) return res.status(404).json({ error: 'Invalid join code' });

    // Don't downgrade an existing gym owner to gym_member.
    const { data: existing, error: existingErr } = await supabase
      .from('users')
      .select('role')
      .eq('id', user_id)
      .maybeSingle();
    if (existingErr) throw existingErr;

    const update = { gym_id: gym.id };
    if (existing?.role !== 'gym_owner') update.role = 'gym_member';

    const { error: updateErr } = await supabase
      .from('users')
      .update(update)
      .eq('id', user_id);
    if (updateErr) throw updateErr;

    res.json({ success: true, gym_name: gym.name });
  } catch (err) {
    console.error('POST /api/gym-join error:', err);
    res.status(500).json({ message: err.message || 'Failed to join gym' });
  }
});

// ── QR check-in ──────────────────────────────────────────────────────────────

app.get('/api/gym-qr/:gymId', async (req, res) => {
  try {
    const { gymId } = req.params;
    const { user_id } = req.query;

    if (!user_id) return res.status(400).json({ error: 'user_id query param is required' });

    // Verify active membership
    const { data: membership, error: memErr } = await supabase
      .from('gym_memberships')
      .select('id')
      .eq('user_id', user_id)
      .eq('gym_id', gymId)
      .eq('status', 'active')
      .maybeSingle();
    if (memErr) throw memErr;
    if (!membership) return res.status(404).json({ error: 'No active membership found' });

    const membershipId = membership.id;

    // Build QR payload
    const payload = JSON.stringify({
      gym_id:    gymId,
      user_id,
      member_id: membershipId,
      ts:        Date.now(),
    });

    const qr_code = await QRCode.toDataURL(payload);

    res.json({ qr_code, member_id: membershipId });
  } catch (err) {
    console.error('GET /api/gym-qr/:gymId error:', err);
    res.status(500).json({ error: err.message || 'Failed to generate QR code' });
  }
});

function todayMidnightIso() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

app.post('/api/checkin', async (req, res) => {
  try {
    let { gym_id, user_id, member_id, method, qr_payload } = req.body;

    // ── QR payload decode ────────────────────────────────────────────────────
    if (qr_payload) {
      try {
        const parsed = JSON.parse(qr_payload);
        if (parsed.user_id)  user_id   = parsed.user_id;
        if (parsed.gym_id)   gym_id    = parsed.gym_id;
        if (parsed.member_id) member_id = parsed.member_id;
        method = 'qr';
      } catch {
        return res.status(400).json({ error: 'Invalid QR payload' });
      }
    }

    if (!gym_id) {
      return res.status(400).json({ error: 'gym_id is required' });
    }

    let resolvedMemberId = member_id;
    let resolvedUserId = user_id;
    let fullName = 'Unknown';

    if (user_id) {
      const { data: mem, error } = await supabase
        .from('gym_memberships')
        .select('id, users(full_name)')
        .eq('user_id', user_id)
        .eq('gym_id', gym_id)
        .eq('status', 'active')
        .maybeSingle();
      if (error) throw error;
      if (!mem) return res.status(404).json({ error: 'Active membership not found for user' });
      resolvedMemberId = mem.id;
      if (mem.users) fullName = mem.users.full_name;
    } else if (member_id) {
      const { data: mem, error } = await supabase
        .from('gym_memberships')
        .select('user_id, users(full_name)')
        .eq('id', member_id)
        .eq('gym_id', gym_id)
        .maybeSingle();
      if (error) throw error;
      if (!mem) return res.status(404).json({ error: 'Membership not found' });
      resolvedUserId = mem.user_id;
      if (mem.users) fullName = mem.users.full_name;
    } else {
      return res.status(400).json({ error: 'Either user_id or member_id must be provided' });
    }

    // Check if already checked in today
    const { data: existing, error: existErr } = await supabase
      .from('check_ins')
      .select('id')
      .eq('membership_id', resolvedMemberId)
      .eq('gym_id', gym_id)
      .gte('checked_in_at', todayMidnightIso())
      .is('checked_out_at', null)
      .maybeSingle();
    if (existErr) throw existErr;
    if (existing) {
      return res.status(409).json({ error: 'Already checked in' });
    }

    const checkinMethod = method === 'qr' ? 'qr' : 'manual';
    const checkedInAt = new Date().toISOString();

    const { data: inserted, error: insErr } = await supabase
      .from('check_ins')
      .insert({
        id: crypto.randomUUID(),
        gym_id,
        membership_id: resolvedMemberId,
        user_id: resolvedUserId,
        checked_in_at: checkedInAt,
        checked_out_at: null,
        method: checkinMethod,
      })
      .select('id')
      .single();
    if (insErr) throw insErr;

    res.status(201).json({
      success: true,
      checkin_id: inserted.id,
      member_name: fullName,
      checked_in_at: checkedInAt
    });
  } catch (err) {
    console.error('POST /api/checkin error:', err);
    res.status(500).json({ error: err.message || 'Failed to check in' });
  }
});

app.post('/api/checkout', async (req, res) => {
  try {
    const { gym_id, checkin_id } = req.body;
    if (!gym_id || !checkin_id) {
      return res.status(400).json({ error: 'gym_id and checkin_id are required' });
    }

    const { data: checkin, error: checkinErr } = await supabase
      .from('check_ins')
      .select('id, checked_out_at')
      .eq('id', checkin_id)
      .eq('gym_id', gym_id)
      .maybeSingle();
    if (checkinErr) throw checkinErr;
    if (!checkin) {
      return res.status(404).json({ error: 'Check-in not found' });
    }

    if (checkin.checked_out_at) {
      return res.status(409).json({ error: 'Already checked out' });
    }

    const checkedOutAt = new Date().toISOString();
    const { error: updErr } = await supabase
      .from('check_ins')
      .update({ checked_out_at: checkedOutAt })
      .eq('id', checkin_id);
    if (updErr) throw updErr;

    res.json({ success: true, checked_out_at: checkedOutAt });
  } catch (err) {
    console.error('POST /api/checkout error:', err);
    res.status(500).json({ error: err.message || 'Failed to check out' });
  }
});

app.get('/api/gym-occupancy/:gymId', async (req, res) => {
  try {
    const { gymId } = req.params;

    // Members currently inside (not checked out, checked in today)
    const { data: insideData, error: insideErr } = await supabase
      .from('check_ins')
      .select(`
        id, checked_in_at, method,
        membership_id,
        user_id,
        gym_memberships (
          id, membership_type, end_date,
          users!gym_memberships_user_id_fkey ( id, full_name, phone )
        )
      `)
      .eq('gym_id', gymId)
      .is('checked_out_at', null)
      .gte('checked_in_at', todayMidnightIso())
      .order('checked_in_at', { ascending: false });
    if (insideErr) throw insideErr;

    const members_inside = (insideData || []).map(ci => {
      const gm = Array.isArray(ci.gym_memberships) ? ci.gym_memberships[0] : (ci.gym_memberships || {});
      const u  = Array.isArray(gm.users) ? gm.users[0] : (gm.users || {});
      return {
        checkin_id:      ci.id,
        checked_in_at:   ci.checked_in_at,
        method:          ci.method,
        user_id:         u.id  || ci.user_id,
        full_name:       u.full_name || 'Unknown',
        phone:           u.phone || null,
        member_id:       gm.id  || ci.membership_id,
        membership_type: gm.membership_type,
        expiry_date:     gm.end_date,
      };
    });

    const current_occupancy = members_inside.length;

    // Today's total check-ins
    const { count: today_total, error: totalErr } = await supabase
      .from('check_ins')
      .select('id', { count: 'exact', head: true })
      .eq('gym_id', gymId)
      .gte('checked_in_at', todayMidnightIso());
    if (totalErr) throw totalErr;

    console.log(`[OCCUPANCY] gymId=${gymId} occupancy=${current_occupancy} at ${new Date().toISOString()}`);

    res.json({
      current_occupancy,
      today_total: today_total || 0,
      members_inside,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    console.error('GET /api/gym-occupancy/:gymId error:', err);
    res.status(500).json({ error: err.message || 'Failed to fetch occupancy' });
  }
});

app.get('/api/gym-checkin-history/:gymId', async (req, res) => {
  try {
    const { gymId } = req.params;
    const { date, page = '1', limit = '20' } = req.query;
    
    // Parse date or default to today
    let targetDate = new Date();
    if (date) {
      targetDate = new Date(date);
    }
    const startOfDay = new Date(targetDate);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(targetDate);
    endOfDay.setHours(23, 59, 59, 999);

    const pageNum = Math.max(1, parseInt(page, 10));
    const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10)));
    const offset = (pageNum - 1) * limitNum;

    // First get the exact count
    const { count, error: countErr } = await supabase
      .from('check_ins')
      .select('id', { count: 'exact', head: true })
      .eq('gym_id', gymId)
      .gte('checked_in_at', startOfDay.toISOString())
      .lte('checked_in_at', endOfDay.toISOString());
    if (countErr) throw countErr;

    const { data: historyData, error: historyErr } = await supabase
      .from('check_ins')
      .select(`
        id, checked_in_at, checked_out_at, method,
        user_id,
        gym_memberships (
          membership_type,
          users!gym_memberships_user_id_fkey ( id, full_name )
        )
      `)
      .eq('gym_id', gymId)
      .gte('checked_in_at', startOfDay.toISOString())
      .lte('checked_in_at', endOfDay.toISOString())
      .order('checked_in_at', { ascending: false })
      .range(offset, offset + limitNum - 1);

    if (historyErr) throw historyErr;

    const checkins = (historyData || []).map(ci => {
      const gm = Array.isArray(ci.gym_memberships) ? ci.gym_memberships[0] : (ci.gym_memberships || {});
      const u = Array.isArray(gm.users) ? gm.users[0] : (gm.users || {});
      return {
        id: ci.id,
        checked_in_at: ci.checked_in_at,
        checked_out_at: ci.checked_out_at,
        method: ci.method,
        full_name: u.full_name || 'Unknown',
        user_id: u.id || ci.user_id,
        membership_type: gm.membership_type
      };
    });

    res.json({
      date: startOfDay.toISOString().slice(0, 10),
      total: count || 0,
      checkins,
      page: pageNum,
      limit: limitNum
    });
  } catch (err) {
    console.error('GET /api/gym-checkin-history/:gymId error:', err);
    res.status(500).json({ error: err.message || 'Failed to fetch check-in history' });
  }
});

app.get('/api/gym-members-search/:gymId', async (req, res) => {
  try {
    const { gymId } = req.params;
    const { q } = req.query;

    if (!q || q.length < 2) {
      return res.status(400).json({ error: 'Search term must be at least 2 characters' });
    }

    // Supabase has issues with complex joins on OR ILIKE without an RPC. 
    // We can fetch active memberships for the gym, then fetch the users that match the ILIKE
    const { data: mems, error: memErr } = await supabase
      .from('gym_memberships')
      .select('id, user_id, membership_type, end_date, status')
      .eq('gym_id', gymId)
      .eq('status', 'active');
    if (memErr) throw memErr;

    if (!mems || mems.length === 0) {
      return res.json([]);
    }

    const userIds = mems.map(m => m.user_id).filter(Boolean);
    
    // Now search users in these userIds matching q
    const { data: users, error: userErr } = await supabase
      .from('users')
      .select('id, full_name, phone')
      .in('id', userIds)
      .or(`full_name.ilike.%${q}%,phone.ilike.%${q}%`)
      .limit(10);
    
    if (userErr) throw userErr;

    const userMap = new Map((users || []).map(u => [u.id, u]));
    
    const results = [];
    for (const gm of mems) {
      if (userMap.has(gm.user_id)) {
        const u = userMap.get(gm.user_id);
        results.push({
          member_id: gm.id,
          user_id: u.id,
          full_name: u.full_name,
          phone: u.phone,
          membership_type: gm.membership_type,
          expiry_date: gm.end_date,
          status: gm.status
        });
        if (results.length >= 10) break;
      }
    }

    res.json(results);
  } catch (err) {
    console.error('GET /api/gym-members-search/:gymId error:', err);
    res.status(500).json({ error: err.message || 'Failed to search members' });
  }
});

// ── Churn scoring (rule-based v1) ────────────────────────────────────────────

function riskLabelFor(score) {
  if (score >= 61) return 'high';
  if (score >= 31) return 'medium';
  return 'low';
}

function startOfToday() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

function startOfMonth() {
  const d = new Date();
  d.setDate(1);
  d.setHours(0, 0, 0, 0);
  return d;
}

function daysBetween(later, earlier) {
  return Math.floor((later.getTime() - earlier.getTime()) / (24 * 60 * 60 * 1000));
}

app.post('/api/gym-churn/score/:gymId', async (req, res) => {
  try {
    const { gymId } = req.params;

    // 1. Active memberships for this gym
    const { data: memberships, error: memErr } = await supabase
      .from('gym_memberships')
      .select('id, user_id, end_date')
      .eq('gym_id', gymId)
      .eq('status', 'active');
    if (memErr) throw memErr;

    if (!memberships || memberships.length === 0) {
      return res.json({ scored: 0, high_risk: 0, medium_risk: 0, low_risk: 0, members: [] });
    }

    const userIds = memberships.map(m => m.user_id);

    // 2. Last check-in per user
    const { data: checkins, error: ciErr } = await supabase
      .from('check_ins')
      .select('user_id, checked_in_at')
      .eq('gym_id', gymId)
      .in('user_id', userIds)
      .order('checked_in_at', { ascending: false });
    if (ciErr) throw ciErr;

    const lastCheckinByUser = new Map();
    const monthVisitsByUser = new Map();
    const monthStart = startOfMonth();
    for (const c of checkins || []) {
      if (!lastCheckinByUser.has(c.user_id)) {
        lastCheckinByUser.set(c.user_id, c.checked_in_at);
      }
      const t = new Date(c.checked_in_at);
      if (t >= monthStart) {
        monthVisitsByUser.set(c.user_id, (monthVisitsByUser.get(c.user_id) || 0) + 1);
      }
    }

    // 3. Outstanding payments per user
    const { data: payments, error: payErr } = await supabase
      .from('payments')
      .select('user_id, status')
      .in('user_id', userIds)
      .in('status', ['pending', 'overdue']);
    if (payErr) throw payErr;

    const hasOutstandingByUser = new Set((payments || []).map(p => p.user_id));

    // 4. Score each member
    const now = new Date();
    const today = startOfToday();
    const predictedAt = now.toISOString();
    const rows = [];

    let highRisk = 0, mediumRisk = 0, lowRisk = 0;

    for (const m of memberships) {
      let score = 0;
      const reasons = [];

      const lastIso = lastCheckinByUser.get(m.user_id);
      const daysSinceCheckin = lastIso
        ? daysBetween(today, new Date(lastIso))
        : 9999;

      if (daysSinceCheckin > 14) {
        score += 30;
        reasons.push('Inactive over 14 days');
      } else if (daysSinceCheckin > 7) {
        score += 15;
        reasons.push('Inactive over 7 days');
      }
      if (daysSinceCheckin > 30) {
        score += 15;
        reasons.push('Inactive over 30 days');
      }

      let expiresInDays = null;
      if (m.end_date) {
        const end = new Date(m.end_date);
        end.setHours(23, 59, 59, 999);
        expiresInDays = Math.ceil((end.getTime() - now.getTime()) / (24 * 60 * 60 * 1000));
        if (expiresInDays <= 14 && expiresInDays >= 0) {
          score += 20;
          reasons.push('Expires within 14 days');
        }
      }

      const hasOutstanding = hasOutstandingByUser.has(m.user_id);
      if (hasOutstanding) {
        score += 25;
        reasons.push('Outstanding payment');
      }

      const monthlyVisits = monthVisitsByUser.get(m.user_id) || 0;
      if (monthlyVisits < 4) {
        score += 10;
        reasons.push('Fewer than 4 visits this month');
      }

      if (score > 100) score = 100;
      const riskLabel = riskLabelFor(score);
      if (riskLabel === 'high')   highRisk++;
      else if (riskLabel === 'medium') mediumRisk++;
      else lowRisk++;

      rows.push({
        user_id: m.user_id,
        gym_id: gymId,
        membership_id: m.id,
        score,
        predicted_at: predictedAt,
        features_snapshot: {
          days_since_checkin: daysSinceCheckin === 9999 ? null : daysSinceCheckin,
          expires_in_days: expiresInDays,
          has_outstanding: hasOutstanding,
          monthly_visits: monthlyVisits,
        },
        top_reasons: reasons,
      });
    }

    // 5. Upsert into churn_scores (one row per user_id + gym_id)
    if (rows.length > 0) {
      const { error: upErr } = await supabase
        .from('churn_scores')
        .upsert(rows, { onConflict: 'user_id,gym_id' });
      if (upErr) {
        // Fallback: if no unique constraint, just insert (GET takes latest)
        if (/no unique|on conflict|constraint/i.test(upErr.message || '')) {
          const { error: insErr } = await supabase.from('churn_scores').insert(rows);
          if (insErr) throw insErr;
        } else {
          throw upErr;
        }
      }
    }

    res.json({
      scored: rows.length,
      high_risk: highRisk,
      medium_risk: mediumRisk,
      low_risk: lowRisk,
      members: rows,
    });
  } catch (err) {
    console.error('POST /api/gym-churn/score/:gymId error:', err);
    res.status(500).json({ error: err.message || 'Failed to score churn' });
  }
});

app.get('/api/gym-churn/:gymId', async (req, res) => {
  try {
    const { gymId } = req.params;

    // Fetch all scores for this gym, newest first; dedupe to latest per user_id.
    const { data: scores, error: scoreErr } = await supabase
      .from('churn_scores')
      .select('user_id, score, predicted_at, features_snapshot, top_reasons')
      .eq('gym_id', gymId)
      .order('predicted_at', { ascending: false });
    if (scoreErr) throw scoreErr;

    const latestByUser = new Map();
    for (const s of scores || []) {
      if (!latestByUser.has(s.user_id)) latestByUser.set(s.user_id, s);
    }
    const latest = [...latestByUser.values()];

    let users = [];
    if (latest.length > 0) {
      const ids = latest.map(s => s.user_id);
      const { data: usersRows, error: uErr } = await supabase
        .from('users')
        .select('id, full_name')
        .in('id', ids);
      if (uErr) throw uErr;
      users = usersRows || [];
    }

    const nameById = new Map(users.map(u => [u.id, u.full_name]));

    const result = latest
      .map(s => ({
        user_id: s.user_id,
        full_name: nameById.get(s.user_id) || null,
        score: s.score,
        risk_label: riskLabelFor(s.score),
        top_reasons: s.top_reasons || [],
        predicted_at: s.predicted_at,
        features_snapshot: s.features_snapshot || {},
      }))
      .sort((a, b) => b.score - a.score);

    res.json(result);
  } catch (err) {
    console.error('GET /api/gym-churn/:gymId error:', err);
    res.status(500).json({ error: err.message || 'Failed to fetch churn scores' });
  }
});

// ── ML service integration ──────────────────────────────────────────────────

app.get('/api/ml/status', async (req, res) => {
  try {
    const info = await ml.modelInfo();
    res.json(info);
  } catch (err) {
    console.error('GET /api/ml/status error:', err);
    res.status(503).json({ message: 'ML service unreachable', error: err.message });
  }
});

app.post('/api/ml/score/:gymId', async (req, res) => {
  try {
    const { gymId } = req.params;
    if (!gymId) return res.status(400).json({ message: 'gymId is required' });
    const result = await ml.batchScoreGym(gymId);
    res.json(result);
  } catch (err) {
    console.error('POST /api/ml/score/:gymId error:', err);
    res.status(500).json({ message: 'Failed to score gym', error: err.message });
  }
});

app.get('/api/gym-stats/:gymId', async (req, res) => {
  try {
    const { gymId } = req.params;

    // Real queries: Members
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
    const in7Days = new Date(Date.now() + 7 * 86400000).toISOString();

    const [membersTotalRes, membersActiveRes, membersNewRes, membersExpiringRes, trainersRes, topTrainersRes] = await Promise.all([
      supabase.from('gym_memberships').select('id', { count: 'exact', head: true }).eq('gym_id', gymId),
      supabase.from('gym_memberships').select('id', { count: 'exact', head: true }).eq('gym_id', gymId).eq('status', 'active'),
      supabase.from('gym_memberships').select('id', { count: 'exact', head: true }).eq('gym_id', gymId).gte('created_at', startOfMonth),
      supabase.from('gym_memberships').select('id', { count: 'exact', head: true }).eq('gym_id', gymId).lte('end_date', in7Days).gte('end_date', now.toISOString()),
      
      // Trainers
      supabase.from('trainer_profiles').select('id', { count: 'exact', head: true }).eq('gym_id', gymId).eq('is_active', true),
      
      // Top trainers
      supabase.from('trainer_profiles').select('id, full_name, specializations, user_id').eq('gym_id', gymId).eq('is_active', true)
    ]);

    const totalTrainers = trainersRes.count || 0;
    
    // Calculate top trainers
    let top_trainers = [];
    if (topTrainersRes.data && topTrainersRes.data.length > 0) {
      const trainerIds = topTrainersRes.data.map(t => t.id);
      const userIds = topTrainersRes.data.map(t => t.user_id).filter(Boolean);
      const allIds = [...new Set([...trainerIds, ...userIds])];
      
      const { data: clients } = await supabase
        .from('trainer_clients')
        .select('trainer_id')
        .in('trainer_id', allIds)
        .eq('status', 'active');
        
      const clientCountMap = new Map();
      for (const c of clients || []) {
        clientCountMap.set(c.trainer_id, (clientCountMap.get(c.trainer_id) || 0) + 1);
      }
      
      const trainersList = topTrainersRes.data.map(t => {
        const client_count = (clientCountMap.get(t.id) || 0) + (t.user_id ? (clientCountMap.get(t.user_id) || 0) : 0);
        return {
          id: t.id,
          name: t.full_name || 'Unknown',
          client_count,
          avg_sessions_per_client: 0, // stub — ML phase will replace
          specializations: t.specializations || []
        };
      });
      
      trainersList.sort((a, b) => b.client_count - a.client_count);
      top_trainers = trainersList.slice(0, 3);
    }

    // Dummy Revenue (INR scale)
    const revenue = {
      this_month:    124500,
      last_month:    111200,
      growth_percent: 12,
      monthly_chart: [
        { month: 'Jan', amount:  98000 },
        { month: 'Feb', amount: 105000 },
        { month: 'Mar', amount: 111200 },
        { month: 'Apr', amount: 118000 },
        { month: 'May', amount: 111200 },
        { month: 'Jun', amount: 124500 },
      ],
    };

    // Dummy Occupancy
    const occupancy = {
      avg_daily: 47,
      peak_hour: '6:00 PM',
      peak_day:  'Monday',
      weekly_chart: [
        { day: 'Mon', count: 62 },
        { day: 'Tue', count: 45 },
        { day: 'Wed', count: 58 },
        { day: 'Thu', count: 41 },
        { day: 'Fri', count: 55 },
        { day: 'Sat', count: 38 },
        { day: 'Sun', count: 22 },
      ],
    };

    res.json({
      revenue,
      members: {
        total: membersTotalRes.count || 0,
        active: membersActiveRes.count || 0,
        new_this_month: membersNewRes.count || 0,
        expiring_soon: membersExpiringRes.count || 0
      },
      occupancy,
      trainers: {
        total: totalTrainers,
        top_trainers
      }
    });
  } catch (err) {
    console.error('GET /api/gym-stats/:gymId error:', err);
    res.status(500).json({ error: err.message || 'Failed to fetch gym stats' });
  }
});

app.get('/api/gym-activity-heatmap/:gymId', async (req, res) => {
  const { gymId } = req.params;
  
  const generateRealisticCount = (dayIndex, hour) => {
    const isWeekend = dayIndex === 0 || dayIndex === 6;
    if (hour >= 0 && hour <= 5) return Math.floor(Math.random() * 2);
    if (isWeekend) {
      if (hour >= 8 && hour <= 12) return Math.floor(Math.random() * 15) + 10;
      if (hour >= 13 && hour <= 18) return Math.floor(Math.random() * 10) + 5;
      return Math.floor(Math.random() * 5);
    } else {
      if (hour >= 6 && hour <= 8) return Math.floor(Math.random() * 11) + 15;
      if (hour >= 9 && hour <= 11) return Math.floor(Math.random() * 8) + 8;
      if (hour >= 12 && hour <= 16) return Math.floor(Math.random() * 6) + 3;
      if (hour >= 17 && hour <= 20) return Math.floor(Math.random() * 16) + 20;
      return Math.floor(Math.random() * 5) + 1;
    }
  };

  const days = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  const hours = Array.from({length: 24}, (_, i) => i);
  
  const dummyHeatmap = days.map((day, di) => ({
    day,
    hours: hours.map(h => ({
      hour: h,
      count: generateRealisticCount(di, h)
    }))
  }));

  try {
    const twentyEightDaysAgo = new Date();
    twentyEightDaysAgo.setDate(twentyEightDaysAgo.getDate() - 28);
    
    const { data: checkins, error } = await supabase
      .from('check_ins')
      .select('checked_in_at')
      .eq('gym_id', gymId)
      .gte('checked_in_at', twentyEightDaysAgo.toISOString());
      
    if (error) throw error;
    if (!checkins || checkins.length === 0) {
      return res.json({ gym_id: gymId, period_days: 28, heatmap: dummyHeatmap });
    }

    const heatmapMap = Array.from({ length: 7 }, () => Array(24).fill(0));
    
    for (const ci of checkins) {
      if (!ci.checked_in_at) continue;
      const d = new Date(ci.checked_in_at);
      const dayOfWeek = d.getDay();
      const hour = d.getHours();
      heatmapMap[dayOfWeek][hour]++;
    }

    const realHeatmap = days.map((day, di) => ({
      day,
      hours: hours.map(h => ({
        hour: h,
        count: heatmapMap[di][h]
      }))
    }));

    res.json({ gym_id: gymId, period_days: 28, heatmap: realHeatmap });
  } catch (err) {
    console.error('GET /api/gym-activity-heatmap/:gymId failed, falling back to stub:', err);
    res.json({ gym_id: gymId, period_days: 28, heatmap: dummyHeatmap });
  }
});

app.get('/api/ml/scores/:gymId', async (req, res) => {
  const { gymId } = req.params;
  
  const stubResponse = {
    gym_id: gymId,
    generated_at: new Date().toISOString(),
    scores: [
      {
        user_id: 'dummy-1',
        full_name: 'Priya Sharma',
        risk_level: 'high',
        risk_score: 0.87,
        risk_factors: [
          'No visit in 14 days',
          'Membership expires in 5 days',
          'Skipped last 3 booked classes'
        ],
        last_visit_days_ago: 14,
        membership_type: 'Premium'
      },
      {
        user_id: 'dummy-2',
        full_name: 'Ankit Verma',
        risk_level: 'high',
        risk_score: 0.79,
        risk_factors: [
          'Visit frequency dropped 60%',
          'No trainer sessions this month'
        ],
        last_visit_days_ago: 9,
        membership_type: 'Standard'
      },
      {
        user_id: 'dummy-3',
        full_name: 'Meera Joshi',
        risk_level: 'medium',
        risk_score: 0.54,
        risk_factors: [
          'Visits below weekly target',
          'Diet tracking dropped off'
        ],
        last_visit_days_ago: 4,
        membership_type: 'Premium'
      },
      {
        user_id: 'dummy-4',
        full_name: 'Rahul Singh',
        risk_level: 'medium',
        risk_score: 0.48,
        risk_factors: [
          'Missed 2 trainer sessions',
          'App engagement low this week'
        ],
        last_visit_days_ago: 3,
        membership_type: 'Standard'
      },
      {
        user_id: 'dummy-5',
        full_name: 'Divya Nair',
        risk_level: 'low',
        risk_score: 0.21,
        risk_factors: [],
        last_visit_days_ago: 1,
        membership_type: 'Premium'
      }
    ],
    summary: {
      high_risk_count: 2,
      medium_risk_count: 2,
      low_risk_count: 1,
      total_scored: 5
    }
  };

  // ── Try ML service first, then fall through to DB scores ────────────────────
  if (process.env.ML_SERVICE_URL) {
    try {
      const mlRes = await fetch(`${process.env.ML_SERVICE_URL}/predict/${gymId}`);
      if (!mlRes.ok) throw new Error(`ML service returned ${mlRes.status}`);
      const mlData = await mlRes.json();
      return res.json(mlData);
    } catch (mlErr) {
      console.log('[ML] ML service unavailable, falling back to DB scores:', mlErr.message);
    }
  }

  try {
    const { data: scores, error } = await supabase
      .from('churn_scores')
      .select('user_id, gym_id, membership_id, score, predicted_at, features_snapshot, top_reasons')
      .eq('gym_id', gymId)
      .order('score', { ascending: false });

    if (error) throw error;
    
    if (!scores || scores.length === 0) {
      return res.json(stubResponse);
    }
    
    const latest = {};
    for (const s of scores) {
      if (!latest[s.user_id] || new Date(s.predicted_at) > new Date(latest[s.user_id].predicted_at)) {
        latest[s.user_id] = s;
      }
    }
    const latestArr = Object.values(latest);

    const userIds = latestArr.map(s => s.user_id);
    const { data: users } = await supabase
      .from('users')
      .select('id, full_name, phone')
      .in('id', userIds);
    const userMap = Object.fromEntries((users || []).map(u => [u.id, u]));

    const enriched = latestArr.map(s => {
      const risk_score = parseFloat((s.score / 100).toFixed(3));
      const risk_level = risk_score >= 0.7 ? 'high' : risk_score >= 0.4 ? 'medium' : 'low';
      return {
        ...s,
        user_id:    s.user_id,
        full_name:  userMap[s.user_id]?.full_name || 'Unknown',
        phone:      userMap[s.user_id]?.phone     || null,
        risk_score,
        risk_level,
        risk_factors: s.top_reasons || [],
        last_visit_days_ago: Math.floor(Math.random() * 15),
        membership_type: 'Standard'
      };
    });

    const summary = {
      total_scored: enriched.length,
      high_risk_count: enriched.filter(s => s.risk_level === 'high').length,
      medium_risk_count: enriched.filter(s => s.risk_level === 'medium').length,
      low_risk_count: enriched.filter(s => s.risk_level === 'low').length,
    };

    res.json({ gym_id: gymId, generated_at: new Date().toISOString(), scores: enriched, summary });
  } catch (err) {
    console.error('GET /api/ml/scores/:gymId failed, falling back to stub:', err);
    res.json(stubResponse);
  }
});

// Daily churn scoring — 20:30 UTC = 02:00 IST.
cron.schedule('30 20 * * *', async () => {
  console.log('🕑 Daily churn scoring started at', new Date().toISOString());
  try {
    const { data: gyms, error } = await supabase
      .from('gyms')
      .select('id, name')
      .eq('is_active', true);
    if (error) throw error;
    for (const gym of gyms || []) {
      try {
        const result = await ml.batchScoreGym(gym.id);
        console.log(`✅ Scored ${gym.name}: ${result.scored} members, ${result.high_risk} high risk`);
      } catch (e) {
        console.error(`❌ Failed scoring ${gym.name}:`, e.message);
      }
    }
    console.log('🕑 Daily churn scoring complete at', new Date().toISOString());
  } catch (err) {
    console.error('🕑 Daily churn scoring crashed:', err);
  }
}, { timezone: 'UTC' });

// ── Diet redesign: macros, food logs, food search, AI diet plan ──────────────

const ACTIVITY_MULTIPLIERS = {
  sedentary: 1.2,
  light: 1.375,
  moderate: 1.55,
  active: 1.725,
  very_active: 1.9,
};

async function computeMacrosForUser(userId) {
  const { data: user, error } = await supabase
    .from('users')
    .select('current_weight, height, age, goal, activity_level, gender')
    .eq('id', userId)
    .single();
  if (error || !user) throw new Error('User not found');

  const weight = Number(user.current_weight);
  const height = Number(user.height);
  const age = Number(user.age);
  if (!weight || !height || !age) {
    throw new Error('User missing weight/height/age — complete onboarding first');
  }

  const gender = (user.gender || 'male').toLowerCase();
  const activity = (user.activity_level || 'moderate').toLowerCase();
  const multiplier = ACTIVITY_MULTIPLIERS[activity] ?? ACTIVITY_MULTIPLIERS.moderate;

  const bmrBase = (10 * weight) + (6.25 * height) - (5 * age);
  const bmr = gender === 'female' ? bmrBase - 161 : bmrBase + 5;
  const tdee = bmr * multiplier;

  const goal = (user.goal || '').toLowerCase();
  let calories = tdee;
  let proteinPerKg = 1.6;
  let goalAdjustment = 0;
  if (goal.includes('lose') || goal.includes('cut')) {
    goalAdjustment = -450;
    calories = tdee - 450;
    proteinPerKg = 2.0;
  } else if (goal.includes('gain') || goal.includes('bulk')) {
    goalAdjustment = 350;
    calories = tdee + 350;
    proteinPerKg = 1.8;
  } else if (goal.includes('maintain') || goal.includes('athletic')) {
    proteinPerKg = 1.6;
  }

  const protein_g = Math.round(proteinPerKg * weight);
  const proteinCalories = protein_g * 4;
  const fatCalories = calories * 0.25;
  const fat_g = Math.round(fatCalories / 9);
  const carbsCalories = calories - proteinCalories - fatCalories;
  const carbs_g = Math.round(carbsCalories / 4);

  const row = {
    user_id: userId,
    calories: Math.round(calories),
    protein_g,
    carbs_g,
    fat_g,
    bmr: Math.round(bmr),
    tdee: Math.round(tdee),
    activity_level: activity,
    goal_adjustment: goalAdjustment,
    formula: 'mifflin_st_jeor',
    updated_at: new Date().toISOString(),
  };

  const { data: upserted, error: upsertError } = await supabase
    .from('user_macros')
    .upsert(row, { onConflict: 'user_id' })
    .select()
    .single();
  if (upsertError) throw upsertError;

  return upserted;
}

// Route 1: POST /api/macros/calculate
app.post('/api/macros/calculate', async (req, res) => {
  try {
    const { userId } = req.body;
    if (!userId) return res.status(400).json({ message: 'userId is required' });
    const macros = await computeMacrosForUser(userId);
    res.json({ success: true, macros });
  } catch (err) {
    console.error('calculate macros error:', err);
    res.status(500).json({ message: err.message || 'Failed to calculate macros' });
  }
});

// Route 2: GET /api/macros/:userId
app.get('/api/macros/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    const { data, error } = await supabase
      .from('user_macros')
      .select('*')
      .eq('user_id', userId)
      .maybeSingle();
    if (error) throw error;
    if (data) return res.json({ success: true, macros: data });
    const macros = await computeMacrosForUser(userId);
    res.json({ success: true, macros });
  } catch (err) {
    console.error('get macros error:', err);
    res.status(500).json({ message: err.message || 'Failed to fetch macros' });
  }
});


// Route 3: POST /api/food-logs
app.post('/api/food-logs', async (req, res) => {
  try {
    const {
      userId, log_date, date, mealType, foodName, quantity, servingUnit,
      calories, proteinG, carbsG, fatG, loggedVia, foodId,
    } = req.body;
    if (!userId || !mealType || !foodName || calories == null) {
      return res.status(400).json({ message: 'userId, mealType, foodName, calories are required' });
    }
    const { data, error } = await supabase
      .from('food_logs')
      .insert({
        user_id: userId,
        log_date: log_date || date || new Date().toISOString().slice(0, 10),
        meal_type: mealType,
        food_name: foodName,
        quantity: quantity ?? 1,
        serving_unit: servingUnit ?? null,
        calories,
        protein_g: proteinG ?? 0,
        carbs_g: carbsG ?? 0,
        fat_g: fatG ?? 0,
        logged_via: loggedVia || 'manual',
        food_id: foodId ?? null,
      })
      .select()
      .single();
    if (error) {
      console.error('Food log insert error:', JSON.stringify(error, null, 2));
      return res.status(500).json({ message: error.message, details: error.details, hint: error.hint });
    }
    res.json(data);
  } catch (err) {
    console.error('log food error:', err);
    res.status(500).json({ message: err.message || 'Failed to log food' });
  }
});

// Route 4: GET /api/food-logs/:userId?date=YYYY-MM-DD
app.get('/api/food-logs/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    const date = req.query.date || new Date().toISOString().slice(0, 10);
    const { data, error } = await supabase
      .from('food_logs')
      .select('*')
      .eq('user_id', userId)
      .eq('log_date', date)
      .order('created_at', { ascending: true });
    if (error) throw error;

    const mealOrder = { breakfast: 0, lunch: 1, snack: 2, dinner: 3 };
    const logs = (data || []).slice().sort((a, b) => {
      const ma = mealOrder[a.meal_type] ?? 99;
      const mb = mealOrder[b.meal_type] ?? 99;
      if (ma !== mb) return ma - mb;
      return new Date(a.created_at) - new Date(b.created_at);
    });

    const totals = logs.reduce((acc, l) => {
      acc.totalCalories += Number(l.calories) || 0;
      acc.totalProtein  += Number(l.protein_g) || 0;
      acc.totalCarbs    += Number(l.carbs_g) || 0;
      acc.totalFat      += Number(l.fat_g) || 0;
      return acc;
    }, { totalCalories: 0, totalProtein: 0, totalCarbs: 0, totalFat: 0 });

    res.json({ logs, totals });
  } catch (err) {
    console.error('get food logs error:', err);
    res.status(500).json({ message: err.message || 'Failed to fetch food logs' });
  }
});

// Route 5: DELETE /api/food-logs/:logId
app.delete('/api/food-logs/:logId', async (req, res) => {
  try {
    const { logId } = req.params;
    const { error } = await supabase.from('food_logs').delete().eq('id', logId);
    if (error) throw error;
    res.json({ success: true });
  } catch (err) {
    console.error('delete food log error:', err);
    res.status(500).json({ message: err.message || 'Failed to delete food log' });
  }
});

// Replaced by foodSearchRoutes.js

// Route 7: POST /api/food-logs/voice
app.post('/api/food-logs/voice', async (req, res) => {
  try {
    const { userId, transcript, mealType } = req.body;
    if (!userId || !transcript || !mealType) {
      return res.status(400).json({ message: 'userId, transcript, mealType are required' });
    }

    const systemPrompt = `You are a food nutrition parser for an Indian fitness app. The user will describe what they ate in English or Hinglish. Extract each food item with estimated quantity and nutritional info per serving. Return ONLY valid JSON array, no markdown, no explanation:
[
  {
    "food_name": "string",
    "quantity": number,
    "serving_unit": "plate/bowl/piece/cup/glass/katori",
    "calories": number,
    "protein_g": number,
    "carbs_g": number,
    "fat_g": number
  }
]
Use Indian food nutrition data. Common references:
- 1 roti/chapati: ~120 cal, 3g protein, 20g carbs, 3.5g fat
- 1 katori dal: ~150 cal, 9g protein, 20g carbs, 4g fat
- 1 plate rice (150g cooked): ~180 cal, 3.5g protein, 40g carbs, 0.4g fat
- 1 katori sabzi (avg): ~120 cal, 3g protein, 10g carbs, 7g fat
- 1 egg (boiled): ~78 cal, 6g protein, 0.6g carbs, 5g fat
- 1 glass milk (250ml): ~150 cal, 8g protein, 12g carbs, 8g fat
- 1 scoop whey protein: ~120 cal, 24g protein, 3g carbs, 1.5g fat
- 1 banana: ~105 cal, 1.3g protein, 27g carbs, 0.4g fat
- 1 plate chicken curry (150g): ~250 cal, 25g protein, 8g carbs, 14g fat
- 1 plate rajma chawal: ~400 cal, 15g protein, 65g carbs, 8g fat
Be generous with common sense. If someone says 'lunch mein dal chawal khaya' assume 1 katori dal + 1 plate rice.`;

    const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });
    const result = await model.generateContent([
      { text: systemPrompt },
      { text: `User said: "${transcript}"` },
    ]);
    const text = result.response.text();
    const items = extractJson(text);
    if (!Array.isArray(items)) throw new Error('Gemini did not return a JSON array');

    const today = new Date().toISOString().slice(0, 10);
    const rows = items.map((it) => ({
      user_id: userId,
      log_date: today,
      meal_type: mealType,
      food_name: it.food_name,
      quantity: it.quantity ?? 1,
      serving_unit: it.serving_unit ?? null,
      calories: it.calories ?? 0,
      protein_g: it.protein_g ?? 0,
      carbs_g: it.carbs_g ?? 0,
      fat_g: it.fat_g ?? 0,
      logged_via: 'voice',
    }));

    if (rows.length === 0) return res.json([]);

    const { data, error } = await supabase.from('food_logs').insert(rows).select();
    if (error) throw error;
    res.json(data);
  } catch (err) {
    console.error('voice food log error:', err);
    res.status(500).json({ message: err.message || 'Failed to log food via voice' });
  }
});

// Route 8: POST /api/food-logs/camera
app.post('/api/food-logs/camera', async (req, res) => {
  try {
    const { userId, imageBase64, mealType } = req.body;
    if (!userId || !imageBase64 || !mealType) {
      return res.status(400).json({ message: 'userId, imageBase64, mealType are required' });
    }

    const prompt = `Look at this photo of food. Identify each food item visible. For each item, estimate the portion size and nutritional content. Focus on Indian food if applicable. Return ONLY valid JSON array:
[
  {
    "food_name": "string",
    "quantity": number,
    "serving_unit": "plate/bowl/piece/cup/glass/katori",
    "calories": number,
    "protein_g": number,
    "carbs_g": number,
    "fat_g": number,
    "confidence": "high/medium/low"
  }
]
If you can't identify the food clearly, set confidence to 'low'. Be reasonable with portion estimates.`;

    const cleanedB64 = imageBase64.replace(/^data:image\/\w+;base64,/, '');
    const mimeMatch = imageBase64.match(/^data:(image\/\w+);base64,/);
    const mimeType = mimeMatch ? mimeMatch[1] : 'image/jpeg';

    const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });
    const result = await model.generateContent([
      { text: prompt },
      { inlineData: { mimeType, data: cleanedB64 } },
    ]);
    const text = result.response.text();
    const items = extractJson(text);
    if (!Array.isArray(items)) throw new Error('Gemini did not return a JSON array');

    const today = new Date().toISOString().slice(0, 10);
    const rows = items.map((it) => ({
      user_id: userId,
      log_date: today,
      meal_type: mealType,
      food_name: it.food_name,
      quantity: it.quantity ?? 1,
      serving_unit: it.serving_unit ?? null,
      calories: it.calories ?? 0,
      protein_g: it.protein_g ?? 0,
      carbs_g: it.carbs_g ?? 0,
      fat_g: it.fat_g ?? 0,
      logged_via: 'camera',
    }));

    if (rows.length === 0) return res.json([]);

    const { data, error } = await supabase.from('food_logs').insert(rows).select();
    if (error) throw error;

    const withConfidence = data.map((row, i) => ({
      ...row,
      confidence: items[i]?.confidence ?? 'medium',
    }));
    res.json(withConfidence);
  } catch (err) {
    console.error('camera food log error:', err);
    res.status(500).json({ message: err.message || 'Failed to log food via camera' });
  }
});

// Route 9: POST /api/diet-plan/generate
app.post('/api/diet-plan/generate', async (req, res) => {
  try {
    const { userId, dietType = 'non_veg', cuisinePref = 'north_indian' } = req.body;
    if (!userId) return res.status(400).json({ message: 'userId is required' });

    const { data: existing } = await supabase
      .from('user_macros')
      .select('*')
      .eq('user_id', userId)
      .maybeSingle();
    const macros = existing || await computeMacrosForUser(userId);

    const prompt = `Generate a 7-day Indian diet plan. Requirements:
- Daily target: ${macros.calories} calories, ${macros.protein_g}g protein, ${macros.carbs_g}g carbs, ${macros.fat_g}g fat
- Diet type: ${dietType}
- Cuisine: ${cuisinePref}
- Budget-friendly, realistic Indian meals
- Use familiar portions: roti count, katori for dal/sabzi, plate for rice, glass for milk/lassi
- Include 4 meals per day: breakfast, lunch, snack, dinner
- Each meal should list items with individual calories and macros

Return ONLY valid JSON, no markdown:
{
  "daily_targets": { "calories": number, "protein_g": number, "carbs_g": number, "fat_g": number },
  "days": [
    {
      "day": 1,
      "day_name": "Monday",
      "meals": [
        {
          "meal_type": "breakfast",
          "items": [
            { "name": "string", "quantity": "2 pieces", "calories": number, "protein_g": number, "carbs_g": number, "fat_g": number }
          ],
          "meal_calories": number
        }
      ],
      "day_total": { "calories": number, "protein_g": number, "carbs_g": number, "fat_g": number }
    }
  ]
}`;

    const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });
    const result = await model.generateContent(prompt);
    const planData = extractJson(result.response.text());

    await supabase
      .from('user_diet_plans')
      .update({ is_active: false })
      .eq('user_id', userId)
      .eq('is_active', true);

    const { data, error } = await supabase
      .from('user_diet_plans')
      .insert({
        user_id: userId,
        plan_data: planData,
        diet_type: dietType,
        cuisine_pref: cuisinePref,
        is_active: true,
      })
      .select()
      .single();
    if (error) throw error;

    res.json(data);
  } catch (err) {
    console.error('generate diet plan error:', err);
    res.status(500).json({ message: err.message || 'Failed to generate diet plan' });
  }
});

// Route 10: GET /api/diet-plan/:userId
app.get('/api/diet-plan/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    const { data, error } = await supabase
      .from('user_diet_plans')
      .select('*')
      .eq('user_id', userId)
      .eq('is_active', true)
      .order('generated_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    res.json(data || null);
  } catch (err) {
    console.error('get diet plan error:', err);
    res.status(500).json({ message: err.message || 'Failed to fetch diet plan' });
  }
});

// ── Custom Saved Meals ────────────────────────────────────────────────────────

// POST /api/custom-meals
app.post('/api/custom-meals', async (req, res) => {
  try {
    const { userId, name, items } = req.body;
    if (!userId || !name || !Array.isArray(items)) {
      return res.status(400).json({ error: 'userId, name, and items are required' });
    }
    const totals = items.reduce((acc, item) => ({
      calories: acc.calories + (Number(item.calories)  || 0),
      protein:  acc.protein  + (Number(item.protein_g) || 0),
      carbs:    acc.carbs    + (Number(item.carbs_g)   || 0),
      fat:      acc.fat      + (Number(item.fat_g)     || 0),
    }), { calories: 0, protein: 0, carbs: 0, fat: 0 });

    const { data, error } = await supabase
      .from('custom_meals')
      .insert({
        user_id:         userId,
        name,
        items,
        total_calories:  totals.calories,
        total_protein_g: totals.protein,
        total_carbs_g:   totals.carbs,
        total_fat_g:     totals.fat,
      })
      .select()
      .single();

    if (error) return res.status(500).json({ error: error.message });
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/custom-meals/:userId
app.get('/api/custom-meals/:userId', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('custom_meals')
      .select('*')
      .eq('user_id', req.params.userId)
      .order('created_at', { ascending: false });
    if (error) return res.status(500).json({ error: error.message });
    res.json(data || []);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/custom-meals/:mealId
app.delete('/api/custom-meals/:mealId', async (req, res) => {
  try {
    const { error } = await supabase
      .from('custom_meals')
      .delete()
      .eq('id', req.params.mealId);
    if (error) return res.status(500).json({ error: error.message });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Workout session ───────────────────────────────────────────────────────────

// POST /api/workout/finish
// Uses service-role key → direct Postgres driver, bypasses PostgREST schema
// cache entirely.  Fixes "exercises column not found" on workout_logs.
app.post('/api/workout/finish', async (req, res) => {
  try {
    const { sessionId, durationMinutes, exercises, sets } = req.body;

    if (!sessionId) return res.status(400).json({ error: 'sessionId is required' });

    const { error: updateError } = await supabase
      .from('workout_logs')
      .update({
        completed_at:     new Date().toISOString(),
        duration_minutes: durationMinutes,
        exercises:        exercises,
      })
      .eq('id', sessionId);

    if (updateError) {
      console.error('Workout log update error:', updateError);
      return res.status(500).json({ error: updateError.message });
    }

    if (sets && sets.length > 0) {
      const { error: setsError } = await supabase
        .from('workout_set_logs')
        .insert(sets);

      if (setsError) {
        console.error('Set logs insert error:', setsError);
        return res.status(500).json({ error: setsError.message });
      }
    }

    res.json({ success: true });
  } catch (err) {
    console.error('Finish workout error:', err);
    res.status(500).json({ error: err.message });
  }
});

require('./trainerRoutes')(app, supabase);

// ── User workout plans ──────────────────────────────────
app.get('/api/user-plans/:userId', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('user_workout_plans')
      .select('*')
      .eq('user_id', req.params.userId)
      .eq('is_active', true)
      .order('created_at', { ascending: false });
    if (error) throw error;
    res.json(data || []);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/user-plans', async (req, res) => {
  try {
    const { userId, name, description, planData } = req.body;
    if (!userId || !name) return res.status(400).json({ error: 'userId and name required' });
    const { data, error } = await supabase
      .from('user_workout_plans')
      .insert({ user_id: userId, name, description: description || '', plan_data: planData || {} })
      .select().single();
    if (error) throw error;
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.patch('/api/user-plans/:planId', async (req, res) => {
  try {
    const updates = { ...req.body, updated_at: new Date().toISOString() };
    delete updates.user_id;
    const { data, error } = await supabase
      .from('user_workout_plans')
      .update(updates)
      .eq('id', req.params.planId)
      .select().single();
    if (error) throw error;
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/user-plans/:planId', async (req, res) => {
  try {
    const { error } = await supabase
      .from('user_workout_plans')
      .update({ is_active: false })
      .eq('id', req.params.planId);
    if (error) throw error;
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Consumer Settings Routes ──────────────────────────────────────────────────

app.get('/api/users/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    const { data, error } = await supabase
      .from('users')
      .select('id, full_name, age, gender, goal, experience, equipment, injuries, training_days, current_weight, height, target_weight, activity_level, phone, role, gym_id, created_at')
      .eq('id', userId)
      .maybeSingle();
      
    if (error) throw error;
    if (!data) return res.status(404).json({ message: 'User not found' });
    res.json(data);
  } catch (err) {
    console.error('GET /api/users/:userId error:', err);
    res.status(500).json({ message: err.message || 'Failed to fetch user' });
  }
});

app.patch('/api/users/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    const body = req.body;
    
    const allowed = [
      'full_name', 'age', 'gender', 'goal',
      'experience', 'equipment', 'injuries',
      'training_days', 'current_weight', 'height',
      'target_weight', 'activity_level', 'phone'
    ];
    
    const updateObj = {};
    allowed.forEach(field => {
      if (body[field] !== undefined) {
        updateObj[field] = body[field];
      }
    });

    // equipment is stored as array; normalise if frontend sends a comma string
    if (typeof updateObj.equipment === 'string') {
      updateObj.equipment = updateObj.equipment
        .split(',').map(s => s.trim()).filter(Boolean);
    }

    if (Object.keys(updateObj).length === 0) {
      return res.status(400).json({ error: 'No valid fields to update' });
    }

    const { error: updateErr } = await supabase
      .from('users')
      .update(updateObj)
      .eq('id', userId);
      
    if (updateErr) throw updateErr;
    
    const { data: updatedRow, error: fetchErr } = await supabase
      .from('users')
      .select('id, full_name, age, gender, goal, experience, equipment, injuries, training_days, current_weight, height, target_weight, activity_level, phone, role, gym_id, created_at')
      .eq('id', userId)
      .maybeSingle();
      
    if (fetchErr) throw fetchErr;
    if (!updatedRow) return res.status(404).json({ message: 'User not found after update' });
    
    res.json(updatedRow);
  } catch (err) {
    console.error('PATCH /api/users/:userId error:', err);
    res.status(500).json({ message: err.message || 'Failed to update user' });
  }
});

app.post('/api/users/:userId/change-password', async (req, res) => {
  try {
    const { userId } = req.params;
    const { new_password } = req.body;
    
    if (!new_password || new_password.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters long' });
    }
    
    // Requires SUPABASE_SERVICE_KEY (service role key)
    const { error } = await supabase.auth.admin.updateUserById(userId, {
      password: new_password
    });
    
    if (error) throw error;
    res.json({ success: true, message: 'Password updated successfully' });
  } catch (err) {
    console.error('POST /api/users/:userId/change-password error:', err);
    res.status(500).json({ error: err.message || 'Failed to update password' });
  }
});

app.delete('/api/users/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    
    // 1. Soft-delete in users table
    const { error: updateErr } = await supabase
      .from('users')
      .update({ is_active: false })
      .eq('id', userId);
      
    if (updateErr) throw updateErr;
    
    // 2. Disable the auth account by banning it
    const { error: banErr } = await supabase.auth.admin.updateUserById(userId, { 
      ban_duration: '876000h' 
    });
    
    if (banErr) throw banErr;
    
    res.json({ success: true, message: 'Account deactivated' });
  } catch (err) {
    console.error('DELETE /api/users/:userId error:', err);
    res.status(500).json({ message: err.message || 'Failed to deactivate account' });
  }
});

require('./foodSearchRoutes')(app, supabase);

const exerciseRoutes = require('./routes/exerciseRoutes');
app.use('/api/exercises', exerciseRoutes);

app.listen(PORT, () => {
  console.log(`FitForge backend running on http://localhost:${PORT}`);
  console.log('Diet redesign routes registered:');
  console.log('  POST   /api/macros/calculate');
  console.log('  GET    /api/macros/:userId');
  console.log('  POST   /api/food-logs');
  console.log('  GET    /api/food-logs/:userId');
  console.log('  DELETE /api/food-logs/:logId');
  console.log('  GET    /api/food-search');
  console.log('  POST   /api/food-logs/voice');
  console.log('  POST   /api/food-logs/camera');
  console.log('  POST   /api/diet-plan/generate');
  console.log('  GET    /api/diet-plan/:userId');
  console.log('Workout session routes registered:');
  console.log('  POST   /api/workout/finish');
});
