-- PHASE 2. Apply only after Phase 1, the new backend deployment, and API smoke tests.
DO $$ BEGIN
 IF EXISTS (SELECT 1 FROM public.conversations WHERE participant_1_id>=participant_2_id) THEN RAISE EXCEPTION 'noncanonical/self conversations present'; END IF;
 IF EXISTS (SELECT 1 FROM public.messages WHERE btrim(content)='' OR length(content)>4000) THEN RAISE EXCEPTION 'message content precondition failed'; END IF;
END $$;
ALTER TABLE public.conversations ADD CONSTRAINT conversations_no_self_participant_check CHECK(participant_1_id<>participant_2_id), ADD CONSTRAINT conversations_canonical_participant_order_check CHECK(participant_1_id<participant_2_id);
ALTER TABLE public.messages ADD CONSTRAINT messages_nonblank_content_check CHECK(length(btrim(content))>0), ADD CONSTRAINT messages_content_max_length_check CHECK(length(content)<=4000);
CREATE INDEX IF NOT EXISTS idx_messages_conversation_created_id ON public.messages(conversation_id,created_at,id);
DROP POLICY IF EXISTS "participants can insert conversations" ON public.conversations;
DROP POLICY IF EXISTS "participants can update conversations" ON public.conversations;
DROP POLICY IF EXISTS "sender can insert messages" ON public.messages;
-- No current production DELETE/UPDATE write policies exist for messages; retain participant SELECT only.
REVOKE EXECUTE ON FUNCTION public.get_or_create_conversation(uuid,uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.increment_unread(uuid,text) FROM PUBLIC, anon, authenticated;
