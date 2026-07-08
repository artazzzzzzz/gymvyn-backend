-- conversations/messages are written and read exclusively through the
-- backend (service role, which bypasses RLS) after a can_message() check —
-- see routes/chatRoutes.js. These policies are a defense-in-depth backstop
-- for the anon/authenticated roles (e.g. a direct Supabase client call, or
-- a Realtime subscription) so that even if the backend check were bypassed,
-- a user can never read or write a conversation/message they're not a
-- participant in. No INSERT/UPDATE policy is granted to anon/authenticated
-- — all writes must go through the backend.

ALTER TABLE conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS conversations_participant_select ON conversations;
CREATE POLICY conversations_participant_select ON conversations
  FOR SELECT
  USING (auth.uid() = participant_1_id OR auth.uid() = participant_2_id);

DROP POLICY IF EXISTS messages_participant_select ON messages;
CREATE POLICY messages_participant_select ON messages
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM conversations c
      WHERE c.id = messages.conversation_id
        AND (auth.uid() = c.participant_1_id OR auth.uid() = c.participant_2_id)
    )
  );
