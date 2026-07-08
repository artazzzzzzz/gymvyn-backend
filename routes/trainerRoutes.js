const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const { auth } = require('../middleware/auth');

const router = express.Router();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

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
      const { error: insertErr } = await supabase
        .from('trainer_clients')
        .insert({ trainer_id: trainerId, client_id: foundUser.id, status: 'pending' });
      if (insertErr) throw insertErr;
    }

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

    if (existing?.status === 'active') {
      return res.status(400).json({ error: 'Already linked to this trainer' });
    }

    if (existing) {
      const { error: updErr } = await supabase
        .from('trainer_clients')
        .update({ status: 'active' })
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
    const { error } = await supabase
      .from('trainer_clients')
      .update({ status: 'active', started_at: new Date().toISOString() })
      .eq('id', req.params.id)
      .eq('client_id', req.user.id);

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
    const { data: rel, error: relErr } = await supabase
      .from('trainer_clients')
      .select(`
        id, trainer_id,
        trainer:users!trainer_clients_trainer_id_fkey(id, full_name)
      `)
      .eq('client_id', req.user.id)
      .eq('status', 'active')
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
      .eq('status', 'active')
      .order('created_at', { ascending: false })
      .limit(1);

    // Real conversations schema is participant_1_id/participant_2_id, not
    // trainer_id/client_id — this used to select nonexistent columns and
    // silently return `conversation: null` always (error wasn't checked).
    const { data: convos } = await supabase
      .from('conversations')
      .select('id, last_message_preview, last_message_at, p1_unread, p2_unread, participant_1_id, participant_2_id')
      .or(`participant_1_id.eq.${req.user.id},participant_2_id.eq.${req.user.id}`)
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

    const { data: rel, error: relErr } = await supabase
      .from('trainer_clients')
      .select('id')
      .eq('client_id', clientId)
      .eq('status', 'active')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (relErr) throw relErr;
    if (!rel) return res.status(404).json({ error: 'No active trainer found' });

    const { error: updErr } = await supabase
      .from('trainer_clients')
      .update({ status: 'removed', updated_at: new Date().toISOString() })
      .eq('id', rel.id)
      .eq('client_id', clientId);
    if (updErr) throw updErr;

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

module.exports = router;
