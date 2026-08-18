const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const cloudinary = require('cloudinary').v2;
const multer = require('multer');
const { auth } = require('../middleware/auth');
const { getOrCreateConversationIfAllowed } = require('../src/utils/canMessage');
const { sendMessageAtomically } = require('../src/services/chatService');
const {
  ACTIVE_RELATIONSHIP_STATUSES,
  getActiveTrainerClientLink,
  getCurrentTrainerClientLinkForClient,
  deactivateOtherTrainerClientLinks,
  deactivateAllTrainerClientLinks,
} = require('../src/utils/relationshipAuth');

const router = express.Router();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key:    process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

const photoUpload = multer({ storage: multer.memoryStorage() });

// Checks for an active trainer_clients row linking the two ids in this
// exact direction (trainerId is the trainer, clientId is the client).
async function isLinkedPair(trainerId, clientId) {
  return !!(await getActiveTrainerClientLink(supabase, trainerId, clientId));
}

// ──────────────────────────────────────────
// TRAINER ONBOARDING & PROFILE
// ──────────────────────────────────────────

// POST /api/trainer/onboard — become a trainer (from consumer or new)
router.post('/onboard', auth, async (req, res) => {
  try {
    const {
      userId, bio, specializations, experienceYears,
      hourlyRate, isIndependent, phone, city, gymId,
      pricing_models, hourly_rate, monthly_rate, session_rate
    } = req.body;

    if (!userId) return res.status(400).json({ error: 'userId required' });
    if (req.user.id !== userId) return res.status(403).json({ error: 'Not authorized' });

    // Pricing is optional at onboarding (trainer may skip and set it later
    // from Trainer Settings). Only persist a rate for a model the trainer
    // actually selected, so an empty/zero input on an unselected model can't
    // leak into the saved profile.
    const selectedModels = Array.isArray(pricing_models) ? pricing_models : [];
    const toRate = (v) => {
      const n = Number(v);
      return Number.isFinite(n) && n > 0 ? n : null;
    };

    // Generate unique invite code
    const { data: codeData } = await supabase.rpc('generate_invite_code');
    const inviteCode = codeData || Math.random().toString(36).substring(2, 8).toUpperCase();

    // Upsert trainer_profiles
    const { data: profile, error: profileErr } = await supabase
      .from('trainer_profiles')
      .upsert({
        user_id: userId,
        bio: bio || '',
        specializations: specializations || [],
        experience_years: experienceYears || 0,
        // hourly_rate stays the canonical column existing readers rely on
        // (MyTrainer, TrainerSettings, etc.) — kept in sync whenever
        // 'hourly' is one of the selected pricing models.
        hourly_rate: selectedModels.includes('hourly') ? toRate(hourly_rate ?? hourlyRate) : null,
        monthly_rate: selectedModels.includes('monthly') ? toRate(monthly_rate) : null,
        session_rate: selectedModels.includes('session') ? toRate(session_rate) : null,
        pricing_models: selectedModels,
        is_independent: isIndependent !== false,
        phone: phone || null,
        city: city || null,
        gym_id: isIndependent ? null : (gymId || null),
        invite_code: inviteCode,
        is_accepting_clients: true,
        updated_at: new Date().toISOString()
      }, { onConflict: 'user_id' })
      .select()
      .single();

    if (profileErr) throw profileErr;

    // Update user role to 'trainer'
    const { error: roleErr } = await supabase
      .from('users')
      .update({ role: 'trainer' })
      .eq('id', userId);

    if (roleErr) throw roleErr;

    res.json({ success: true, profile });
  } catch (err) {
    console.error('Trainer onboard error:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/trainer/profile/:userId
router.get('/profile/:userId', auth, async (req, res) => {
  try {
    const { userId } = req.params;
    if (req.user.id !== userId) {
      const linked = (await isLinkedPair(req.user.id, userId)) || (await isLinkedPair(userId, req.user.id));
      if (!linked) return res.status(403).json({ error: 'Not authorized' });
    }

    const { data, error } = await supabase
      .from('trainer_profiles')
      .select('*, users!inner(full_name, goal, experience)')
      .eq('user_id', userId)
      .single();

    if (error) throw error;
    res.json(data);
  } catch (err) {
    res.status(404).json({ error: 'Trainer profile not found' });
  }
});

// PATCH /api/trainer/profile/:userId — update profile
router.patch('/profile/:userId', auth, async (req, res) => {
  try {
    if (req.user.id !== req.params.userId) {
      return res.status(403).json({ error: 'Not authorized' });
    }

    const updates = { ...req.body, updated_at: new Date().toISOString() };
    delete updates.user_id; // prevent overwriting FK
    delete updates.invite_code; // prevent code tampering

    const { data, error } = await supabase
      .from('trainer_profiles')
      .update(updates)
      .eq('user_id', req.params.userId)
      .select()
      .single();

    if (error) throw error;
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/trainer/profile/:userId/photo — upload trainer avatar
router.post('/profile/:userId/photo', auth, photoUpload.single('photo'), async (req, res) => {
  try {
    const { userId } = req.params;
    if (req.user.id !== userId) {
      return res.status(403).json({ error: 'Not authorized' });
    }
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const result = await new Promise((resolve, reject) => {
      cloudinary.uploader.upload_stream(
        {
          folder:         'gymvyn/trainers',
          public_id:      `trainer-avatar-${userId}`,
          overwrite:      true,
          transformation: [{ width: 400, height: 400, crop: 'fill', gravity: 'center' }],
        },
        (error, result) => { if (error) reject(error); else resolve(result); }
      ).end(req.file.buffer);
    });

    const { error: dbErr } = await supabase
      .from('trainer_profiles')
      .update({ profile_photo_url: result.secure_url })
      .eq('user_id', userId);

    if (dbErr) throw dbErr;

    res.json({ photo_url: result.secure_url });
  } catch (err) {
    console.error('POST /api/trainer/profile/:userId/photo error:', err);
    res.status(500).json({ error: 'Upload failed' });
  }
});

// ──────────────────────────────────────────
// CLIENT MANAGEMENT
// ──────────────────────────────────────────

// GET /api/trainer/clients/:trainerId — list all clients
router.get('/clients/:trainerId', auth, async (req, res) => {
  try {
    if (req.user.id !== req.params.trainerId) {
      return res.status(403).json({ error: 'Not authorized' });
    }

    const { data, error } = await supabase
      .from('trainer_clients')
      .select(`
        *,
        client:users!trainer_clients_client_id_fkey(
          id, full_name, goal, experience, current_weight,
          target_weight, age, gender, created_at
        )
      `)
      .eq('trainer_id', req.params.trainerId)
      .in('status', ['active', 'pending'])
      .order('created_at', { ascending: false });

    if (error) throw error;

    // For each active client, get their latest stats
    const enriched = await Promise.all((data || []).map(async (rel) => {
      if (!rel.client_id || rel.status !== 'active') return rel;

      // Last workout
      const { data: lastWorkout } = await supabase
        .from('workout_logs')
        .select('completed_at, duration_minutes')
        .eq('user_id', rel.client_id)
        .not('completed_at', 'is', null)
        .order('completed_at', { ascending: false })
        .limit(1)
        .single();

      // Workout count (last 7 days)
      const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString();
      const { count: weeklyWorkouts } = await supabase
        .from('workout_logs')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', rel.client_id)
        .not('completed_at', 'is', null)
        .gte('completed_at', weekAgo);

      // Active assigned plan count
      const { count: activePlans } = await supabase
        .from('assigned_plans')
        .select('*', { count: 'exact', head: true })
        .eq('client_id', rel.client_id)
        .eq('trainer_id', req.params.trainerId)
        .eq('status', 'active');

      return {
        ...rel,
        stats: {
          lastWorkout: lastWorkout?.completed_at || null,
          lastWorkoutDuration: lastWorkout?.duration_minutes || null,
          weeklyWorkouts: weeklyWorkouts || 0,
          activePlans: activePlans || 0
        }
      };
    }));

    res.json(enriched);
  } catch (err) {
    console.error('Get clients error:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/trainer/my-trainer/:clientId — client gets their trainer info
router.get('/my-trainer/:clientId', auth, async (req, res) => {
  try {
    const { clientId } = req.params;
    const selfAccess = req.user.id === clientId;
    const activeLink = selfAccess
      ? await getCurrentTrainerClientLinkForClient(supabase, clientId)
      : await getActiveTrainerClientLink(supabase, req.user.id, clientId);

    if (!selfAccess && !activeLink) return res.status(403).json({ error: 'Not authorized' });
    if (selfAccess && !activeLink) return res.json(null);

    let relQuery = supabase
      .from('trainer_clients')
      .select(`
        *,
        trainer:users!trainer_clients_trainer_id_fkey(
          id, full_name
        )
      `)
      .eq('id', activeLink.id)
      .in('status', ACTIVE_RELATIONSHIP_STATUSES);

    const { data: rel, error } = await relQuery.single();

    if (error && error.code !== 'PGRST116') throw error;
    if (!rel) return res.json(null);

    // Fetch trainer profile separately
    const { data: trainerProfile } = await supabase
      .from('trainer_profiles')
      .select('bio, specializations, experience_years, profile_photo_url, is_independent, city')
      .eq('user_id', rel.trainer_id)
      .single();

    res.json({ ...rel, trainer_profile: trainerProfile || null });
  } catch (err) {
    console.error('My trainer error:', err);
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/trainer/client/:relationshipId — update status (pause, remove)
router.patch('/client/:relationshipId', auth, async (req, res) => {
  try {
    const { relationshipId } = req.params;

    const { data: existingRel, error: fetchErr } = await supabase
      .from('trainer_clients')
      .select('id, trainer_id')
      .eq('id', relationshipId)
      .single();

    if (fetchErr || !existingRel) return res.status(404).json({ error: 'Relationship not found' });
    if (existingRel.trainer_id !== req.user.id) {
      return res.status(403).json({ error: 'Not authorized' });
    }

    const { status, notes } = req.body;
    const { data, error } = await supabase
      .from('trainer_clients')
      .update({
        status,
        notes: notes || undefined,
        updated_at: new Date().toISOString()
      })
      .eq('id', relationshipId)
      .select()
      .single();

    if (error) throw error;
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ──────────────────────────────────────────
// TEMPLATES (reusable workout/diet templates)
// ──────────────────────────────────────────

// POST /api/trainer/templates — create template
router.post('/templates', auth, async (req, res) => {
  try {
    const { trainerId, type, name, description, templateData, tags } = req.body;
    if (!trainerId || !type || !name) {
      return res.status(400).json({ error: 'trainerId, type, name required' });
    }
    if (req.user.id !== trainerId) return res.status(403).json({ error: 'Not authorized' });

    const { data, error } = await supabase
      .from('trainer_templates')
      .insert({
        trainer_id: trainerId,
        type,
        name,
        description: description || '',
        template_data: templateData || {},
        tags: tags || []
      })
      .select()
      .single();

    if (error) throw error;
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/trainer/templates/:trainerId?type=workout
router.get('/templates/:trainerId', auth, async (req, res) => {
  try {
    if (req.user.id !== req.params.trainerId) {
      return res.status(403).json({ error: 'Not authorized' });
    }

    let query = supabase
      .from('trainer_templates')
      .select('*')
      .eq('trainer_id', req.params.trainerId)
      .order('updated_at', { ascending: false });

    if (req.query.type) query = query.eq('type', req.query.type);

    const { data, error } = await query;
    if (error) throw error;
    res.json(data || []);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/trainer/templates/:templateId
router.patch('/templates/:templateId', auth, async (req, res) => {
  try {
    const { templateId } = req.params;

    const { data: existingTemplate, error: fetchErr } = await supabase
      .from('trainer_templates')
      .select('id, trainer_id')
      .eq('id', templateId)
      .single();

    if (fetchErr || !existingTemplate) return res.status(404).json({ error: 'Template not found' });
    if (existingTemplate.trainer_id !== req.user.id) {
      return res.status(403).json({ error: 'Not authorized' });
    }

    const updates = { ...req.body, updated_at: new Date().toISOString() };
    delete updates.trainer_id;

    const { data, error } = await supabase
      .from('trainer_templates')
      .update(updates)
      .eq('id', templateId)
      .select()
      .single();

    if (error) throw error;

    // Sync all active assigned_plans that use this template
    const { data: activePlans } = await supabase
      .from('assigned_plans')
      .select('id')
      .eq('template_id', templateId)
      .eq('status', 'active');

    if (activePlans?.length) {
      await supabase
        .from('assigned_plans')
        .update({
          plan_data: updates.template_data || updates.templateData,
          name: updates.name,
          updated_at: new Date().toISOString()
        })
        .eq('template_id', templateId)
        .eq('status', 'active');
    }

    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/trainer/templates/:templateId
router.delete('/templates/:templateId', auth, async (req, res) => {
  try {
    const { templateId } = req.params;

    const { data: existingTemplate, error: fetchErr } = await supabase
      .from('trainer_templates')
      .select('id, trainer_id')
      .eq('id', templateId)
      .single();

    if (fetchErr || !existingTemplate) return res.status(404).json({ error: 'Template not found' });
    if (existingTemplate.trainer_id !== req.user.id) {
      return res.status(403).json({ error: 'Not authorized' });
    }

    const { error } = await supabase
      .from('trainer_templates')
      .delete()
      .eq('id', templateId);

    if (error) throw error;
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ──────────────────────────────────────────
// ASSIGNED PLANS
// ──────────────────────────────────────────

// POST /api/trainer/assign-plan — assign a plan to client
router.post('/assign-plan', auth, async (req, res) => {
  try {
    const { trainerId, clientId, templateId, type, name, planData, notes, startsAt, endsAt } = req.body;
    if (!clientId || !type || !name) {
      return res.status(400).json({ error: 'clientId, type, name required' });
    }
    // The authenticated user is always the acting trainer. Keep the legacy
    // trainerId field as an optional anti-impersonation assertion, but never
    // trust it as the source of ownership.
    if (trainerId && req.user.id !== trainerId) return res.status(403).json({ error: 'Not authorized' });
    const actingTrainerId = req.user.id;

    const linked = await isLinkedPair(actingTrainerId, clientId);
    if (!linked) return res.status(403).json({ error: 'Not authorized' });

    // Deactivate any existing active plan of same type for this client from this trainer
    await supabase
      .from('assigned_plans')
      .update({ status: 'replaced', updated_at: new Date().toISOString() })
      .eq('trainer_id', actingTrainerId)
      .eq('client_id', clientId)
      .eq('type', type)
      .eq('status', 'active');

    const { data, error } = await supabase
      .from('assigned_plans')
      .insert({
        trainer_id: actingTrainerId,
        client_id: clientId,
        template_id: templateId || null,
        type,
        name,
        plan_data: planData || {},
        notes: notes || null,
        starts_at: startsAt || new Date().toISOString().split('T')[0],
        ends_at: endsAt || null
      })
      .select()
      .single();

    if (error) throw error;

    // Increment template times_assigned
    if (templateId) {
      await supabase.rpc('increment_template_assigned', { tid: templateId });
    }

    // Send system message in chat. This previously looked up the
    // conversation by trainer_id/client_id, columns that don't exist on
    // the real table (participant_1_id/participant_2_id) — the lookup's
    // error was never checked, so this whole block silently no-op'd.
    // trainer-client eligibility was already confirmed above via
    // isLinkedPair, so this always succeeds; the hardened conversation RPC is
    // idempotent if one already exists from the invite/accept flow.
    const convoId = await getOrCreateConversationIfAllowed(supabase, actingTrainerId, clientId);

    if (convoId) {
      await sendMessageAtomically(supabase, {
        conversationId: convoId,
        senderId: actingTrainerId,
        content: `Assigned new ${type} plan: ${name}`,
      });
    }

    res.json({
      assignment: data,
      assignmentId: data.id,
      clientId,
      trainerId: actingTrainerId,
      planId: data.template_id || null,
    });
  } catch (err) {
    console.error('Assign plan error:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/trainer/assigned-plans/:clientId — get client's assigned plans
router.get('/assigned-plans/:clientId', auth, async (req, res) => {
  try {
    const { clientId } = req.params;
    const selfAccess = req.user.id === clientId;
    const activeLink = selfAccess ? null : await getActiveTrainerClientLink(supabase, req.user.id, clientId);
    if (!selfAccess && !activeLink) return res.status(403).json({ error: 'Not authorized' });

    let query = supabase
      .from('assigned_plans')
      .select('*, trainer:users!assigned_plans_trainer_id_fkey(full_name)')
      .eq('client_id', clientId)
      .order('created_at', { ascending: false });

    if (!selfAccess) query = query.eq('trainer_id', req.user.id);

    if (req.query.status) query = query.eq('status', req.query.status);
    if (req.query.type) query = query.eq('type', req.query.type);

    const { data, error } = await query;
    if (error) throw error;
    res.json(data || []);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ──────────────────────────────────────────
// CLIENT PROGRESS (trainer reads client data)
// ──────────────────────────────────────────

// GET /api/trainer/client-progress/:trainerId/:clientId
router.get('/client-progress/:trainerId/:clientId', auth, async (req, res) => {
  try {
    const { trainerId, clientId } = req.params;
    if (req.user.id !== trainerId) {
      return res.status(403).json({ error: 'Not authorized' });
    }

    // Verify trainer-client relationship exists
    const { data: rel } = await supabase
      .from('trainer_clients')
      .select('id')
      .eq('trainer_id', trainerId)
      .eq('client_id', clientId)
      .eq('status', 'active')
      .single();

    if (!rel) {
      return res.status(403).json({ error: 'Not authorized to view this client' });
    }

    // Fetch client profile
    const { data: client } = await supabase
      .from('users')
      .select('*')
      .eq('id', clientId)
      .single();

    // Recent workout logs (last 30 days)
    const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000).toISOString();
    const { data: workoutLogs } = await supabase
      .from('workout_logs')
      .select('*')
      .eq('user_id', clientId)
      .gte('created_at', thirtyDaysAgo)
      .order('created_at', { ascending: false });

    // Recent food logs (last 7 days)
    const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString().split('T')[0];
    const { data: foodLogs } = await supabase
      .from('food_logs')
      .select('*')
      .eq('user_id', clientId)
      .gte('log_date', weekAgo)
      .order('log_date', { ascending: false });

    // Progress entries
    const { data: progressEntries } = await supabase
      .from('progress_entries')
      .select('*')
      .eq('user_id', clientId)
      .order('created_at', { ascending: false })
      .limit(10);

    // Authoritative starting/current weight — queried independently of the
    // capped progressEntries list above so the true oldest ("Starting
    // weight") entry isn't lost for clients with more than 10 logs.
    const { data: startingWeightEntry } = await supabase
      .from('progress_entries')
      .select('weight_kg, logged_at')
      .eq('user_id', clientId)
      .not('weight_kg', 'is', null)
      .order('logged_at', { ascending: true })
      .limit(1)
      .maybeSingle();

    const { data: latestWeightEntry } = await supabase
      .from('progress_entries')
      .select('weight_kg, logged_at')
      .eq('user_id', clientId)
      .not('weight_kg', 'is', null)
      .order('logged_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    // Progress photos (last 5)
    const { data: progressPhotos } = await supabase
      .from('progress_photos')
      .select('*')
      .eq('user_id', clientId)
      .order('created_at', { ascending: false })
      .limit(5);

    // Personal records
    const { data: prs } = await supabase
      .from('personal_records')
      .select('*')
      .eq('user_id', clientId)
      .order('achieved_at', { ascending: false })
      .limit(10);

    // Macros
    const { data: macros } = await supabase
      .from('user_macros')
      .select('*')
      .eq('user_id', clientId)
      .single();

    // Active assigned plans from this trainer
    const { data: assignedPlans } = await supabase
      .from('assigned_plans')
      .select('*')
      .eq('client_id', clientId)
      .eq('trainer_id', trainerId)
      .order('created_at', { ascending: false });

    res.json({
      client,
      macros,
      workoutLogs: workoutLogs || [],
      foodLogs: foodLogs || [],
      progressEntries: progressEntries || [],
      startingWeightEntry: startingWeightEntry || null,
      latestWeightEntry: latestWeightEntry || null,
      progressPhotos: progressPhotos || [],
      personalRecords: prs || [],
      assignedPlans: assignedPlans || []
    });
  } catch (err) {
    console.error('Client progress error:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/trainer/my-code — trainer gets their trainer_code
router.get('/my-code', auth, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('trainer_profiles')
      .select('id, trainer_code, invite_code, user_id')
      .eq('user_id', req.user.id)
      .maybeSingle();

    if (error) throw error;
    if (!data) return res.status(404).json({ error: 'Trainer profile not found' });

    if (!data.trainer_code) {
      // Reuse the legacy invite_code (from /api/trainer/onboard) if one already
      // exists, instead of minting a second, unrelated code for the same trainer.
      const code = data.invite_code || Math.random().toString(36).substring(2, 8).toUpperCase();
      await supabase.from('trainer_profiles').update({ trainer_code: code }).eq('user_id', req.user.id);
      data.trainer_code = code;
    }

    res.json({ trainer_code: data.trainer_code });
  } catch (err) {
    console.error('GET /api/trainer/my-code error:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/trainer/invite — trainer invites a client by phone or email
router.post('/invite', auth, async (req, res) => {
  try {
    const { identifier } = req.body;
    if (!identifier) return res.status(400).json({ error: 'identifier is required' });

    // trainer_id in trainer_clients = trainer's user_id
    const trainerId = req.user.id;

    // Verify caller has a trainer profile
    const { data: trainerProfile, error: tpErr } = await supabase
      .from('trainer_profiles')
      .select('id')
      .eq('user_id', trainerId)
      .maybeSingle();
    if (tpErr) throw tpErr;
    if (!trainerProfile) return res.status(404).json({ error: 'Trainer profile not found' });

    // Try to find user by phone first
    let foundUser = null;
    const { data: byPhone } = await supabase
      .from('users')
      .select('id, full_name')
      .eq('phone', identifier.trim())
      .maybeSingle();

    if (byPhone) {
      foundUser = byPhone;
    } else {
      // Try finding by email via auth.users
      const { data: authList } = await supabase.auth.admin.listUsers();
      const authUser = authList?.users?.find(u => u.email === identifier.trim());
      if (authUser) {
        const { data: profileUser } = await supabase
          .from('users')
          .select('id, full_name')
          .eq('id', authUser.id)
          .maybeSingle();
        if (profileUser) foundUser = profileUser;
      }
    }

    if (!foundUser) {
      return res.status(400).json({ error: 'No user found with that phone or email' });
    }

    // Check if relationship already exists
    const { data: existing } = await supabase
      .from('trainer_clients')
      .select('id, status')
      .eq('trainer_id', trainerId)
      .eq('client_id', foundUser.id)
      .maybeSingle();

    if (existing?.status === 'active') {
      return res.status(400).json({ error: 'Already your client' });
    }

    if (!existing) {
      // No prior relationship — create a new pending invite.
      const { error: insertErr } = await supabase
        .from('trainer_clients')
        .insert({ trainer_id: trainerId, client_id: foundUser.id, status: 'pending' });
      if (insertErr) throw insertErr;
    } else if (existing.status !== 'pending') {
      // Relationship exists but was previously removed/inactive — reset to pending
      // so the member sees the invite again in their JoinTrainerSheet.
      const { error: updateErr } = await supabase
        .from('trainer_clients')
        .update({ status: 'pending', started_at: null })
        .eq('id', existing.id);
      if (updateErr) throw updateErr;
    }
    // If existing.status === 'pending', the invite is already there — no-op, idempotent.

    res.json({ success: true, client_name: foundUser.full_name });
  } catch (err) {
    console.error('POST /api/trainer/invite error:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/trainer/join — consumer links to a trainer by code
router.post('/join', auth, async (req, res) => {
  try {
    const { trainer_code } = req.body;
    if (!trainer_code) return res.status(400).json({ error: 'trainer_code is required' });

    const normalizedCode = trainer_code.trim().toUpperCase();
    if (!/^[A-Z0-9]{4,10}$/.test(normalizedCode)) {
      return res.status(400).json({ error: 'Invalid trainer code' });
    }

    // Trainers onboarded via the legacy /api/trainer/onboard route only have
    // invite_code set (trainer_code is null until /api/trainer/my-code backfills
    // it), so a code shown on the trainer's dashboard can live in either column.
    const { data: tp, error: tpErr } = await supabase
      .from('trainer_profiles')
      .select('id, user_id')
      .or(`trainer_code.eq.${normalizedCode},invite_code.eq.${normalizedCode}`)
      .maybeSingle();

    if (tpErr) throw tpErr;
    if (!tp) return res.status(400).json({ error: 'Invalid trainer code' });

    // trainer_id in trainer_clients = trainer's user_id
    const trainerId = tp.user_id;

    const { data: existing } = await supabase
      .from('trainer_clients')
      .select('id, status')
      .eq('trainer_id', trainerId)
      .eq('client_id', req.user.id)
      .maybeSingle();

    if (existing && ACTIVE_RELATIONSHIP_STATUSES.includes(existing.status)) {
      return res.status(400).json({ error: 'Already linked to this trainer' });
    }

    await deactivateOtherTrainerClientLinks(supabase, req.user.id, trainerId);

    if (existing) {
      const { error: updErr } = await supabase
        .from('trainer_clients')
        .update({ status: 'active', started_at: new Date().toISOString(), updated_at: new Date().toISOString() })
        .eq('id', existing.id);
      if (updErr) throw updErr;
    } else {
      const { error: insertErr } = await supabase
        .from('trainer_clients')
        .insert({ trainer_id: trainerId, client_id: req.user.id, status: 'active' });
      if (insertErr) throw insertErr;
    }

    res.json({ success: true });
  } catch (err) {
    console.error('POST /api/trainer/join error:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/trainer/pending-invites — client gets pending trainer invites
router.get('/pending-invites', auth, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('trainer_clients')
      .select(`
        id,
        trainer_id,
        trainer:users!trainer_clients_trainer_id_fkey(id, full_name)
      `)
      .eq('client_id', req.user.id)
      .eq('status', 'pending');

    if (error) throw error;

    const invites = (data || []).map(row => ({
      id: row.id,
      trainer_id: row.trainer_id,
      trainer_name: row.trainer?.full_name || 'Unknown Trainer',
    }));

    res.json(invites);
  } catch (err) {
    console.error('GET /api/trainer/pending-invites error:', err);
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/trainer/accept-invite/:id — client accepts a pending invite
router.patch('/accept-invite/:id', auth, async (req, res) => {
  try {
    const { data: rel, error: relErr } = await supabase
      .from('trainer_clients')
      .select('id, trainer_id')
      .eq('id', req.params.id)
      .eq('client_id', req.user.id)
      .eq('status', 'pending')
      .maybeSingle();
    if (relErr) throw relErr;
    if (!rel) return res.status(404).json({ error: 'Invite not found' });

    await deactivateOtherTrainerClientLinks(supabase, req.user.id, rel.trainer_id);

    const { error } = await supabase
      .from('trainer_clients')
      .update({ status: 'active', started_at: new Date().toISOString() })
      .eq('id', req.params.id)
      .eq('client_id', req.user.id)
      .eq('status', 'pending');

    if (error) throw error;
    res.json({ success: true });
  } catch (err) {
    console.error('PATCH /api/trainer/accept-invite/:id error:', err);
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/trainer/decline-invite/:id — client declines a pending invite
router.delete('/decline-invite/:id', auth, async (req, res) => {
  try {
    const { error } = await supabase
      .from('trainer_clients')
      .delete()
      .eq('id', req.params.id)
      .eq('client_id', req.user.id);

    if (error) throw error;
    res.json({ success: true });
  } catch (err) {
    console.error('DELETE /api/trainer/decline-invite/:id error:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/trainer/my-trainer — authenticated consumer gets their linked trainer + active plan
router.get('/my-trainer', auth, async (req, res) => {
  try {
    const activeLink = await getCurrentTrainerClientLinkForClient(supabase, req.user.id);
    if (!activeLink) return res.status(404).json({ error: 'No trainer linked' });

    const { data: rel, error: relErr } = await supabase
      .from('trainer_clients')
      .select(`
        id, trainer_id,
        trainer:users!trainer_clients_trainer_id_fkey(id, full_name)
      `)
      .eq('id', activeLink.id)
      .in('status', ACTIVE_RELATIONSHIP_STATUSES)
      .maybeSingle();

    if (relErr) throw relErr;
    if (!rel) return res.status(404).json({ error: 'No trainer linked' });

    const { data: profile } = await supabase
      .from('trainer_profiles')
      .select('bio, specializations, experience_years, profile_photo_url, hourly_rate')
      .eq('user_id', rel.trainer_id)
      .maybeSingle();

    const { data: plans } = await supabase
      .from('assigned_plans')
      .select('id, type, name, notes, starts_at, plan_data, status')
      .eq('client_id', req.user.id)
      .eq('trainer_id', rel.trainer_id)
      .eq('status', 'active')
      .order('created_at', { ascending: false })
      .limit(1);

    // Real conversations schema is participant_1_id/participant_2_id. Match
    // the current active member/trainer pair exactly so an old conversation
    // with a previous trainer cannot leak into this response.
    const { data: convos } = await supabase
      .from('conversations')
      .select('id, last_message_preview, last_message_at, p1_unread, p2_unread, participant_1_id, participant_2_id')
      .or(`and(participant_1_id.eq.${req.user.id},participant_2_id.eq.${rel.trainer_id}),and(participant_1_id.eq.${rel.trainer_id},participant_2_id.eq.${req.user.id})`)
      .order('last_message_at', { ascending: false, nullsFirst: false })
      .limit(1);

    const convo = convos?.[0] || null;
    const conversation = convo ? {
      id: convo.id,
      last_message_preview: convo.last_message_preview,
      last_message_at: convo.last_message_at,
      client_unread: convo.participant_1_id === req.user.id ? convo.p1_unread : convo.p2_unread,
    } : null;

    res.json({
      trainer: {
        id: rel.trainer?.id || null,
        full_name: rel.trainer?.full_name || null,
        bio: profile?.bio || null,
        specializations: profile?.specializations || [],
        experience_years: profile?.experience_years || null,
        profile_photo_url: profile?.profile_photo_url || null,
        hourly_rate: profile?.hourly_rate || null,
      },
      plan: plans?.[0] ? {
        id: plans[0].id,
        type: plans[0].type,
        name: plans[0].name,
        notes: plans[0].notes,
        starts_at: plans[0].starts_at,
        plan_data: plans[0].plan_data,
      } : null,
      conversation,
    });
  } catch (err) {
    console.error('GET /api/trainer/my-trainer error:', err);
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/trainer/unlink — client leaves their current trainer (soft delete).
// Self-only: acts on the authenticated user's own client_id, never a
// param/body-supplied id. History (assigned plans, logs, progress) is
// untouched — only trainer_clients.status flips to 'removed' (same terminal
// status the trainer-initiated removal flow already uses).
router.patch('/unlink', auth, async (req, res) => {
  try {
    const clientId = req.user.id;

    const removedIds = await deactivateAllTrainerClientLinks(supabase, clientId);
    if (removedIds.length === 0) return res.status(404).json({ error: 'No active trainer found' });

    res.json({ success: true });
  } catch (err) {
    console.error('PATCH /api/trainer/unlink error:', err);
    res.status(500).json({ error: err.message || 'Failed to unlink trainer' });
  }
});

// ── Trainer-initiated "Join Gym by Code" ────────────────────────────────────
// Mirrors the trainer_clients pending/accept pattern above, but for
// trainer<->gym affiliation. Separate code (gyms.trainer_join_code) from the
// member join_code so the two flows can never cross-consume each other's
// code. gym_id is never set here — only pending_gym_id — the owner's accept
// endpoint (in gymRoutes.js) is what actually links the trainer to the gym.

// GET /api/trainer/gym-status — trainer's current + pending gym affiliation
router.get('/gym-status', auth, async (req, res) => {
  try {
    const { data: tp, error: tpErr } = await supabase
      .from('trainer_profiles')
      .select('gym_id, pending_gym_id')
      .eq('user_id', req.user.id)
      .maybeSingle();
    if (tpErr) throw tpErr;
    if (!tp) return res.json({ gym: null, pending_gym: null });

    const ids = [tp.gym_id, tp.pending_gym_id].filter(Boolean);
    let gymsById = new Map();
    if (ids.length > 0) {
      const { data: gyms, error: gymsErr } = await supabase
        .from('gyms')
        .select('id, name')
        .in('id', ids);
      if (gymsErr) throw gymsErr;
      gymsById = new Map((gyms || []).map(g => [g.id, g]));
    }

    res.json({
      gym: tp.gym_id ? (gymsById.get(tp.gym_id) || null) : null,
      pending_gym: tp.pending_gym_id ? (gymsById.get(tp.pending_gym_id) || null) : null,
    });
  } catch (err) {
    console.error('GET /api/trainer/gym-status error:', err);
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/trainer/leave-gym — trainer leaves their currently linked gym
// (or withdraws a pending join request). Self-only: acts on the
// authenticated user's own trainer_profiles row, mirrors PATCH
// /api/trainer/unlink (client-leaves-trainer) and PATCH /api/my-gym/unlink
// (member-leaves-gym) — same soft-detach shape, just for the trainer<->gym
// affiliation. History (templates, past clients) is untouched.
router.patch('/leave-gym', auth, async (req, res) => {
  try {
    const { data: tp, error: tpErr } = await supabase
      .from('trainer_profiles')
      .select('id, gym_id, pending_gym_id')
      .eq('user_id', req.user.id)
      .maybeSingle();
    if (tpErr) throw tpErr;
    if (!tp) return res.status(404).json({ error: 'Trainer profile not found' });
    if (!tp.gym_id && !tp.pending_gym_id) {
      return res.status(404).json({ error: 'Not linked to a gym' });
    }

    const { error: updateErr } = await supabase
      .from('trainer_profiles')
      .update({ gym_id: null, pending_gym_id: null, updated_at: new Date().toISOString() })
      .eq('id', tp.id);
    if (updateErr) throw updateErr;

    res.json({ success: true });
  } catch (err) {
    console.error('PATCH /api/trainer/leave-gym error:', err);
    res.status(500).json({ error: err.message || 'Failed to leave gym' });
  }
});

// POST /api/trainer/join-gym — trainer requests to join a gym by code
router.post('/join-gym', auth, async (req, res) => {
  try {
    const { trainer_join_code } = req.body;
    if (!trainer_join_code) return res.status(400).json({ error: 'trainer_join_code is required' });

    const code = trainer_join_code.trim().toUpperCase();

    const { data: gym, error: gymErr } = await supabase
      .from('gyms')
      .select('id, name')
      .eq('trainer_join_code', code)
      .eq('is_active', true)
      .maybeSingle();
    if (gymErr) throw gymErr;
    if (!gym) return res.status(404).json({ error: 'Invalid gym code' });

    const { data: tp, error: tpErr } = await supabase
      .from('trainer_profiles')
      .select('id, gym_id')
      .eq('user_id', req.user.id)
      .maybeSingle();
    if (tpErr) throw tpErr;
    if (!tp) return res.status(404).json({ error: 'Trainer profile not found' });

    // One-gym-max: reject outright rather than silently replacing an
    // existing affiliation.
    if (tp.gym_id) {
      return res.status(409).json({ error: 'Already linked to a gym' });
    }

    const { error: updateErr } = await supabase
      .from('trainer_profiles')
      .update({ pending_gym_id: gym.id, updated_at: new Date().toISOString() })
      .eq('id', tp.id);
    if (updateErr) throw updateErr;

    res.json({ success: true, gym_name: gym.name });
  } catch (err) {
    console.error('POST /api/trainer/join-gym error:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/trainer/claim-invite — trainer claims a phone-invite placeholder row.
// The caller's own auth identity becomes the user_id; never trust a userId from
// the request body (a caller could supply someone else's id).
router.post('/claim-invite', auth, async (req, res) => {
  try {
    const { invite_code } = req.body || {};
    if (!invite_code || !invite_code.trim()) {
      return res.status(400).json({ error: 'invite_code is required' });
    }

    // Find the unclaimed placeholder row
    const { data: placeholder, error: findErr } = await supabase
      .from('trainer_profiles')
      .select('id, gym_id, status')
      .eq('invite_code', invite_code.trim().toUpperCase())
      .eq('status', 'phone_invited')
      .maybeSingle();
    if (findErr) throw findErr;
    if (!placeholder) {
      return res.status(404).json({ error: 'Invalid or already-used invite code' });
    }

    // Caller must not already have a trainer profile
    const { data: existing } = await supabase
      .from('trainer_profiles')
      .select('id')
      .eq('user_id', req.user.id)
      .maybeSingle();
    if (existing) {
      return res.status(409).json({ error: 'You already have a trainer profile' });
    }

    // Claim the row — re-check status in the WHERE to prevent a TOCTOU race
    const { error: claimErr } = await supabase
      .from('trainer_profiles')
      .update({
        user_id:    req.user.id,
        status:     'active',
        updated_at: new Date().toISOString(),
      })
      .eq('id', placeholder.id)
      .eq('status', 'phone_invited');
    if (claimErr) throw claimErr;

    // Promote the user to trainer role so checkOnboarding routes them correctly
    await supabase.from('users').update({ role: 'trainer' }).eq('id', req.user.id);

    res.json({ success: true, gym_id: placeholder.gym_id });
  } catch (err) {
    console.error('POST /api/trainer/claim-invite error:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
