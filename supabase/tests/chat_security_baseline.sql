-- TEST ONLY — NOT A PRODUCTION MIGRATION.
-- This is loaded only into the dedicated local gymvyn_chat_security_test
-- database by scripts/reset-chat-security-local-db.js. It is deliberately not
-- in supabase/migrations and must never be used with db push/link/reset.

DO $$ BEGIN
  IF current_database() <> 'gymvyn_chat_security_test' THEN
    RAISE EXCEPTION 'Refusing fixture outside gymvyn_chat_security_test';
  END IF;
END $$;

DROP SCHEMA IF EXISTS public CASCADE;
DROP SCHEMA IF EXISTS auth CASCADE;
CREATE SCHEMA public;
CREATE SCHEMA auth;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
CREATE TABLE auth.users (id uuid PRIMARY KEY, email text NOT NULL UNIQUE);
CREATE TABLE public.users (id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE, role text NOT NULL, is_active boolean NOT NULL DEFAULT true);
CREATE TABLE public.gyms (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), owner_id uuid NOT NULL REFERENCES public.users(id), is_active boolean NOT NULL DEFAULT true);
CREATE TABLE public.trainer_profiles (user_id uuid PRIMARY KEY REFERENCES public.users(id), gym_id uuid REFERENCES public.gyms(id), pending_gym_id uuid, is_active boolean NOT NULL DEFAULT true, status text DEFAULT 'active');
CREATE TABLE public.trainer_clients (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), trainer_id uuid NOT NULL REFERENCES public.users(id), client_id uuid NOT NULL REFERENCES public.users(id), gym_id uuid REFERENCES public.gyms(id), status text NOT NULL DEFAULT 'pending', created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE public.gym_memberships (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), gym_id uuid NOT NULL REFERENCES public.gyms(id), user_id uuid NOT NULL REFERENCES public.users(id), status text NOT NULL DEFAULT 'active', end_date date);
CREATE TABLE public.gym_staff (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), gym_id uuid NOT NULL REFERENCES public.gyms(id), user_id uuid NOT NULL REFERENCES public.users(id), is_active boolean NOT NULL DEFAULT true);
CREATE TABLE public.buddy_requests (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), sender_id uuid NOT NULL REFERENCES auth.users(id), receiver_id uuid NOT NULL REFERENCES auth.users(id), gym_id uuid REFERENCES public.gyms(id), status text NOT NULL DEFAULT 'pending');
CREATE TABLE public.friendships (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), participant_1_id uuid NOT NULL REFERENCES auth.users(id), participant_2_id uuid NOT NULL REFERENCES auth.users(id), requester_id uuid NOT NULL REFERENCES auth.users(id), status text NOT NULL DEFAULT 'pending', created_at timestamptz NOT NULL DEFAULT now(), responded_at timestamptz, updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE(participant_1_id,participant_2_id));
CREATE TABLE public.user_blocks (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), participant_1_id uuid NOT NULL REFERENCES auth.users(id), participant_2_id uuid NOT NULL REFERENCES auth.users(id), blocker_id uuid NOT NULL REFERENCES auth.users(id), created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(participant_1_id,participant_2_id));
CREATE TABLE public.marketplace_purchases (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), buyer_id uuid NOT NULL REFERENCES public.users(id), seller_id uuid NOT NULL REFERENCES public.users(id), status text NOT NULL);
CREATE TABLE public.conversations (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), participant_1_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE, participant_2_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE, last_message_at timestamptz, last_message_preview text, p1_unread integer DEFAULT 0, p2_unread integer DEFAULT 0, created_at timestamptz DEFAULT now(), UNIQUE(participant_1_id, participant_2_id));
CREATE TABLE public.messages (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), conversation_id uuid NOT NULL REFERENCES public.conversations(id), sender_id uuid NOT NULL, content text NOT NULL, created_at timestamptz DEFAULT now());

-- Deliberately unsafe legacy surface, used to prove Phase 2 revokes/removes it.
CREATE FUNCTION public.get_or_create_conversation(user_a uuid, user_b uuid) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE p1 uuid; p2 uuid; conv_id uuid; BEGIN
  IF user_a < user_b THEN p1:=user_a; p2:=user_b; ELSE p1:=user_b; p2:=user_a; END IF;
  SELECT id INTO conv_id FROM public.conversations WHERE participant_1_id=p1 AND participant_2_id=p2;
  IF conv_id IS NULL THEN INSERT INTO public.conversations(participant_1_id, participant_2_id) VALUES(p1,p2) RETURNING id INTO conv_id; END IF;
  RETURN conv_id;
END $$;
CREATE FUNCTION public.increment_unread(uuid, text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$ BEGIN END $$;

ALTER TABLE public.conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY "participants can select conversations" ON public.conversations FOR SELECT USING (auth.uid()=participant_1_id OR auth.uid()=participant_2_id);
CREATE POLICY "participants can insert conversations" ON public.conversations FOR INSERT WITH CHECK (auth.uid()=participant_1_id OR auth.uid()=participant_2_id);
CREATE POLICY "participants can update conversations" ON public.conversations FOR UPDATE USING (auth.uid()=participant_1_id OR auth.uid()=participant_2_id);
CREATE POLICY "participants can select messages" ON public.messages FOR SELECT USING (EXISTS(SELECT 1 FROM public.conversations c WHERE c.id=conversation_id AND (auth.uid()=c.participant_1_id OR auth.uid()=c.participant_2_id)));
CREATE POLICY "sender can insert messages" ON public.messages FOR INSERT WITH CHECK (auth.uid()=sender_id);
GRANT USAGE ON SCHEMA public, auth TO anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_or_create_conversation(uuid,uuid), public.increment_unread(uuid,text) TO PUBLIC, anon, authenticated;
