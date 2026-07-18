-- Canonical global friendship and blocking layer. Kept separate from
-- buddy_requests, which is a gym-scoped opt-in relationship.
CREATE TABLE IF NOT EXISTS public.friendships (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  participant_1_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  participant_2_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  requester_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'declined', 'removed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  responded_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT friendships_distinct_participants CHECK (participant_1_id <> participant_2_id),
  CONSTRAINT friendships_canonical_participants CHECK (participant_1_id < participant_2_id),
  CONSTRAINT friendships_requester_is_participant CHECK (requester_id IN (participant_1_id, participant_2_id)),
  CONSTRAINT friendships_pair_unique UNIQUE (participant_1_id, participant_2_id)
);
CREATE INDEX IF NOT EXISTS friendships_participant_1_idx ON public.friendships(participant_1_id, status);
CREATE INDEX IF NOT EXISTS friendships_participant_2_idx ON public.friendships(participant_2_id, status);

CREATE TABLE IF NOT EXISTS public.user_blocks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  participant_1_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  participant_2_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  blocker_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT user_blocks_distinct_participants CHECK (participant_1_id <> participant_2_id),
  CONSTRAINT user_blocks_canonical_participants CHECK (participant_1_id < participant_2_id),
  CONSTRAINT user_blocks_blocker_is_participant CHECK (blocker_id IN (participant_1_id, participant_2_id)),
  CONSTRAINT user_blocks_pair_unique UNIQUE (participant_1_id, participant_2_id)
);
CREATE INDEX IF NOT EXISTS user_blocks_blocker_idx ON public.user_blocks(blocker_id);

ALTER TABLE public.friendships ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_blocks ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.friendships, public.user_blocks FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.friendships, public.user_blocks TO service_role;
