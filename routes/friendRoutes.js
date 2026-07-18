const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const { auth } = require('../middleware/auth');
const { canonicalPair } = require('../src/utils/canMessage');

const router = express.Router();
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const validId = (id) => typeof id === 'string' && uuid.test(id);

async function findFriendship(id, userId) {
  const { data, error } = await supabase.from('friendships').select('*').eq('id', id).or(`participant_1_id.eq.${userId},participant_2_id.eq.${userId}`).maybeSingle();
  if (error) throw error;
  return data;
}
async function isBlocked(userA, userB) {
  const [p1, p2] = canonicalPair(userA, userB);
  const { data, error } = await supabase.from('user_blocks').select('id').eq('participant_1_id', p1).eq('participant_2_id', p2).maybeSingle();
  if (error) throw error;
  return !!data;
}

async function publicUsersById(ids) {
  if (!ids.length) return new Map();
  const { data, error } = await supabase
    .from('users')
    .select('id,full_name,role')
    .in('id', [...new Set(ids)]);
  if (error) throw error;
  return new Map((data || []).map(user => [user.id, user]));
}

function friendshipWithOther(row, userId, usersById) {
  const otherUserId = row.participant_1_id === userId ? row.participant_2_id : row.participant_1_id;
  return { ...row, other_user: usersById.get(otherUserId) || { id: otherUserId, full_name: null, role: null } };
}

