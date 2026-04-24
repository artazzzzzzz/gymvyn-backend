const express = require('express');
const cors = require('cors');
require('dotenv').config();
const Anthropic = require('@anthropic-ai/sdk');
const { createClient } = require('@supabase/supabase-js');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors({
  origin: process.env.FRONTEND_URL || 'https://fitforge-frontend.vercel.app',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

app.use(express.json());

const anthropic = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

app.post('/generate-workout-plan', async (req, res) => {
  try {
    const { userId, goal, experience, equipment, daysPerWeek, injuries } = req.body;

    if (!userId || !goal || !experience || !equipment || !daysPerWeek) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const prompt = `You are an expert fitness coach. Generate a ${daysPerWeek}-day per week workout plan for an Indian gym goer.

User Profile:
- Goal: ${goal}
- Experience: ${experience}
- Equipment: ${equipment}
- Days per week: ${daysPerWeek}
- Injuries/limitations: ${injuries || 'None'}

Return ONLY a valid JSON object in this exact format, no extra text:
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
- Rest days should have empty exercises array and isRestDay true
- Reps can be a range like "8-10" or a number like "12"
- Include warm up and cool down as exercises where needed
- Match exercises to available equipment: ${equipment}
- Total days in weeklyStructure must be exactly 7`;

    const message = await anthropic.messages.create({
      model: 'claude-opus-4-5',
      max_tokens: 4000,
      messages: [{ role: 'user', content: prompt }],
    });

    const responseText = message.content[0].text;
    const planData = JSON.parse(responseText);

    const { data: savedPlan, error } = await supabase
      .from('workout_plans')
      .insert({
        user_id: userId,
        goal,
        days_per_week: daysPerWeek,
        plan_data: planData,
        is_active: true,
      })
      .select()
      .single();

    if (error) throw error;

    res.json({ success: true, plan: savedPlan });

  } catch (error) {
    console.error('Generate workout plan error:', error);
    res.status(500).json({ error: 'Failed to generate workout plan' });
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

    if (error && error.code !== 'PGRST116') throw error;

    res.json({ success: true, plan: data || null });

  } catch (error) {
    console.error('Get workout plan error:', error);
    res.status(500).json({ error: 'Failed to fetch workout plan' });
  }
});

app.listen(PORT, () => {
  console.log(`FitForge backend running on http://localhost:${PORT}`);
});
