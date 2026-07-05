const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const { canMessage, getOrCreateConversationIfAllowed, getGymContexts, sharedGymId } = require('../src/utils/canMessage');

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

  req.userId = data.user.id;
  next();
}

// GET /api/chat/conversations
router.get('/conversations', auth, async (req, res) => {
  try {
    const userId = req.userId;

    // No FK constraint exists from conversations.participant_*_id to
    // users.id (confirmed against the live schema), so the embedded
    // users!conversations_participant_1_id_fkey(...) join PostgREST syntax
    // 404s with "Could not find a relationship" — fetch participants
    // separately and join in JS instead, same workaround already used
    // elsewhere in this codebase (see GET /api/gym-trainers/:gymId).
    const { data, error } = await supabase
      .from('conversations')
      .select('*')
      .or(`participant_1_id.eq.${userId},participant_2_id.eq.${userId}`)
      .order('last_message_at', { ascending: false, nullsFirst: false });

    if (error) throw error;

    const otherIds = [...new Set((data || []).map(c =>
      c.participant_1_id === userId ? c.participant_2_id : c.participant_1_id
    ).filter(Boolean))];

    let usersById = new Map();
    if (otherIds.length) {
      const { data: users, error: usersErr } = await supabase
        .from('users')
        .select('id, full_name, role')
        .in('id', otherIds);
      if (usersErr) throw usersErr;
      usersById = new Map((users || []).map(u => [u.id, u]));
    }

    const conversations = (data || []).map(c => {
      const isP1 = c.participant_1_id === userId;
      const otherId = isP1 ? c.participant_2_id : c.participant_1_id;
      const other = usersById.get(otherId);
      return {
        ...c,
        other_user: { id: otherId, full_name: other?.full_name || null, role: other?.role || null },
        unread: isP1 ? (c.p1_unread || 0) : (c.p2_unread || 0),
      };
    });

    res.json(conversations);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/chat/messages/:conversationId
router.get('/messages/:conversationId', auth, async (req, res) => {
  try {
    const userId = req.userId;
    const { conversationId } = req.params;

    // Security: verify caller is a participant
    const { data: convo, error: convoErr } = await supabase
      .from('conversations')
      .select('id, participant_1_id, participant_2_id')
      .eq('id', conversationId)
      .maybeSingle();

    if (convoErr) throw convoErr;
    if (!convo) return res.status(404).json({ error: 'Conversation not found' });

    const isP1 = convo.participant_1_id === userId;
    const isP2 = convo.participant_2_id === userId;
    if (!isP1 && !isP2) return res.status(403).json({ error: 'Not a participant' });

    // Re-check messaging eligibility on every read: a participant pair that
    // was allowed when the conversation was created (e.g. trainer-client,
    // gym staff) may no longer be allowed today (unlinked, deactivated).
    const otherId = isP1 ? convo.participant_2_id : convo.participant_1_id;
    if (!(await canMessage(supabase, userId, otherId))) {
      return res.status(403).json({ error: 'Messaging is no longer permitted between these users' });
    }

    // Fetch messages. No FK constraint exists from messages.sender_id to
    // users.id, so (as above) skip the embedded join and look senders up
    // separately.
    const { data: rawMessages, error: msgErr } = await supabase
      .from('messages')
      .select('*')
      .eq('conversation_id', conversationId)
      .order('created_at', { ascending: true })
      .limit(50);

    if (msgErr) throw msgErr;

    const senderIds = [...new Set((rawMessages || []).map(m => m.sender_id).filter(Boolean))];
    let sendersById = new Map();
    if (senderIds.length) {
      const { data: senders, error: sendersErr } = await supabase
        .from('users')
        .select('id, full_name, role')
        .in('id', senderIds);
      if (sendersErr) throw sendersErr;
      sendersById = new Map((senders || []).map(u => [u.id, u]));
    }
    const messages = (rawMessages || []).map(m => ({ ...m, sender: sendersById.get(m.sender_id) || null }));

    // Reset unread counter for reading user
    const unreadField = isP1 ? 'p1_unread' : 'p2_unread';
    await supabase
      .from('conversations')
      .update({ [unreadField]: 0 })
      .eq('id', conversationId);

    res.json(messages || []);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/chat/message
router.post('/message', auth, async (req, res) => {
  try {
    const userId = req.userId;
    const { conversationId, content } = req.body;

    if (!conversationId || !content?.trim()) {
      return res.status(400).json({ error: 'conversationId and content are required' });
    }

    // Security: verify caller is a participant
    const { data: convo, error: convoErr } = await supabase
      .from('conversations')
      .select('id, participant_1_id, participant_2_id, p1_unread, p2_unread')
      .eq('id', conversationId)
      .maybeSingle();

    if (convoErr) throw convoErr;
    if (!convo) return res.status(404).json({ error: 'Conversation not found' });

    const isP1 = convo.participant_1_id === userId;
    const isP2 = convo.participant_2_id === userId;
    if (!isP1 && !isP2) return res.status(403).json({ error: 'Not a participant' });

    const otherId = isP1 ? convo.participant_2_id : convo.participant_1_id;
    if (!(await canMessage(supabase, userId, otherId))) {
      return res.status(403).json({ error: 'Messaging is no longer permitted between these users' });
    }

    // Insert message. messages has no message_type column in the real
    // schema (PGRST204 when present) and no FK to users for an embedded
    // select (as above) — insert plain columns only, then attach sender
    // info from a separate lookup.
    const { data: msg, error: msgErr } = await supabase
      .from('messages')
      .insert({
        conversation_id: conversationId,
        sender_id: userId,
        content: content.trim(),
      })
      .select('*')
      .single();

    if (msgErr) throw msgErr;

    const { data: sender } = await supabase
      .from('users')
      .select('id, full_name, role')
      .eq('id', userId)
      .maybeSingle();
    msg.sender = sender || null;

    // Update conversation: bump unread for the OTHER participant
    await supabase
      .from('conversations')
      .update({
        last_message_at: new Date().toISOString(),
        last_message_preview: content.trim().substring(0, 60),
        p1_unread: isP1 ? convo.p1_unread : (convo.p1_unread || 0) + 1,
        p2_unread: isP2 ? convo.p2_unread : (convo.p2_unread || 0) + 1,
      })
      .eq('id', conversationId);

    res.json(msg);
  } catch (err) {
    console.error('POST /api/chat/message error:', err);
    res.status(500).json({ error: err.message });
  }
});

// Gathers every user id who *might* be reachable via any relationship
// canMessage checks (trainer_clients in either direction/status, anyone
// sharing a gym the caller is owner/staff/member/trainer at, and any
// buddy_requests counterpart) — a deliberately loose superset. The actual
// allow/disallow decision for each candidate is still made exclusively by
// canMessage() in the route below, so this can never drift from it.
async function candidateContactIds(supabase, userId) {
  const ids = new Set();

  const { data: tcRows, error: tcErr } = await supabase
    .from('trainer_clients')
    .select('trainer_id, client_id')
    .or(`trainer_id.eq.${userId},client_id.eq.${userId}`);
  if (tcErr) throw tcErr;
  (tcRows || []).forEach(r => { ids.add(r.trainer_id); ids.add(r.client_id); });

  const myGyms = await getGymContexts(supabase, userId);
  const myGymIds = [...new Set([...myGyms.owned, ...myGyms.staff, ...myGyms.member, ...myGyms.trainer])];

  if (myGymIds.length) {
    const [gymRows, staffRows, memberRows, trainerRows] = await Promise.all([
      supabase.from('gyms').select('id, owner_id').in('id', myGymIds),
      supabase.from('gym_staff').select('user_id').in('gym_id', myGymIds),
      supabase.from('gym_memberships').select('user_id').in('gym_id', myGymIds),
      supabase.from('trainer_profiles').select('user_id').in('gym_id', myGymIds),
    ]);
    if (gymRows.error) throw gymRows.error;
    if (staffRows.error) throw staffRows.error;
    if (memberRows.error) throw memberRows.error;
    if (trainerRows.error) throw trainerRows.error;

    (gymRows.data || []).forEach(g => ids.add(g.owner_id));
    (staffRows.data || []).forEach(r => ids.add(r.user_id));
    (memberRows.data || []).forEach(r => ids.add(r.user_id));
    (trainerRows.data || []).forEach(r => ids.add(r.user_id));
  }

  const { data: buddyRows, error: buddyErr } = await supabase
    .from('buddy_requests')
    .select('sender_id, receiver_id')
    .or(`sender_id.eq.${userId},receiver_id.eq.${userId}`);
  if (buddyErr) throw buddyErr;
  (buddyRows || []).forEach(r => { ids.add(r.sender_id); ids.add(r.receiver_id); });

  ids.delete(userId);
  ids.delete(null);
  ids.delete(undefined);
  return [...ids];
}

// GET /api/chat/contacts
router.get('/contacts', auth, async (req, res) => {
  try {
    const userId = req.userId;
    const candidateIds = await candidateContactIds(supabase, userId);

    // The only permission decision made here is canMessage() itself —
    // reused directly, not re-implemented, so this list can never drift
    // from what /start, /message and /messages/:id actually allow.
    const checks = await Promise.all(
      candidateIds.map(async (candidateId) => ({
        candidateId,
        allowed: await canMessage(supabase, userId, candidateId),
      }))
    );
    const allowedIds = checks.filter(c => c.allowed).map(c => c.candidateId);

    if (!allowedIds.length) return res.json([]);

    const { data: users, error: usersErr } = await supabase
      .from('users')
      .select('id, full_name, role')
      .in('id', allowedIds);
    if (usersErr) throw usersErr;

    const myGyms = await getGymContexts(supabase, userId);
    const contacts = await Promise.all((users || []).map(async (u) => {
      const theirGyms = await getGymContexts(supabase, u.id);
      const gymId = sharedGymId(myGyms, theirGyms);
      return {
        id: u.id,
        full_name: u.full_name,
        role: u.role,
        ...(gymId ? { gym_id: gymId } : {}),
      };
    }));

    res.json(contacts);
  } catch (err) {
    console.error('GET /api/chat/contacts error:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/chat/start
router.post('/start', auth, async (req, res) => {
  try {
    const userId = req.userId;
    const { targetUserId } = req.body;

    if (!targetUserId) return res.status(400).json({ error: 'targetUserId is required' });
    if (targetUserId === userId) return res.status(400).json({ error: 'Cannot start a conversation with yourself' });

    // This was previously the real gap: any authenticated user could start a
    // conversation with any other arbitrary user id, with no relationship
    // check at all.
    const conversationId = await getOrCreateConversationIfAllowed(supabase, userId, targetUserId);
    if (!conversationId) {
      return res.status(403).json({ error: 'You are not permitted to message this user' });
    }

    res.json({ conversationId });
  } catch (err) {
    console.error('POST /api/chat/start error:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
