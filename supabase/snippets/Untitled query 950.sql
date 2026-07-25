-- PHASE 1 (additive). Safe while the old backend is still deployed.
-- It preserves old RPCs and browser policies; deploy the new backend only after
-- this migration succeeds. Do not apply to production from this task.

CREATE OR REPLACE FUNCTION public.chat_get_or_create_conversation(user_a uuid, user_b uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE p1 uuid; p2 uuid; conv_id uuid;
BEGIN
  IF user_a IS NULL OR user_b IS NULL OR user_a = user_b THEN RAISE EXCEPTION 'invalid conversation participants' USING ERRCODE='22023'; END IF;
  IF user_a < user_b THEN p1:=user_a; p2:=user_b; ELSE p1:=user_b; p2:=user_a; END IF;
  INSERT INTO public.conversations (participant_1_id, participant_2_id) VALUES (p1,p2)
  ON CONFLICT (participant_1_id,participant_2_id)
  DO UPDATE SET participant_1_id=public.conversations.participant_1_id
  RETURNING id INTO conv_id;
  RETURN conv_id;
END $$;

CREATE OR REPLACE FUNCTION public.chat_send_message(p_conversation_id uuid,p_sender_id uuid,p_content text)
RETURNS public.messages LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE c public.conversations; m public.messages;
BEGIN
  IF p_content IS NULL OR length(btrim(p_content))=0 OR length(p_content)>4000 THEN RAISE EXCEPTION 'invalid message content' USING ERRCODE='22023'; END IF;
  SELECT * INTO c FROM public.conversations WHERE id=p_conversation_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'conversation not found' USING ERRCODE='P0002'; END IF;
  IF p_sender_id<>c.participant_1_id AND p_sender_id<>c.participant_2_id THEN RAISE EXCEPTION 'sender is not a conversation participant' USING ERRCODE='42501'; END IF;
  INSERT INTO public.messages(conversation_id,sender_id,content) VALUES(c.id,p_sender_id,btrim(p_content)) RETURNING * INTO m;
  UPDATE public.conversations SET last_message_at=m.created_at,last_message_preview=left(m.content,60),
    p1_unread=CASE WHEN p_sender_id=c.participant_2_id THEN coalesce(p1_unread,0)+1 ELSE p1_unread END,
    p2_unread=CASE WHEN p_sender_id=c.participant_1_id THEN coalesce(p2_unread,0)+1 ELSE p2_unread END WHERE id=c.id;
  RETURN m;
END $$;

CREATE OR REPLACE FUNCTION public.chat_mark_read(p_conversation_id uuid,p_reader_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE c public.conversations;
BEGIN
  SELECT * INTO c FROM public.conversations WHERE id=p_conversation_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'conversation not found' USING ERRCODE='P0002'; END IF;
  IF p_reader_id=c.participant_1_id THEN UPDATE public.conversations SET p1_unread=0 WHERE id=c.id;
  ELSIF p_reader_id=c.participant_2_id THEN UPDATE public.conversations SET p2_unread=0 WHERE id=c.id;
  ELSE RAISE EXCEPTION 'reader is not a conversation participant' USING ERRCODE='42501'; END IF;
END $$;

REVOKE ALL ON FUNCTION public.chat_get_or_create_conversation(uuid,uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.chat_send_message(uuid,uuid,text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.chat_mark_read(uuid,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.chat_get_or_create_conversation(uuid,uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.chat_send_message(uuid,uuid,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.chat_mark_read(uuid,uuid) TO service_role;
