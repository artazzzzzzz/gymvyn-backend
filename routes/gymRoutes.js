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

// GET /api/gym/join-code — gym owner gets their gym's join code
router.get('/join-code', auth, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('gyms')
      .select('join_code')
      .eq('owner_id', req.user.id)
      .eq('is_active', true)
      .maybeSingle();

    if (error) throw error;
    if (!data) return res.status(404).json({ error: 'No gym found for this owner' });

    if (!data.join_code) {
      const code = Math.random().toString(36).substring(2, 8).toUpperCase();
      await supabase.from('gyms').update({ join_code: code }).eq('owner_id', req.user.id);
      data.join_code = code;
    }

    res.json({ join_code: data.join_code });
  } catch (err) {
    console.error('GET /api/gym/join-code error:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/gym/my-gym-code — gym owner gets join code + gym info
router.get('/my-gym-code', auth, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('gyms')
      .select('id, name, join_code')
      .eq('owner_id', req.user.id)
      .eq('is_active', true)
      .maybeSingle();

    if (error) throw error;
    if (!data) return res.status(404).json({ error: 'No gym found for this owner' });

    if (!data.join_code) {
      const code = Math.random().toString(36).substring(2, 8).toUpperCase();
      await supabase.from('gyms').update({ join_code: code }).eq('id', data.id);
      data.join_code = code;
    }

    res.json({ join_code: data.join_code, gym_name: data.name, gym_id: data.id });
  } catch (err) {
    console.error('GET /api/gym/my-gym-code error:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/gym/join — consumer joins a gym by code
router.post('/join', auth, async (req, res) => {
  try {
    const { join_code } = req.body;
    if (!join_code) return res.status(400).json({ error: 'join_code is required' });

    const { data: gym, error: gymErr } = await supabase
      .from('gyms')
      .select('id, name')
      .eq('join_code', join_code.trim().toUpperCase())
      .eq('is_active', true)
      .maybeSingle();

    if (gymErr) throw gymErr;
    if (!gym) return res.status(400).json({ error: 'Invalid gym code' });

    // gym_memberships is the source of truth for "is this user a member of this
    // gym" (owner's member list, My Gym tab). Write it BEFORE users.gym_id so a
    // failed membership insert can never leave users.gym_id pointing at a gym
    // the user isn't actually a member of.
    const { data: existingMembership, error: memLookupErr } = await supabase
      .from('gym_memberships')
      .select('id')
      .eq('gym_id', gym.id)
      .eq('user_id', req.user.id)
      .maybeSingle();
    if (memLookupErr) throw memLookupErr;

    if (!existingMembership) {
      const { error: memErr } = await supabase
        .from('gym_memberships')
        .insert({
          gym_id: gym.id,
          user_id: req.user.id,
          status: 'active',
          start_date: new Date().toISOString().slice(0, 10),
          metadata: { source: 'join_code' },
        });
      if (memErr) throw memErr;
    }

    const { error: updateErr } = await supabase
      .from('users')
      .update({ gym_id: gym.id })
      .eq('id', req.user.id);

    if (updateErr) throw updateErr;

    res.json({ success: true, gym_id: gym.id, gym_name: gym.name });
  } catch (err) {
    console.error('POST /api/gym/join error:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
