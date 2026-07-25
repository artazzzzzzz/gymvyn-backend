const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const { getActiveTrainerClientLink } = require('../src/utils/relationshipAuth');
const { auth } = require('../middleware/auth');

const router = express.Router();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

// PATCH /api/client-diet-plans/:planId — trainer edits a generated plan
router.patch('/:planId', auth, async (req, res) => {
  try {
    const { data: existing, error: fetchErr } = await supabase
      .from('client_diet_plans')
      .select('id, trainer_id, client_user_id')
      .eq('id', req.params.planId)
      .maybeSingle();
    if (fetchErr) throw fetchErr;
    if (!existing || existing.trainer_id !== req.user.id) {
      return res.status(404).json({ error: 'Not found' });
    }

    const activeLink = await getActiveTrainerClientLink(
      supabase,
      req.user.id,
      existing.client_user_id
    );
    if (!activeLink) {
      return res.status(403).json({ error: 'NOT_AUTHORIZED', message: 'You are not linked to this client.' });
    }

    const { name, description, plan_data, is_active } = req.body;
    const updates = {};
    if (name !== undefined) updates.name = name;
    if (description !== undefined) updates.description = description;
    if (plan_data !== undefined) updates.plan_data = plan_data;
    if (is_active !== undefined) updates.is_active = is_active;

    const { data: updated, error: updateErr } = await supabase
      .from('client_diet_plans')
      .update(updates)
      .eq('id', req.params.planId)
      .select()
      .single();
    if (updateErr) throw updateErr;

    res.json(updated);
  } catch (err) {
    console.error('PATCH /api/client-diet-plans/:planId error:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
