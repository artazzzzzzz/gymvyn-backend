const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const { auth } = require('../middleware/auth');
const { ownerOnly, gymIdFromParams } = require('../middleware/ownerScope');

const router = express.Router({ mergeParams: true });

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

// ── Middleware ────────────────────────────────────────────────────────────────

async function withProfile(req, res, next) {
  const { data, error } = await supabase
    .from('users')
    .select('role, gym_id')
    .eq('id', req.user.id)
    .maybeSingle();

  if (error) return res.status(500).json({ error: 'Failed to load user profile' });
  if (!data)  return res.status(401).json({ error: 'User profile not found' });

  req.profile = data;
  next();
}

const MW = [auth, withProfile, ownerOnly(gymIdFromParams)];

// ── GET /api/equipment/:gymId ─────────────────────────────────────────────────

router.get('/:gymId', ...MW, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('gym_equipment')
      .select('*')
      .eq('gym_id', req.gymId)
      .order('category', { ascending: true })
      .order('name',     { ascending: true });

    if (error) throw error;
    res.json(data);
  } catch (err) {
    console.error('GET /api/equipment/:gymId error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/equipment/:gymId ────────────────────────────────────────────────

router.post('/:gymId', ...MW, async (req, res) => {
  try {
    const {
      name, category, quantity,
      purchase_date, last_serviced, next_service_due, condition,
    } = req.body;

    if (!name?.trim())     return res.status(400).json({ error: 'name is required' });
    if (!category?.trim()) return res.status(400).json({ error: 'category is required' });

    const { data, error } = await supabase
      .from('gym_equipment')
      .insert({
        gym_id:           req.gymId,
        name:             name.trim(),
        category:         category.trim(),
        quantity:         quantity ?? null,
        purchase_date:    purchase_date    ?? null,
        last_serviced:    last_serviced    ?? null,
        next_service_due: next_service_due ?? null,
        condition:        condition        ?? null,
      })
      .select()
      .single();

    if (error) throw error;
    res.status(201).json(data);
  } catch (err) {
    console.error('POST /api/equipment/:gymId error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ── PATCH /api/equipment/:gymId/:id ──────────────────────────────────────────

router.patch('/:gymId/:id', ...MW, async (req, res) => {
  try {
    const { id } = req.params;

    const { data: existing, error: fetchErr } = await supabase
      .from('gym_equipment')
      .select('id')
      .eq('id', id)
      .eq('gym_id', req.gymId)
      .maybeSingle();

    if (fetchErr) throw fetchErr;
    if (!existing) return res.status(404).json({ error: 'Equipment item not found in your gym' });

    const allowed = [
      'name', 'category', 'quantity',
      'purchase_date', 'last_serviced', 'next_service_due', 'condition',
    ];
    const updates = {};
    for (const field of allowed) {
      if (req.body[field] !== undefined) updates[field] = req.body[field];
    }

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ error: 'No valid fields to update' });
    }

    const { data, error } = await supabase
      .from('gym_equipment')
      .update(updates)
      .eq('id', id)
      .eq('gym_id', req.gymId)
      .select()
      .single();

    if (error) throw error;
    res.json(data);
  } catch (err) {
    console.error('PATCH /api/equipment/:gymId/:id error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ── DELETE /api/equipment/:gymId/:id ─────────────────────────────────────────

router.delete('/:gymId/:id', ...MW, async (req, res) => {
  try {
    const { id } = req.params;

    const { data: existing, error: fetchErr } = await supabase
      .from('gym_equipment')
      .select('id')
      .eq('id', id)
      .eq('gym_id', req.gymId)
      .maybeSingle();

    if (fetchErr) throw fetchErr;
    if (!existing) return res.status(404).json({ error: 'Equipment item not found in your gym' });

    const { error } = await supabase
      .from('gym_equipment')
      .delete()
      .eq('id', id)
      .eq('gym_id', req.gymId);

    if (error) throw error;
    res.json({ success: true });
  } catch (err) {
    console.error('DELETE /api/equipment/:gymId/:id error:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
