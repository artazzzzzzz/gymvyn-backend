const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const { auth } = require('../middleware/auth');

const router = express.Router();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const MEASUREMENT_COLS = [
  'chest_cm', 'waist_cm', 'hips_cm',
  'left_arm_cm', 'right_arm_cm',
  'left_thigh_cm', 'right_thigh_cm',
  'neck_cm',
];

// GET /api/measurements/latest — must be before /:id route
router.get('/latest', auth, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('body_measurements')
      .select('*')
      .eq('user_id', req.user.id)
      .order('measured_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) throw error;
    res.json(data ?? null);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/measurements
router.get('/', auth, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('body_measurements')
      .select('*')
      .eq('user_id', req.user.id)
      .order('measured_at', { ascending: false });

    if (error) throw error;
    res.json(data ?? []);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/measurements
router.post('/', auth, async (req, res) => {
  try {
    const { measured_at, notes, ...rest } = req.body;

    const measurementValues = {};
    for (const col of MEASUREMENT_COLS) {
      if (rest[col] != null && rest[col] !== '') {
        const val = parseFloat(rest[col]);
        if (!isNaN(val)) measurementValues[col] = val;
      }
    }

    const payload = {
      user_id: req.user.id,
      measured_at: measured_at || new Date().toISOString().slice(0, 10),
      ...measurementValues,
      ...(notes != null ? { notes } : {}),
    };

    const { data, error } = await supabase
      .from('body_measurements')
      .upsert(payload, { onConflict: 'user_id,measured_at' })
      .select()
      .single();

    if (error) throw error;
    res.status(201).json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/measurements/:id
router.patch('/:id', auth, async (req, res) => {
  try {
    const { id } = req.params;

    // Verify ownership
    const { data: existing } = await supabase
      .from('body_measurements')
      .select('id')
      .eq('id', id)
      .eq('user_id', req.user.id)
      .maybeSingle();

    if (!existing) return res.status(404).json({ error: 'Measurement not found' });

    const updates = {};
    const { measured_at, notes, ...rest } = req.body;

    if (measured_at != null) updates.measured_at = measured_at;
    if (notes != null) updates.notes = notes;

    for (const col of MEASUREMENT_COLS) {
      if (rest[col] != null) {
        updates[col] = rest[col] === '' ? null : parseFloat(rest[col]);
      }
    }

    const { data, error } = await supabase
      .from('body_measurements')
      .update(updates)
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/measurements/:id
router.delete('/:id', auth, async (req, res) => {
  try {
    const { id } = req.params;

    const { data: existing } = await supabase
      .from('body_measurements')
      .select('id')
      .eq('id', id)
      .eq('user_id', req.user.id)
      .maybeSingle();

    if (!existing) return res.status(404).json({ error: 'Measurement not found' });

    const { error } = await supabase
      .from('body_measurements')
      .delete()
      .eq('id', id);

    if (error) throw error;
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
