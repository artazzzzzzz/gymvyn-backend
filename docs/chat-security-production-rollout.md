# Gymvyn direct-message security hardening: controlled production rollout

**Status:** runbook only. Nothing in this document has been run against production.

**Scope:** apply the already locally tested database changes, deploy the matching
backend, then lock down browser-side database writes. Do not deploy the frontend,
run `supabase link`, run `supabase db reset`, or run any command against the local
test fixture during this procedure.

## Roles and rules

- One operator executes SQL in the authenticated **production Supabase Dashboard
  SQL Editor**. A second person, or a saved transcript, reviews each result before
  the next gate.
- The deploy operator runs only:

  ```bash
  cd /Users/artazayaz/Desktop/gymvyn-backend && railway up
  ```

- Do not paste or record service keys, JWTs, database passwords, Authorization
  headers, full message text, or user email addresses in the evidence log.
- SQL below is either read-only or explicitly labelled Phase 1/Phase 2. Do not
  modify it in the SQL editor. Save query result exports/screenshots with UTC
  timestamp and the git SHA.
- **Phase 2 is forbidden until the Railway deployment and all new-backend smoke
  tests have passed.**

## 0. Release identity and local verification gate

Run locally; these commands do not deploy or contact production:

```bash
cd /Users/artazayaz/Desktop/gymvyn-backend
git branch --show-current
git status --short
git rev-parse HEAD
git diff --check
shasum -a 256 migrations/chat_security_phase1_additive.sql migrations/chat_security_phase2_lockdown.sql
npm run test:chat-security
npm run test:chat-db
```

Expected branch: `main`. The locally tested migration hashes at time of this
runbook are:

```text
45221db949d40cc1aaa2144c9a867c9c3806ec9f1e91c8c1b178f063b399f552  phase1
cf3d2d05ee2b31bfd15fc8b18bf04f1b5556245d0c3ea98b7d7f71cbb1beb045  phase2
```

**Proceed only with evidence:** exact git SHA selected for release, clean diff
for the release files, matching two hashes, and passing local tests. Existing
unrelated working-tree changes must not be included in the Railway upload.

**Stop:** branch is not `main`; the intended release is uncommitted; either hash
differs; any local chat test fails; or the Railway upload would contain unrelated
changes. Commit/review the intended release first—do not proceed on assumption.

## 1. Production snapshot and read-only preflight

In the production Supabase Dashboard SQL Editor, run and save the results of
each query below. These do not alter data.

```sql
-- Database identity and server time for the evidence record.
SELECT current_database(), current_user, now() AS observed_at_utc;

-- Exact conversation/message shape, defaults, and constraints.
SELECT table_name, column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name IN ('conversations', 'messages')
ORDER BY table_name, ordinal_position;

SELECT conrelid::regclass AS table_name, conname, pg_get_constraintdef(oid) AS definition
FROM pg_constraint
WHERE conrelid IN ('public.conversations'::regclass, 'public.messages'::regclass)
ORDER BY table_name::text, conname;

-- Current RLS state and all chat policies.
SELECT schemaname, tablename, rowsecurity, forcerowsecurity
FROM pg_tables
WHERE schemaname = 'public' AND tablename IN ('conversations', 'messages');

SELECT schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check
FROM pg_policies
WHERE schemaname = 'public' AND tablename IN ('conversations', 'messages')
ORDER BY tablename, policyname;

-- Existing and future RPC definitions, ownership, and role execution grants.
SELECT p.oid::regprocedure AS function_signature,
       p.prosecdef AS security_definer,
       pg_get_userbyid(p.proowner) AS owner,
       p.proconfig AS function_config,
       pg_get_functiondef(p.oid) AS definition
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN ('get_or_create_conversation', 'increment_unread',
                    'chat_get_or_create_conversation', 'chat_send_message', 'chat_mark_read')
ORDER BY p.oid::regprocedure::text;

SELECT p.oid::regprocedure AS function_signature, r.rolname AS grantee,
       has_function_privilege(r.oid, p.oid, 'EXECUTE') AS can_execute
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
CROSS JOIN pg_roles r
WHERE n.nspname = 'public'
  AND p.proname IN ('get_or_create_conversation', 'increment_unread',
                    'chat_get_or_create_conversation', 'chat_send_message', 'chat_mark_read')
  AND r.rolname IN ('anon', 'authenticated', 'service_role')
ORDER BY function_signature::text, grantee;
```

