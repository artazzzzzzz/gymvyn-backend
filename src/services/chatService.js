'use strict';

const MAX_MESSAGE_LENGTH = 4000;

function validateMessageContent(content) {
  if (typeof content !== 'string') return { error: 'content must be a string' };
  const trimmed = content.trim();
  if (!trimmed) return { error: 'content cannot be empty' };
  if (trimmed.length > MAX_MESSAGE_LENGTH) return { error: `content must be at most ${MAX_MESSAGE_LENGTH} characters` };
  return { value: trimmed };
}

async function sendMessageAtomically(supabase, { conversationId, senderId, content }) {
  const { data, error } = await supabase.rpc('chat_send_message', {
    p_conversation_id: conversationId,
    p_sender_id: senderId,
    p_content: content,
  });
  if (error) throw error;
  return data;
}

async function markConversationRead(supabase, { conversationId, readerId }) {
  const { error } = await supabase.rpc('chat_mark_read', {
    p_conversation_id: conversationId,
    p_reader_id: readerId,
  });
  if (error) throw error;
}

module.exports = { MAX_MESSAGE_LENGTH, validateMessageContent, sendMessageAtomically, markConversationRead };
