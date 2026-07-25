const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const {
  insertTemplateDays,
  insertAssignedDays,
  fetchFullTemplate,
  fetchFullAssignedPlan,
} = require('../src/utils/dietPlanHelpers');
const { validateDietPlanTarget } = require('../src/utils/nutritionTargetValidator');
const { auth } = require('../middleware/auth');

const router = express.Router();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

function invalidTargetResponse(res, target) {
  const validation = validateDietPlanTarget(target);
  if (validation.valid) return false;
  res.status(validation.status || 400).json({ error: validation.error, invalid_fields: validation.invalidFields });
  return true;
}

function hasInvalidDayTarget(days) {
  return (days || []).find(day => !validateDietPlanTarget(day).valid);
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
    if (invalidTargetResponse(res, { calories_target, protein_g, carbs_g, fat_g })) return;
    const invalidDay = hasInvalidDayTarget(days);
    if (invalidDay) return invalidTargetResponse(res, invalidDay);

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
    await supabase.from('diet_template_versions').insert({
      template_id: template.id, version: 1, snapshot: full, created_by: req.user.id,
    });
    res.status(201).json(full);
  } catch (err) {
    console.error('POST /api/diet-plans/templates error:', err);
    res.status(500).json({ error: err.message });
  }
});

// Additive lifecycle endpoints. Existing template GET/PUT/DELETE contracts are
// intentionally untouched for current clients.
router.post('/templates/:id/duplicate', auth, async (req, res) => {
  try {
    const source = await fetchFullTemplate(supabase, req.params.id);
    if (!source || source.trainer_id !== req.user.id) return res.status(404).json({ error: 'Not found' });
    const { data: copy, error } = await supabase.from('diet_plan_templates').insert({
      trainer_id: req.user.id, name: req.body.name?.trim() || `${source.name} copy`,
      description: source.description, detail_level: source.detail_level,
      calories_target: source.calories_target, protein_g: source.protein_g, carbs_g: source.carbs_g,
      fat_g: source.fat_g, target_ranges: source.target_ranges || {}, status: 'draft', version: 1,
    }).select().single();
    if (error) throw error;
    await insertTemplateDays(supabase, copy.id, source.days);
    res.status(201).json(await fetchFullTemplate(supabase, copy.id));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.patch('/templates/:id/lifecycle', auth, async (req, res) => {
  try {
    const status = req.body.status;
    if (!['draft', 'published', 'archived'].includes(status)) return res.status(400).json({ error: 'Invalid template status' });
    const { data, error } = await supabase.from('diet_plan_templates').update({
      status, archived_at: status === 'archived' ? new Date().toISOString() : null, updated_at: new Date().toISOString(),
    }).eq('id', req.params.id).eq('trainer_id', req.user.id).select().maybeSingle();
    if (error) throw error;
    if (!data) return res.status(404).json({ error: 'Not found' });
    res.json(data);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/templates/:id/versions', auth, async (req, res) => {
  try {
    const template = await fetchFullTemplate(supabase, req.params.id);
    if (!template || template.trainer_id !== req.user.id) return res.status(404).json({ error: 'Not found' });
    const { data, error } = await supabase.from('diet_template_versions').select('*')
      .eq('template_id', template.id).order('version', { ascending: false });
    if (error) throw error;
    res.json(data || []);
  } catch (err) { res.status(500).json({ error: err.message }); }
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
    if (invalidTargetResponse(res, { calories_target, protein_g, carbs_g, fat_g })) return;
    const invalidDay = hasInvalidDayTarget(days);
    if (invalidDay) return invalidTargetResponse(res, invalidDay);

    // Verify ownership
    const { data: existing, error: fetchErr } = await supabase
      .from('diet_plan_templates')
      .select('id, trainer_id, version')
      .eq('id', req.params.id)
      .single();
    if (fetchErr || !existing || existing.trainer_id !== req.user.id) {
      return res.status(404).json({ error: 'Not found' });
    }

    const nextVersion = (Number(existing.version) || 1) + 1;
    const { error: updateErr } = await supabase
      .from('diet_plan_templates')
      .update({ name, description, detail_level, calories_target, protein_g, carbs_g, fat_g, version: nextVersion, updated_at: new Date().toISOString() })
      .eq('id', req.params.id);
    if (updateErr) throw updateErr;

    // Delete existing days (cascades to meals + foods)
    await supabase.from('diet_plan_days').delete().eq('template_id', req.params.id);

    // Re-insert days
    await insertTemplateDays(supabase, req.params.id, days);

    const full = await fetchFullTemplate(supabase, req.params.id);
    await supabase.from('diet_template_versions').insert({
      template_id: full.id, version: nextVersion, snapshot: full, created_by: req.user.id,
    });
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
    if (invalidTargetResponse(res, body)) return;
    const invalidDay = hasInvalidDayTarget(body.days);
    if (invalidDay) return invalidTargetResponse(res, invalidDay);

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
      if (!template || template.trainer_id !== req.user.id) {
        return res.status(404).json({ error: 'Template not found' });
      }
      days = template.days;
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