Then run the integrity gates. They must produce **zero** bad rows before Phase
2; record counts now, even though Phase 2 is later.

```sql
SELECT
  count(*) AS conversations_total,
  count(*) FILTER (WHERE participant_1_id IS NULL OR participant_2_id IS NULL) AS null_participants,
  count(*) FILTER (WHERE participant_1_id = participant_2_id) AS self_conversations,
  count(*) FILTER (WHERE participant_1_id > participant_2_id) AS noncanonical_conversations
FROM public.conversations;

SELECT
  count(*) AS messages_total,
  count(*) FILTER (WHERE content IS NULL OR btrim(content) = '') AS blank_messages,
  count(*) FILTER (WHERE length(content) > 4000) AS oversized_messages,
  count(*) FILTER (WHERE sender_id IS NULL) AS null_senders
FROM public.messages;

-- Duplicate direct pairs would make Phase 1's UPSERT unsafe. Expect zero rows.
SELECT participant_1_id, participant_2_id, count(*) AS duplicate_count
FROM public.conversations
GROUP BY participant_1_id, participant_2_id
HAVING count(*) > 1;

-- Read-only metadata review; IDs/timestamps only, no message body export.
WITH latest AS (
  SELECT DISTINCT ON (conversation_id) conversation_id, id AS message_id, created_at,
         left(content, 60) AS expected_preview
  FROM public.messages
  ORDER BY conversation_id, created_at DESC NULLS LAST, id DESC
)
SELECT count(*) FILTER (WHERE c.last_message_preview IS DISTINCT FROM l.expected_preview
                         OR c.last_message_at IS DISTINCT FROM l.created_at) AS metadata_mismatches,
       count(*) AS conversations_checked
FROM public.conversations c
LEFT JOIN latest l ON l.conversation_id = c.id;

-- Relationship rows that the new backend deliberately treats as inactive.
SELECT count(*) AS active_rows_past_end_date
FROM public.gym_memberships
WHERE status = 'active' AND end_date < CURRENT_DATE;
```

**Proceed only with evidence:** snapshot saved; old RPCs/policies match the
expected baseline; zero self/noncanonical/blank/oversized/duplicate rows; and a
recorded metadata mismatch count. The expired-membership count is informational
but must be recorded because the new backend denies it.

**Stop:** schema differs materially from the migration assumptions; any bad-row
count is non-zero; unknown write policies/functions exist; or the snapshot cannot
be retained. Do not edit production data to “make it pass.” Escalate for a
separate reviewed data-repair/compatibility plan.

## 2. Apply Phase 1 only

1. In the production Dashboard SQL Editor, create a new query titled with the
   release SHA and `chat phase 1`.
2. Copy the complete, unmodified contents of
   `migrations/chat_security_phase1_additive.sql` from the verified commit.
3. Paste it once, execute once, and save the success result.
4. Immediately re-run the function/grant snapshot query from section 1.

**Expected Phase 1 evidence:**

- `chat_get_or_create_conversation(uuid,uuid)`,
  `chat_send_message(uuid,uuid,text)`, and `chat_mark_read(uuid,uuid)` exist;
  `prosecdef` is true and `function_config` fixes `search_path`.
- Each new RPC is executable by `service_role` and not executable by `anon` or
  `authenticated`.
- Old `get_or_create_conversation` and `increment_unread` remain executable at
  this stage; old browser write policies remain. This is intentional backward
  compatibility.

**Stop:** any Phase 1 statement errors; a new RPC/grant is missing; a new RPC is
browser-callable; or any old policy/RPC was removed. Do not deploy. Preserve the
error and snapshot.

## 3. Old-backend smoke test while Phase 1 is active

Before deploying, use two existing non-production test accounts that already
have an active, permitted relationship. Through the currently deployed app/API:

1. Open their existing conversation.
2. Send one short, harmless test message A→B; confirm it appears once and B’s
   unread count increases.