router.post('/requests', auth, async (req, res) => {
  try {
    const targetUserId = req.body?.targetUserId;
    if (!validId(targetUserId)) return res.status(400).json({ error: 'valid targetUserId is required' });
    if (targetUserId === req.userId) return res.status(400).json({ error: 'Cannot friend yourself' });
    if (await isBlocked(req.userId, targetUserId)) return res.status(403).json({ error: 'Friend requests are not permitted for this user' });
    const [p1, p2] = canonicalPair(req.userId, targetUserId);
    const { data: target, error: targetErr } = await supabase.from('users').select('id').eq('id', targetUserId).maybeSingle();
    if (targetErr) throw targetErr;
    if (!target) return res.status(404).json({ error: 'User not found' });
    const { data: existing, error: existingErr } = await supabase.from('friendships').select('*').eq('participant_1_id', p1).eq('participant_2_id', p2).maybeSingle();
    if (existingErr) throw existingErr;
    if (existing?.status === 'pending' || existing?.status === 'accepted') return res.status(409).json({ error: 'Friendship request already exists' });
    const payload = { participant_1_id: p1, participant_2_id: p2, requester_id: req.userId, status: 'pending', responded_at: null, updated_at: new Date().toISOString() };
    const query = existing ? supabase.from('friendships').update(payload).eq('id', existing.id) : supabase.from('friendships').insert(payload);
    const { data, error } = await query.select('*').single();
    if (error) throw error;
    res.status(existing ? 200 : 201).json(data);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/requests', auth, async (req, res) => {
  try {
    const { data, error } = await supabase.from('friendships').select('*').eq('status', 'pending').or(`participant_1_id.eq.${req.userId},participant_2_id.eq.${req.userId}`).order('created_at', { ascending: false });
    if (error) throw error;
    const usersById = await publicUsersById((data || []).flatMap(row => [row.participant_1_id, row.participant_2_id]));
    res.json({
      incoming: (data || []).filter(r => r.requester_id !== req.userId).map(row => friendshipWithOther(row, req.userId, usersById)),
      outgoing: (data || []).filter(r => r.requester_id === req.userId).map(row => friendshipWithOther(row, req.userId, usersById)),
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// A deliberately narrow, authenticated discovery endpoint for friend requests.
// It exposes only the public profile fields needed by the member-facing picker.
router.get('/search', auth, async (req, res) => {
  try {
    const rawQuery = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    if (rawQuery.length < 2) return res.status(400).json({ error: 'Search term must be at least 2 characters' });
    const limit = Math.min(Math.max(Number.parseInt(req.query.limit, 10) || 10, 1), 20);
    const escapedQuery = rawQuery.replace(/[\\%_]/g, '\\$&');
    const { data: candidates, error } = await supabase
      .from('users')
      .select('id,full_name,role')
      .neq('id', req.userId)
      .ilike('full_name', `%${escapedQuery}%`)
      .order('full_name', { ascending: true })
      .limit(limit);
    if (error) throw error;

    const candidateIds = (candidates || []).map(user => user.id);
    if (!candidateIds.length) return res.json([]);
    const [friendshipResult, blockResult] = await Promise.all([
      supabase.from('friendships').select('participant_1_id,participant_2_id,status,requester_id')
        .or(`participant_1_id.eq.${req.userId},participant_2_id.eq.${req.userId}`),
      supabase.from('user_blocks').select('participant_1_id,participant_2_id')
        .or(`participant_1_id.eq.${req.userId},participant_2_id.eq.${req.userId}`),
    ]);
    if (friendshipResult.error) throw friendshipResult.error;
    if (blockResult.error) throw blockResult.error;

    const friendshipByOtherId = new Map((friendshipResult.data || []).map(row => [
      row.participant_1_id === req.userId ? row.participant_2_id : row.participant_1_id,
      row,
    ]));
    const blockedIds = new Set((blockResult.data || []).map(row =>
      row.participant_1_id === req.userId ? row.participant_2_id : row.participant_1_id
    ));

    // Do not reveal users with an active block in either direction.
    res.json((candidates || []).filter(user => !blockedIds.has(user.id)).map(user => {
      const relationship = friendshipByOtherId.get(user.id);
      return {
        ...user,
        friendship_status: relationship?.status || null,
        incoming_request: relationship?.status === 'pending' && relationship.requester_id !== req.userId,
      };
    }));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/requests/:friendshipId/accept', auth, async (req, res) => {
  try {
    if (!validId(req.params.friendshipId)) return res.status(400).json({ error: 'valid friendshipId is required' });
    const row = await findFriendship(req.params.friendshipId, req.userId);
    if (!row) return res.status(404).json({ error: 'Friend request not found' });
    if (row.requester_id === req.userId || row.status !== 'pending') return res.status(409).json({ error: 'Friend request cannot be accepted' });
    const { data, error } = await supabase.from('friendships').update({ status: 'accepted', responded_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq('id', row.id).select('*').single();
    if (error) throw error; res.json(data);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/requests/:friendshipId/decline', auth, async (req, res) => {
  try {
    if (!validId(req.params.friendshipId)) return res.status(400).json({ error: 'valid friendshipId is required' });
    const row = await findFriendship(req.params.friendshipId, req.userId);
    if (!row) return res.status(404).json({ error: 'Friend request not found' });
    if (row.requester_id === req.userId || row.status !== 'pending') return res.status(409).json({ error: 'Friend request cannot be declined' });
    const { data, error } = await supabase.from('friendships').update({ status: 'declined', responded_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq('id', row.id).select('*').single();
    if (error) throw error; res.json(data);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/:friendshipId', auth, async (req, res) => {
  try {
    if (!validId(req.params.friendshipId)) return res.status(400).json({ error: 'valid friendshipId is required' });
    const row = await findFriendship(req.params.friendshipId, req.userId);
    if (!row) return res.status(404).json({ error: 'Friendship not found' });
    if (row.status !== 'accepted') return res.status(409).json({ error: 'Only accepted friendships can be removed' });
    const { error } = await supabase.from('friendships').update({ status: 'removed', updated_at: new Date().toISOString() }).eq('id', row.id);
    if (error) throw error; res.status(204).end();
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/block', auth, async (req, res) => {
  try {
    const userId = req.body?.userId;
    if (!validId(userId)) return res.status(400).json({ error: 'valid userId is required' });
    if (userId === req.userId) return res.status(400).json({ error: 'Cannot block yourself' });
    const [p1, p2] = canonicalPair(req.userId, userId);
    const { data, error } = await supabase.from('user_blocks').upsert({ participant_1_id: p1, participant_2_id: p2, blocker_id: req.userId }, { onConflict: 'participant_1_id,participant_2_id' }).select('*').single();
    if (error) throw error; res.json(data);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/block/:userId', auth, async (req, res) => {
  try {
    if (!validId(req.params.userId)) return res.status(400).json({ error: 'valid userId is required' });
    const [p1, p2] = canonicalPair(req.userId, req.params.userId);
    const { error } = await supabase.from('user_blocks').delete().eq('participant_1_id', p1).eq('participant_2_id', p2).eq('blocker_id', req.userId);
    if (error) throw error; res.status(204).end();
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/', auth, async (req, res) => {
  try {
    const { data, error } = await supabase.from('friendships').select('*').eq('status', 'accepted').or(`participant_1_id.eq.${req.userId},participant_2_id.eq.${req.userId}`);
    if (error) throw error;
    const ids = (data || []).map(r => r.participant_1_id === req.userId ? r.participant_2_id : r.participant_1_id);
    const usersById = await publicUsersById(ids);
    res.json((data || []).map(row => ({
      friendship_id: row.id,
      ...(usersById.get(row.participant_1_id === req.userId ? row.participant_2_id : row.participant_1_id) || {}),
    })));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Only the person who created a block may see it here. This allows a safe
// unblock screen without exposing people who have blocked the caller.
router.get('/blocks', auth, async (req, res) => {
  try {
    const { data, error } = await supabase.from('user_blocks').select('*').eq('blocker_id', req.userId).order('created_at', { ascending: false });
    if (error) throw error;
    const ids = (data || []).map(row => row.participant_1_id === req.userId ? row.participant_2_id : row.participant_1_id);
    const usersById = await publicUsersById(ids);
    res.json((data || []).map(row => ({
      block_id: row.id,
      ...(usersById.get(row.participant_1_id === req.userId ? row.participant_2_id : row.participant_1_id) || {}),
    })));
  } catch (err) { res.status(500).json({ error: err.message }); }
});
module.exports = router;
