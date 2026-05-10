const express = require('express');
const cors = require('cors');
require('dotenv').config();
const { GoogleGenerativeAI } = require('@google/generative-ai');
const { createClient } = require('@supabase/supabase-js');
const cloudinary = require('cloudinary').v2;
const multer = require('multer');
const { CloudinaryStorage } = require('multer-storage-cloudinary');
const { parse: parseCsvSync } = require('csv-parse/sync');

const app = express();
const PORT = process.env.PORT || 3000;

const allowedOrigins = [
  process.env.FRONTEND_URL || 'https://fitforge-frontend.vercel.app',
  'http://localhost:5173',
  'http://localhost:5174',
  'http://localhost:3000',
];

app.use(cors());

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
    const { userId, gymName, address, city, state, pincode, phone, email } = req.body;

    if (!userId)                       return res.status(400).json({ message: 'Missing required field: userId' });
    if (!gymName || !gymName.trim())   return res.status(400).json({ message: 'Gym name is required' });
    if (!city || !city.trim())         return res.status(400).json({ message: 'City is required' });
    if (!phone || !phone.trim())       return res.status(400).json({ message: 'Phone number is required' });
    if (!/^\d{10}$/.test(phone.trim())) return res.status(400).json({ message: 'Phone must be 10 digits' });
    if (pincode && !/^\d{6}$/.test(pincode.trim())) return res.status(400).json({ message: 'Pincode must be 6 digits' });
    if (email && !/^\S+@\S+\.\S+$/.test(email.trim())) return res.status(400).json({ message: 'Email is not valid' });

    // Check if user is already a gym owner
    const { data: existingUser, error: userFetchError } = await supabase
      .from('users')
      .select('role, gym_id')
      .eq('id', userId)
      .maybeSingle();

    if (userFetchError) throw userFetchError;
    if (existingUser?.role === 'gym_owner' || existingUser?.gym_id) {
      return res.status(409).json({ message: 'User is already associated with a gym' });
    }

    // Insert gym
    const joinCode = Math.random().toString(36).substring(2, 8).toUpperCase();
    const { data: gym, error: gymError } = await supabase
      .from('gyms')
      .insert({
        name:     gymName.trim(),
        address:  address?.trim()  || null,
        city:     city.trim(),
        state:    state?.trim()    || null,
        pincode:  pincode?.trim()  || null,
        phone:    phone.trim(),
        email:    email?.trim()    || null,
        owner_id: userId,
        join_code: joinCode,
      })
      .select()
      .single();

    if (gymError) throw gymError;

    // Promote user to gym_owner; if it fails, roll back the gym insert
    const { error: updateError } = await supabase
      .from('users')
      .update({ role: 'gym_owner', gym_id: gym.id })
      .eq('id', userId);

    if (updateError) {
      console.error('Promoting user to gym_owner failed, rolling back gym:', updateError);
      await supabase.from('gyms').delete().eq('id', gym.id);
      throw updateError;
    }

    res.status(201).json({ gym, joinCode: gym.join_code });
  } catch (err) {
    console.error('POST /api/gyms error:', err);
    res.status(500).json({ message: err.message || 'Failed to create gym' });
  }
});

app.get('/api/gyms/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    const { data, error } = await supabase
      .from('gyms')
      .select('*')
      .eq('owner_id', userId)
      .maybeSingle();
    if (error) throw error;
    res.json(data);
  } catch (err) {
    console.error('GET /api/gyms/:userId error:', err);
    res.status(500).json({ message: err.message || 'Failed to fetch gym' });
  }
});

app.get('/api/gyms/:gymId/settings', async (req, res) => {
  try {
    const { gymId } = req.params;
    const { data, error } = await supabase
      .from('gyms')
      .select('name, address, city, state, pincode, phone, email, logo_url, join_code, plan_tier')
      .eq('id', gymId)
      .maybeSingle();
    if (error) throw error;
    if (!data) return res.status(404).json({ message: 'Gym not found' });
    res.json(data);
  } catch (err) {
    console.error('GET /api/gyms/:gymId/settings error:', err);
    res.status(500).json({ message: err.message || 'Failed to fetch settings' });
  }
});

