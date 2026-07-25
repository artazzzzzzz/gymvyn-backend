const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const { z } = require('zod');
const { auth } = require('../middleware/auth');
const { normalizeFoodName } = require('../utils/foodNutritionResolver');

const router = express.Router();
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

const customFoodSchema = z.object({
  name: z.string().trim().min(1).max(160),
  brand: z.string().trim().max(120).optional().nullable(),
  category: z.string().trim().max(80).optional().default('custom'),
  calories: z.number().nonnegative().optional(),
  calories_per_serving: z.number().nonnegative().optional(),
  protein_g: z.number().nonnegative().optional().default(0),
  carbs_g: z.number().nonnegative().optional().default(0),
  fat_g: z.number().nonnegative().optional().default(0),
  fiber_g: z.number().nonnegative().optional().default(0),
  serving_size: z.number().positive(),
  serving_unit: z.string().trim().min(1).max(40),
  serving_description: z.string().trim().max(160).optional().nullable(),
  grams_equivalent: z.number().positive().optional().nullable(),
  ml_equivalent: z.number().positive().optional().nullable(),
  barcode: z.string().trim().max(80).optional().nullable(),
  notes: z.string().trim().max(1000).optional().nullable(),
}).strict();

const customFoodUpdateSchema = customFoodSchema.partial().refine(
  value => Object.keys(value).length > 0,
  'At least one field is required'
);

function parseBody(schema, body) {
  const result = schema.safeParse(body || {});
  if (!result.success) {
    const message = result.error.issues
      .map(issue => `${issue.path.join('.') || 'body'}: ${issue.message}`)
      .join('; ');
    return { error: message };
  }
  return { data: result.data };
}

function toDbPayload(input, userId) {
  const calories = input.calories_per_serving ?? input.calories;
  const payload = {
    ...input,
    user_id: userId,
    normalized_name: normalizeFoodName(input.name),
    calories_per_serving: calories,
    category: input.category || 'custom',
    serving_description: input.serving_description || `${input.serving_size} ${input.serving_unit}`,
    updated_at: new Date().toISOString(),
  };

  delete payload.calories;
  if (payload.brand === '') payload.brand = null;
  if (payload.barcode === '') payload.barcode = null;
  if (payload.notes === '') payload.notes = null;
  return payload;
}

router.get('/', auth, async (req, res) => {
  try {
    const query = normalizeFoodName(req.query.q || '');
    let request = supabase
      .from('user_custom_foods')
      .select('*')
      .eq('user_id', req.user.id)
      .order('updated_at', { ascending: false })
      .limit(Math.min(Number(req.query.limit) || 100, 200));

    if (query) request = request.ilike('normalized_name', `%${query}%`);

    const { data, error } = await request;
    if (error) throw error;
    res.json(data || []);
  } catch (err) {
    console.error('GET /api/custom-foods error:', err);
    res.status(500).json({ error: err.message || 'Failed to fetch custom foods' });
  }
});

router.post('/', auth, async (req, res) => {
  try {
    const parsed = parseBody(customFoodSchema, req.body);
    if (parsed.error) return res.status(400).json({ error: parsed.error });

    const payload = toDbPayload(parsed.data, req.user.id);
    if (payload.calories_per_serving == null) {
      return res.status(400).json({ error: 'calories or calories_per_serving is required' });
    }

    const { data, error } = await supabase
      .from('user_custom_foods')
      .insert(payload)
      .select()
      .single();

    if (error) throw error;
    res.status(201).json(data);
  } catch (err) {
    console.error('POST /api/custom-foods error:', err);
    const status = err.code === '23505' ? 409 : 500;
    res.status(status).json({ error: err.message || 'Failed to create custom food' });
  }
});

router.put('/:id', auth, async (req, res) => {
  try {
    const parsed = parseBody(customFoodUpdateSchema, req.body);
    if (parsed.error) return res.status(400).json({ error: parsed.error });

    const payload = toDbPayload(parsed.data, req.user.id);
    delete payload.user_id;
    if (parsed.data.name === undefined) delete payload.normalized_name;
    if (payload.calories_per_serving === undefined) delete payload.calories_per_serving;
    if (parsed.data.serving_description === undefined && (parsed.data.serving_size === undefined || parsed.data.serving_unit === undefined)) {
      delete payload.serving_description;
    }

    const { data, error } = await supabase
      .from('user_custom_foods')
      .update(payload)
      .eq('id', req.params.id)
      .eq('user_id', req.user.id)
      .select()
      .maybeSingle();

    if (error) throw error;
    if (!data) return res.status(404).json({ error: 'Custom food not found' });
    res.json(data);
  } catch (err) {
    console.error('PUT /api/custom-foods/:id error:', err);
    const status = err.code === '23505' ? 409 : 500;
    res.status(status).json({ error: err.message || 'Failed to update custom food' });
  }
});

router.delete('/:id', auth, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('user_custom_foods')
      .delete()
      .eq('id', req.params.id)
      .eq('user_id', req.user.id)
      .select('id')
      .maybeSingle();

    if (error) throw error;
    if (!data) return res.status(404).json({ error: 'Custom food not found' });
    res.json({ success: true, id: data.id });
  } catch (err) {
    console.error('DELETE /api/custom-foods/:id error:', err);
    res.status(500).json({ error: err.message || 'Failed to delete custom food' });
  }
});

module.exports = router;