3. Open it as B; confirm the message is readable and the unread count clears.
4. Start a conversation between a permitted pair and send one message.
5. If available, assign a harmless test plan to an active test client and verify
   the existing old backend path does not cause an outage.

Record only account labels/IDs, UTC times, HTTP status, conversation ID, message
ID, and before/after unread counts—never message body or token.

**Proceed only with evidence:** all applicable old-backend flows return success
and existing history still reads. This proves Phase 1 is additive.

**Stop:** any existing chat flow is broken, duplicated, or loses unread updates.
Do not deploy; investigate using the Phase 1 function/policy snapshot.

## 4. Deploy the verified backend to Railway

Confirm the working tree is exactly the reviewed release first. Then run the
only authorized backend deployment command:

```bash
cd /Users/artazayaz/Desktop/gymvyn-backend && railway up
```

Wait for Railway to report a successful deployment and verify the deployed
release/revision in Railway. A submitted command or git push is **not** evidence
of deployment. No Vercel action is required.

**Proceed only with evidence:** successful Railway completion, healthy service,
and deployed revision matches the review SHA.

**Stop:** upload/build/start/health failure, wrong release revision, or missing
`SUPABASE_SERVICE_KEY` in the existing Railway service configuration. Do not run
Phase 2.

## 5. New-backend smoke tests and log proof

Use controlled existing test accounts and real authenticated API requests (do
not put their bearer tokens in the evidence). Confirm:

| Check | Expected result |
|---|---|
| `POST /api/chat/start` for an active permitted trainer-client or gym pair | `200`, one conversation ID; repeat returns same ID |
| `POST /api/chat/start` for self | `400` |
| `POST /api/chat/start` for unrelated accounts | `403` |
| `POST /api/chat/message` as participant with normal text | `200`, one message ID; other unread increments once |
| `GET /api/chat/messages/:conversationId` as participant | `200`, history preserved; reader unread clears |
| same GET/POST using a nonparticipant conversation ID | `403` |
| expired membership / inactive trainer-client test account | `403` for start, send, and history read |
| 4,001-character message | `400` |

For proof that the new paths are actually used, inspect Railway runtime logs for
the exact smoke-test timestamps. There must be no PostgREST/RPC errors naming
`chat_get_or_create_conversation`, `chat_send_message`, or `chat_mark_read`, and
no errors naming old `increment_unread`. The database audit below must also show
that the test conversation/message metadata changed atomically:

```sql
-- Replace only the placeholders locally in the SQL editor; do not save user data
-- to the runbook. This is read-only.
SELECT id, participant_1_id, participant_2_id, last_message_at,
       p1_unread, p2_unread
FROM public.conversations
WHERE id = '<test-conversation-uuid>';

SELECT id, conversation_id, sender_id, created_at
FROM public.messages
WHERE conversation_id = '<test-conversation-uuid>'
ORDER BY created_at DESC, id DESC
LIMIT 5;
```

**Proceed only with evidence:** every row above passes, Railway is healthy, log
window has no RPC failure, and the audit shows one new message with matching
conversation metadata/unread transition.

**Stop:** a `500`, missing/duplicate message, incorrect unread count, any
authorization bypass, old-RPC use/error, or mismatch between API response and
database result. Keep Phase 1; do not run Phase 2.

## 6. Apply Phase 2 (final lock-down)

This section is authorized **only** after section 5 evidence is complete.

1. Re-run the integrity queries from section 1 immediately before applying.
   All four counts—self, noncanonical, blank, oversized—must be zero.
2. In a new production Dashboard SQL Editor query, paste the complete unmodified
   contents of `migrations/chat_security_phase2_lockdown.sql` from the same
   verified commit and execute it once.
3. Save the success result and repeat the constraints, policy, function/grant,
   and index snapshots.

Expected result: participant canonical/self and content constraints exist;
`idx_messages_conversation_created_id` exists; the three direct-write policies
are absent; old RPC execution is revoked from `PUBLIC`, `anon`, and
`authenticated`; service-only new RPC grants remain.

**Stop:** any preflight bad-row count is non-zero, any SQL statement errors, a
constraint already exists (possible partial prior Phase 2), or the after snapshot
does not exactly show the expected policy/grant state. Do not retry blindly and
do not rollback the backend at this point.