app.patch('/api/gyms/:gymId/settings', async (req, res) => {
  try {
    const { gymId } = req.params;
    const { name, address, city, state, pincode, phone, email } = req.body;
    const updates = {};
    if (name     !== undefined) updates.name     = name;
    if (address  !== undefined) updates.address  = address;
    if (city     !== undefined) updates.city     = city;
    if (state    !== undefined) updates.state    = state;
    if (pincode  !== undefined) updates.pincode  = pincode;
    if (phone    !== undefined) updates.phone    = phone;
    if (email    !== undefined) updates.email    = email;

    const { error } = await supabase.from('gyms').update(updates).eq('id', gymId);
    if (error) throw error;
    res.json({ success: true });
  } catch (err) {
    console.error('PATCH /api/gyms/:gymId/settings error:', err);
    res.status(500).json({ message: err.message || 'Failed to update settings' });
  }
});

const logoStorage = new CloudinaryStorage({
  cloudinary,
  params: {
    folder: 'fitforge/gym-logos',
    allowed_formats: ['jpg', 'jpeg', 'png', 'webp'],
  },
});
const logoUpload = multer({ storage: logoStorage });

app.post('/api/gyms/:gymId/upload-logo', logoUpload.single('logo'), async (req, res) => {
  try {
    const { gymId } = req.params;
    if (!req.file) return res.status(400).json({ message: 'No file uploaded' });
    const logo_url = req.file.path;
    const { error } = await supabase.from('gyms').update({ logo_url }).eq('id', gymId);
    if (error) throw error;
    res.json({ success: true, logo_url });
  } catch (err) {
    console.error('POST /api/gyms/:gymId/upload-logo error:', err);
    res.status(500).json({ message: err.message || 'Failed to upload logo' });
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

// ── Trainer management ────────────────────────────────────────────────────────

app.post('/api/gym-trainers/invite', async (req, res) => {
  try {
    const { gym_id, full_name, phone, bio, specialties, hourly_rate } = req.body;
    if (!gym_id || !full_name) {
      return res.status(400).json({ message: 'gym_id and full_name are required' });
    }

    const userId = crypto.randomUUID();

    // Insert into users
    const { error: userErr } = await supabase
      .from('users')
      .insert({ id: userId, full_name, phone: phone || null, role: 'trainer', is_active: true });
    if (userErr) throw userErr;

    // Insert into trainer_profiles
    const { error: profileErr } = await supabase
      .from('trainer_profiles')
      .insert({
        user_id: userId,
        gym_id,
        bio: bio || null,
        specialties: specialties || null,
        hourly_rate: hourly_rate || null,
        is_active: true,
      });
    if (profileErr) {
      await supabase.from('users').delete().eq('id', userId);
      throw profileErr;
    }

    res.status(201).json({ success: true, trainer_id: userId });
  } catch (err) {
    console.error('POST /api/gym-trainers/invite error:', err);
    res.status(500).json({ message: err.message || 'Failed to invite trainer' });
  }
});

app.get('/api/gym-trainers/:gymId', async (req, res) => {
  try {
    const { gymId } = req.params;

    // Step 1: get active trainer_profiles for this gym
    const { data: profiles, error: profilesErr } = await supabase
      .from('trainer_profiles')
      .select('user_id, bio, specialties, hourly_rate')
      .eq('gym_id', gymId)
      .eq('is_active', true);
    if (profilesErr) throw profilesErr;

    if (!profiles || profiles.length === 0) {
      return res.json([]);
    }

    // Step 2: fetch full_name + phone for each trainer's user_id
    const userIds = profiles.map(p => p.user_id);
    const { data: users, error: usersErr } = await supabase
      .from('users')
      .select('id, full_name, phone')
      .in('id', userIds);
    if (usersErr) throw usersErr;

    // Step 3: count active members assigned to each trainer
    const { data: assignments, error: assignErr } = await supabase
      .from('gym_memberships')
      .select('assigned_trainer_id')
      .in('assigned_trainer_id', userIds)
      .eq('status', 'active');
    if (assignErr) throw assignErr;

    const assignedCount = new Map();
    for (const a of assignments || []) {
      assignedCount.set(a.assigned_trainer_id, (assignedCount.get(a.assigned_trainer_id) || 0) + 1);
    }

    const userById = new Map((users || []).map(u => [u.id, u]));
    const profileByUserId = new Map(profiles.map(p => [p.user_id, p]));

    const trainers = userIds
      .map(uid => {
        const u = userById.get(uid);
        const p = profileByUserId.get(uid);
        if (!u) return null;
        return {
          user_id: uid,
          full_name: u.full_name,
          phone: u.phone || null,
          bio: p?.bio || null,
          specialties: p?.specialties || null,
          hourly_rate: p?.hourly_rate || null,
          members_assigned: assignedCount.get(uid) || 0,
        };
      })
      .filter(Boolean)
      .sort((a, b) => a.full_name.localeCompare(b.full_name));

    res.json(trainers);
  } catch (err) {
    console.error('GET /api/gym-trainers/:gymId error:', err);
    res.status(500).json({ message: err.message || 'Failed to fetch trainers' });
  }
});

app.delete('/api/gym-trainers/:trainerId', async (req, res) => {
  try {
    const { trainerId } = req.params;

    const { error: profileErr } = await supabase
      .from('trainer_profiles')
      .update({ is_active: false })
      .eq('user_id', trainerId);
    if (profileErr) throw profileErr;

    const { error: userErr } = await supabase
      .from('users')
      .update({ is_active: false })
      .eq('id', trainerId);
    if (userErr) throw userErr;

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

const VALID_PAYMENT_STATUSES = ['pending', 'paid', 'overdue'];

app.get('/api/gym-payments/:gymId', async (req, res) => {
  try {
    const { gymId } = req.params;
    const { status } = req.query;

    let query = supabase
      .from('payments')
      .select('id, user_id, membership_id, amount, due_date, paid_at, status, payment_method, notes, users(full_name)')
      .eq('gym_id', gymId)
      .order('due_date', { ascending: false });

    if (status) {
      if (!VALID_PAYMENT_STATUSES.includes(status)) {
        return res.status(400).json({ message: `status must be one of: ${VALID_PAYMENT_STATUSES.join(', ')}` });
      }
      query = query.eq('status', status);
    }

    const { data, error } = await query;
    if (error) throw error;

    const flattened = (data || []).map(p => ({
      id: p.id,
      user_id: p.user_id,
      full_name: p.users?.full_name ?? null,
      membership_id: p.membership_id,
      amount: p.amount,
      due_date: p.due_date,
      paid_at: p.paid_at,
      status: p.status,
      payment_method: p.payment_method,
      notes: p.notes,
    }));

    res.json(flattened);
  } catch (err) {
    console.error('GET /api/gym-payments/:gymId error:', err);
    res.status(500).json({ message: err.message || 'Failed to fetch payments' });
  }
});

app.post('/api/gym-payments/:paymentId/mark-paid', async (req, res) => {
  try {
    const { paymentId } = req.params;
    const { payment_method, notes } = req.body || {};

    const update = {
      status: 'paid',
      paid_at: new Date().toISOString(),
    };
    if (payment_method) update.payment_method = String(payment_method).trim();
    if (notes != null)  update.notes = String(notes).trim() || null;

    const { error } = await supabase
      .from('payments')
      .update(update)
      .eq('id', paymentId);
    if (error) throw error;

    res.json({ success: true });
  } catch (err) {
    console.error('POST /api/gym-payments/:paymentId/mark-paid error:', err);
    res.status(500).json({ message: err.message || 'Failed to mark payment paid' });
  }
});

app.post('/api/gym-payments', async (req, res) => {
  try {
    const { gym_id, user_id, membership_id, amount, due_date, notes } = req.body || {};

    if (!gym_id)   return res.status(400).json({ message: 'gym_id is required' });
    if (!user_id)  return res.status(400).json({ message: 'user_id is required' });
    if (!due_date) return res.status(400).json({ message: 'due_date is required' });

    const amt = Number(amount);
    if (!Number.isFinite(amt) || amt <= 0) {
      return res.status(400).json({ message: 'amount must be a positive number' });
    }

    const { data, error } = await supabase
      .from('payments')
      .insert({
        gym_id,
        user_id,
        membership_id: membership_id || null,
        amount: amt,
        due_date,
        status: 'pending',
        notes: notes ? String(notes).trim() || null : null,
      })
      .select('id')
      .single();
    if (error) throw error;

    res.status(201).json({ success: true, payment_id: data.id });
  } catch (err) {
    console.error('POST /api/gym-payments error:', err);
    res.status(500).json({ message: err.message || 'Failed to create payment' });
  }
});

// ── Class schedule ────────────────────────────────────────────────────────────

app.get('/api/gym-schedule/:gymId', async (req, res) => {
  try {
    const { gymId } = req.params;

    const { data: classes, error: classErr } = await supabase
      .from('class_schedule')
      .select('id, class_name, description, trainer_id, day_of_week, start_time, end_time, capacity')
      .eq('gym_id', gymId)
      .eq('is_active', true)
      .order('day_of_week', { ascending: true })
      .order('start_time', { ascending: true });
    if (classErr) throw classErr;

    const trainerIds = [...new Set((classes || []).map(c => c.trainer_id).filter(Boolean))];
    let nameById = new Map();
    if (trainerIds.length) {
      const { data: users, error: userErr } = await supabase
        .from('users')
        .select('id, full_name')
        .in('id', trainerIds);
      if (userErr) throw userErr;
      nameById = new Map((users || []).map(u => [u.id, u.full_name]));
    }

    const result = (classes || []).map(c => ({
      ...c,
      trainer_name: nameById.get(c.trainer_id) || null,
    }));

    res.json(result);
  } catch (err) {
    console.error('GET /api/gym-schedule/:gymId error:', err);
    res.status(500).json({ message: err.message || 'Failed to fetch schedule' });
  }
});

app.post('/api/gym-schedule', async (req, res) => {
  try {
    const {
      gym_id, class_name, description, trainer_id,
      day_of_week, start_time, end_time, capacity,
    } = req.body || {};

    if (!gym_id)                          return res.status(400).json({ message: 'gym_id is required' });
    if (!class_name || !class_name.trim()) return res.status(400).json({ message: 'class_name is required' });
    if (day_of_week == null || Number.isNaN(Number(day_of_week))) {
      return res.status(400).json({ message: 'day_of_week is required (0-6)' });
    }
    if (!start_time)                      return res.status(400).json({ message: 'start_time is required' });
    if (!end_time)                        return res.status(400).json({ message: 'end_time is required' });

    const cap = Number(capacity);
    if (!Number.isFinite(cap) || cap <= 0) {
      return res.status(400).json({ message: 'capacity must be a positive number' });
    }

    const { data, error } = await supabase
      .from('class_schedule')
      .insert({
        gym_id,
        class_name: class_name.trim(),
        description: description?.trim() || null,
        trainer_id: trainer_id || null,
        day_of_week: Number(day_of_week),
        start_time,
        end_time,
        capacity: cap,
        is_active: true,
      })
      .select('id')
      .single();
    if (error) throw error;

    res.status(201).json({ success: true, class_id: data.id });
  } catch (err) {
    console.error('POST /api/gym-schedule error:', err);
    res.status(500).json({ message: err.message || 'Failed to create class' });
  }
});

app.delete('/api/gym-schedule/:classId', async (req, res) => {
  try {
    const { classId } = req.params;
    const { error } = await supabase
      .from('class_schedule')
      .update({ is_active: false })
      .eq('id', classId);
    if (error) throw error;
    res.json({ success: true });
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

app.listen(PORT, () => {
  console.log(`FitForge backend running on http://localhost:${PORT}`);
});
