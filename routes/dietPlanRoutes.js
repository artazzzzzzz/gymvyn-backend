const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const {
  insertTemplateDays,
  insertAssignedDays,
  fetchFullTemplate,
  fetchFullAssignedPlan,
} = require('../src/utils/dietPlanHelpers');

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

// GET /api/diet-plans/templates — trainer's own templates
router.get('/templates', auth, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('diet_plan_templates')
      .select('*')
      .eq('trainer_id', req.user.id)
      .order('created_at', { ascending: false });
    if (error) throw error;
    res.json(data);
  } catch (err) {
    console.error('GET /api/diet-plans/templates error:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/diet-plans/templates — create a template
router.post('/templates', auth, async (req, res) => {
  try {
    const { name, description, detail_level, calories_target, protein_g, carbs_g, fat_g, days } = req.body;

    const { data: template, error } = await supabase
      .from('diet_plan_templates')
      .insert({
        trainer_id: req.user.id,
        name,
        description,
        detail_level,
        calories_target,
        protein_g,
        carbs_g,
        fat_g,
      })
      .select()
      .single();
    if (error) throw error;

    await insertTemplateDays(supabase, template.id, days);
    const full = await fetchFullTemplate(supabase, template.id);
    res.status(201).json(full);
  } catch (err) {
    console.error('POST /api/diet-plans/templates error:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/diet-plans/templates/:id — fetch full template
router.get('/templates/:id', auth, async (req, res) => {
  try {
    const full = await fetchFullTemplate(supabase, req.params.id);
    if (!full || full.trainer_id !== req.user.id) {
      return res.status(404).json({ error: 'Not found' });
    }
    res.json(full);
  } catch (err) {
    console.error('GET /api/diet-plans/templates/:id error:', err);
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/diet-plans/templates/:id — replace template (top-level + days)
router.put('/templates/:id', auth, async (req, res) => {
  try {
    const { name, description, detail_level, calories_target, protein_g, carbs_g, fat_g, days } = req.body;

    // Verify ownership
    const { data: existing, error: fetchErr } = await supabase
      .from('diet_plan_templates')
      .select('id, trainer_id')
      .eq('id', req.params.id)
      .single();
    if (fetchErr || !existing || existing.trainer_id !== req.user.id) {
      return res.status(404).json({ error: 'Not found' });
    }

    const { error: updateErr } = await supabase
      .from('diet_plan_templates')
      .update({ name, description, detail_level, calories_target, protein_g, carbs_g, fat_g, updated_at: new Date().toISOString() })
      .eq('id', req.params.id);
    if (updateErr) throw updateErr;

    // Delete existing days (cascades to meals + foods)
    await supabase.from('diet_plan_days').delete().eq('template_id', req.params.id);

    // Re-insert days
    await insertTemplateDays(supabase, req.params.id, days);

    const full = await fetchFullTemplate(supabase, req.params.id);
    res.json(full);
  } catch (err) {
    console.error('PUT /api/diet-plans/templates/:id error:', err);
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/diet-plans/templates/:id — delete template
router.delete('/templates/:id', auth, async (req, res) => {
  try {
    const { error } = await supabase
      .from('diet_plan_templates')
      .delete()
      .eq('id', req.params.id)
      .eq('trainer_id', req.user.id);
    if (error) throw error;
    res.json({ success: true });
  } catch (err) {
    console.error('DELETE /api/diet-plans/templates/:id error:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/diet-plans/assign — assign a plan to a client
router.post('/assign', auth, async (req, res) => {
  try {
    const body = req.body;

    // Verify client is a CURRENTLY active client of this trainer — a stale
    // 'removed' row from a client who unlinked must not authorize this.
    const { data: clientRow, error: clientErr } = await supabase
      .from('trainer_clients')
      .select('id')
      .eq('trainer_id', req.user.id)
      .eq('client_id', body.client_id)
      .eq('status', 'active')
      .maybeSingle();
    if (clientErr || !clientRow) {
      return res.status(403).json({ error: 'Not your client' });
    }

    // Deactivate any existing active plan for this client from this trainer
    await supabase
      .from('assigned_diet_plans')
      .update({ is_active: false })
      .eq('trainer_id', req.user.id)
      .eq('client_id', body.client_id)
      .eq('is_active', true);

    // If template_id provided, pull days from it
    let days = body.days || [];
    if (body.template_id) {
      const template = await fetchFullTemplate(supabase, body.template_id);
      if (template) {
        days = template.days;
      }
    }

    // Insert assigned plan
    const { data: assigned, error: assignErr } = await supabase
      .from('assigned_diet_plans')
      .insert({
        template_id: body.template_id || null,
        trainer_id: req.user.id,
        client_id: body.client_id,
        detail_level: body.detail_level,
        name: body.name,
        calories_target: body.calories_target,
        protein_g: body.protein_g,
        carbs_g: body.carbs_g,
        fat_g: body.fat_g,
        notes: body.notes,
        is_active: true,
      })
      .select()
      .single();
    if (assignErr) throw assignErr;

    await insertAssignedDays(supabase, assigned.id, days);

    const full = await fetchFullAssignedPlan(supabase, assigned.id);
    res.status(201).json(full);
  } catch (err) {
    console.error('POST /api/diet-plans/assign error:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/diet-plans/assigned/:clientId — trainer fetches active plan for a client
router.get('/assigned/:clientId', auth, async (req, res) => {
  try {
    const { data: plan, error } = await supabase
      .from('assigned_diet_plans')
      .select('*')
      .eq('trainer_id', req.user.id)
      .eq('client_id', req.params.clientId)
      .eq('is_active', true)
      .single();

    if (error && error.code !== 'PGRST116') throw error;
    if (!plan) return res.json(null);

    const full = await fetchFullAssignedPlan(supabase, plan.id);
    res.json(full);
  } catch (err) {
    console.error('GET /api/diet-plans/assigned/:clientId error:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/diet-plans/my-plan — client fetches their own active plan
router.get('/my-plan', auth, async (req, res) => {
  try {
    const { data: plan, error } = await supabase
      .from('assigned_diet_plans')
      .select('*')
      .eq('client_id', req.user.id)
      .eq('is_active', true)
      .order('assigned_at', { ascending: false })
      .limit(1)
      .single();

    if (error && error.code !== 'PGRST116') throw error;
    if (!plan) return res.json(null);

    const full = await fetchFullAssignedPlan(supabase, plan.id);

    // Attach trainer name
    if (full && full.trainer_id) {
      const { data: trainer } = await supabase
        .from('users')
        .select('full_name')
        .eq('id', full.trainer_id)
        .single();
      full.trainer_name = trainer?.full_name || 'Your Trainer';
    }

    res.json(full);
  } catch (err) {
    console.error('GET /api/diet-plans/my-plan error:', err);
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/diet-plans/assigned/:assignedPlanId — trainer deactivates a plan
router.delete('/assigned/:assignedPlanId', auth, async (req, res) => {
  try {
    const { error } = await supabase
      .from('assigned_diet_plans')
      .update({ is_active: false })
      .eq('id', req.params.assignedPlanId)
      .eq('trainer_id', req.user.id);
    if (error) throw error;
    res.json({ success: true });
  } catch (err) {
    console.error('DELETE /api/diet-plans/assigned/:assignedPlanId error:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
