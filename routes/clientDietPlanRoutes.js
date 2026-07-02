const express = require('express');
const { createClient } = require('@supabase/supabase-js');

const router = express.Router();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

async function auth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Missing auth token' });

  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data?.user) return res.status(401).json({ error: 'Invalid auth token' });

  req.user = data.user;
  next();
}

// PATCH /api/client-diet-plans/:planId — trainer edits a generated plan
router.patch('/:planId', auth, async (req, res) => {
  try {
    const { data: existing, error: fetchErr } = await supabase
      .from('client_diet_plans')
      .select('id, trainer_id')
      .eq('id', req.params.planId)
      .maybeSingle();
    if (fetchErr) throw fetchErr;
    if (!existing || existing.trainer_id !== req.user.id) {
      return res.status(404).json({ error: 'Not found' });
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