## 7. Direct database denial checks after Phase 2

Run each statement separately in the production Dashboard SQL Editor. They are
intended to fail and must not create rows. Use known test UUIDs only; replace
placeholders locally and do not retain them in evidence.

```sql
-- Browser-equivalent roles cannot call old or new privileged RPCs.
BEGIN;
SET LOCAL ROLE anon;
SELECT public.get_or_create_conversation('<user-a-uuid>', '<user-b-uuid>');
ROLLBACK;

BEGIN;
SET LOCAL ROLE authenticated;
SELECT public.increment_unread('<conversation-uuid>', 'p1_unread');
ROLLBACK;

BEGIN;
SET LOCAL ROLE authenticated;
SELECT public.chat_send_message('<conversation-uuid>', '<user-a-uuid>', 'denial-check');
ROLLBACK;
```

For direct RLS-write denial, use a database session configured with a test
user’s actual JWT claims; `SET ROLE authenticated` alone does not establish
`auth.uid()`. Attempt a direct `INSERT` into `public.conversations` and a direct
`INSERT` into `public.messages`. Both must be denied. If the Dashboard cannot
set a verified test JWT context, perform this exact check with a disposable
authenticated API client against production and retain only HTTP status/error
code; do not fabricate the claim context.

**Proceed only with evidence:** every privileged RPC is denied for browser roles,
direct conversation/message writes are denied, and row counts before/after are
unchanged.

**Stop:** any call/write succeeds, returns an unexpected row, or changes count.
Treat as a security incident: stop rollout, preserve evidence, restrict access,
and investigate before further use.

## 8. Final backend and preservation verification

Repeat the new-backend smoke tests in section 5 after Phase 2. Then run:

```sql
SELECT count(*) AS conversations_after FROM public.conversations;
SELECT count(*) AS messages_after FROM public.messages;

-- Existing pre-Phase-2 test conversation must remain readable through the API;
-- compare its stored ID/message IDs to the pre-Phase-2 record.
SELECT id, conversation_id, sender_id, created_at
FROM public.messages
WHERE conversation_id = '<pre-phase-2-test-conversation-uuid>'
ORDER BY created_at, id;

SELECT indexname, indexdef
FROM pg_indexes
WHERE schemaname = 'public' AND tablename = 'messages'
  AND indexname = 'idx_messages_conversation_created_id';
```

**Proceed only with evidence:** original conversation/message IDs still exist;
no unexpected delete/update occurred; final start/send/read works; and logs are
clean for the final test window.

**Stop:** history missing, IDs changed, API fails, direct writes succeed, or
permissions differ from expected. Do not make emergency data edits.

## Rollback

### Before Phase 2

Database state is additive. If the new backend fails after Phase 1:

1. Stop the rollout; do not apply Phase 2.
2. Roll back Railway to the previously verified backend release using Railway’s
   release controls (or redeploy the prior reviewed commit through the approved
   Railway process).
3. Confirm old-backend smoke tests work while Phase 1 functions/policies remain.
4. Keep the Phase 1 snapshot and Railway logs. Do **not** drop the new RPCs
   during the incident; they are additive and harmless when service-only.

### After Phase 2

Do **not** deploy the old backend: it depends on direct writes/old RPCs now
revoked. First keep or restore the new backend. If rollback is unavoidable,
create and review a separate emergency SQL plan that restores only the exact old
grants/policies required by the prior backend and validates current data against
the Phase 2 constraints. Do not remove constraints, delete messages, or apply
ad-hoc grants under pressure. Escalate with the saved snapshots and logs.

## Evidence checklist

Before moving to each next stage, retain:

1. release SHA, migration hashes, branch/status, and local test output;
2. before/after schema, policies, function definitions/grants, constraints, and
   index snapshots;
3. preflight count results and metadata mismatch count;
4. old-backend Phase 1 smoke-test records;
5. successful Railway deployment revision and health evidence;
6. new-backend API statuses, anonymized IDs/timestamps, and corresponding log
   window;
7. Phase 2 execution result and browser-role denial evidence; and
8. final preservation counts/IDs and final API smoke evidence.

Missing evidence is a stop condition, not a reason to proceed.
