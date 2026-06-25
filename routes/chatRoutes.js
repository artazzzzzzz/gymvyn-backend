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

  req.userId = data.user.id;
  next();
}

// GET /api/chat/conversations
router.get('/conversations', auth, async (req, res) => {
  try {
    const userId = req.userId;

    const { data, error } = await supabase
      .from('conversations')
      .select(`
        *,
        p1:users!conversations_participant_1_id_fkey(id, full_name, role),
        p2:users!conversations_participant_2_id_fkey(id, full_name, role)
      `)
      .or(`participant_1_id.eq.${userId},participant_2_id.eq.${userId}`)
      .order('last_message_at', { ascending: false, nullsFirst: false });

    if (error) throw error;

    const conversations = (data || []).map(c => {
      const isP1 = c.participant_1_id === userId;
      return {
        ...c,
        other_user: isP1
          ? { id: c.p2?.id, full_name: c.p2?.full_name, role: c.p2?.role }
          : { id: c.p1?.id, full_name: c.p1?.full_name, role: c.p1?.role },
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

    // Fetch messages
    const { data: messages, error: msgErr } = await supabase
      .from('messages')
      .select('*, sender:users!messages_sender_id_fkey(id, full_name, role)')
      .eq('conversation_id', conversationId)
      .order('created_at', { ascending: true })
      .limit(50);

    if (msgErr) throw msgErr;

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

    // Insert message
    const { data: msg, error: msgErr } = await supabase
      .from('messages')
      .insert({
        conversation_id: conversationId,
        sender_id: userId,
        content: content.trim(),
        message_type: 'text',
      })
      .select('*, sender:users!messages_sender_id_fkey(id, full_name, role)')
      .single();

    if (msgErr) throw msgErr;

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

// POST /api/chat/start
router.post('/start', auth, async (req, res) => {
  try {
    const userId = req.userId;
    const { targetUserId } = req.body;

    if (!targetUserId) return res.status(400).json({ error: 'targetUserId is required' });
    if (targetUserId === userId) return res.status(400).json({ error: 'Cannot start a conversation with yourself' });

    const { data, error } = await supabase.rpc('get_or_create_conversation', {
      user_a: userId,
      user_b: targetUserId,
    });

    if (error) throw error;

    res.json({ conversationId: data });
  } catch (err) {
    console.error('POST /api/chat/start error:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
