# Gymvyn direct-message schema verification

> Historical note: Gymvyn Plans Phase 0 removed marketplace purchases as a
> messaging eligibility path. Marketplace findings below describe the legacy
> implementation and must not be read as current behavior.

**Verified:** 2026-07-17 against configured Supabase project `jaxnqttycxeavwhcsoyv`, using catalog queries and aggregate SELECTs only. No data, schema, policy, function, publication, deployment, or application behavior was changed.

## 1. Executive summary

The production direct-message schema is more complete than the repository audit could prove, but it contains serious authorization drift.

- `conversations` has participant FKs to `auth.users`, canonical-order creation RPC logic, an ordered-pair unique constraint, and indexes. It has **no** self-pair check, no unordered-pair constraint, no lifecycle/soft-delete field, no `updated_at`, and no triggers.
- `messages` has an FK to `conversations`, but `sender_id` has no FK and no constraint/trigger requiring sender participation. It has no `read_at`, `message_type`, `updated_at`, attachment, metadata, or delete field.
- Both `get_or_create_conversation(uuid,uuid)` and `increment_unread(uuid,text)` are `SECURITY DEFINER`, owned by `postgres`, and executable by `PUBLIC`, `anon`, and `authenticated`. `get_or_create_conversation` takes arbitrary IDs and performs no `auth.uid()`/relationship validation. Any authenticated direct database caller can create a conversation for arbitrary users, including self-chat. Backend `canMessage()` protects the HTTP route, but not the public RPC.
- `increment_unread` updates obsolete `client_unread`/`trainer_unread` columns that do not exist in production `conversations`; valid `p1_unread`/`p2_unread` calls are silently ignored. This explains why the trainer plan-assignment unread update is ineffective.
- Chat RLS permits direct participant SELECT and direct participant conversation INSERT/UPDATE plus sender INSERT into messages. It checks historical participant membership only, never active trainer/gym/buddy eligibility. `messages` is not currently in the Realtime publication, so the abandoned direct Realtime component cannot receive database changes today; adding it later without policy redesign would expose stale pairs.
- Current data is small (11 conversations/11 messages), clean for duplicates/orphans/self-chat, but 5 conversations have no messages and 6 stored previews/timestamps do not match the latest message. Of 11 conversations, 9 have neither an active trainer-client nor a non-cancelled marketplace relationship; gym/buddy eligibility was not fully calculated in this query, so those nine are not automatically invalid.
- `buddy_requests` is a real gym-buddy request model, not general friendship: statuses are only `pending`, `accepted`, `declined`; two of four rows have null `gym_id`; no remove/block state or uniqueness protects duplicate/reverse requests.

## 2. Access method and safety confirmation

**Verified production/database facts** came from the connected Supabase management SQL interface, the PostgREST OpenAPI schema, `pg_catalog`, `information_schema`, `pg_policies`, `pg_publication_tables`, and aggregate/read-only joins. Queries used only `SELECT`/CTEs. No private message body, user name, email, phone, or secret is recorded here.

**Repository-only facts** are labelled where compared with `docs/chat-system-audit.md`, `routes/chatRoutes.js`, and `src/utils/canMessage.js`.

**Unknown:** no query was run as an `anon`/`authenticated` end-user session, so policy behavior is verified from policy text, not end-to-end JWT simulation. PostgreSQL catalog reports publication membership empty for target tables.

## 3. Verified schema definitions

All target tables are `public`, owned by `postgres`, have RLS enabled and not forced, and have table grants to `anon`, `authenticated`, and `service_role` (RLS still controls non-bypass roles). No generated columns or non-internal triggers exist on `conversations` or `messages`.

| Table | Production columns / constraints / indexes | Verified conclusion and recommended migration action |
|---|---|---|
| `conversations` | `id uuid PK default gen_random_uuid()`; `participant_1_id uuid NOT NULL FK auth.users ON DELETE CASCADE`; `participant_2_id` same; nullable `last_message_at timestamptz`, `last_message_preview text`, `p1_unread integer default 0`, `p2_unread integer default 0`, `created_at timestamptz default now()`. Unique `(participant_1_id,participant_2_id)`; indexes on each participant; no check constraints/triggers. | Fields verified. No `updated_at`, status/archive/delete field, no-self check, canonical-order check, unordered-pair uniqueness, or pagination/last-message index. Add only after cleanup/backfill and RPC repair. |
| `messages` | `id uuid PK default gen_random_uuid()`; `conversation_id uuid NOT NULL FK conversations(id)` (no cascade clause shown, therefore default NO ACTION); `sender_id uuid NOT NULL` **without FK**; `content text NOT NULL`; nullable `created_at timestamptz default now()`. Only PK index; no checks/triggers. | No `updated_at`, `read_at`, `message_type`, `deleted_at`, attachment, metadata, content-size check, sender-participant trigger, or pagination index. Add integrity/index constraints after data validation. |
| `buddy_requests` | `id uuid PK`; `sender_id`,`receiver_id` NOT NULL FKs to `auth.users` ON DELETE CASCADE; `status text NOT NULL default pending`, check limited to `pending/accepted/declined`; `created_at NOT NULL`; nullable `gym_id uuid FK gyms(id)`. Index only `gym_id`. | Directional model and gym FK verified. No FK action shown for gym, no updated/deleted fields, no unique/directional/reverse request prevention, no block/remove status. Preserve/assess its four rows before social migration. |
| `trainer_clients` | FKs: trainer/client → `users` CASCADE; gym → `gyms` SET NULL. Status check only `pending/active/paused/removed`; `invited_via` check code/link/gym_assign/qr. Partial unique `(trainer_id,client_id)` for `pending` or `active`; indexes per participant. | Repository references to accepted/approved/linked/rejected/expired are impossible in production due to check constraint. Normalize source constants to actual status set. |
| `trainer_profiles` | `user_id` unique FK users CASCADE; `gym_id` FK gyms CASCADE; `pending_gym_id` FK gyms; `is_active boolean NOT NULL default true`; nullable `status text default active`; unique trainer code/invite code indexes. | `status` has no check constraint. Current chat checks `is_active`, not status; use one authoritative predicate. |
| `gyms` | `owner_id` FK users; `is_active boolean NOT NULL default true`; subscription fields and codes. | Current `canMessage()` does not require `gyms.is_active`; decide whether inactive gym must revoke messaging. |
| `gym_memberships` | users CASCADE, gyms CASCADE, assigned trainer SET NULL; status check `active/inactive/frozen/expired/cancelled`; partial unique active `(gym_id,user_id)`; indexes user/gym/status/end date/trainer. | Active row uniqueness is already protected; code must also decide whether expired `end_date` invalidates `status='active'`. |
| `gym_staff` | users/gyms/invited_by FKs; unique `(gym_id,user_id)`; `is_active NOT NULL default true`; no update timestamp. | No duplicate user/gym rows possible. |
| `marketplace_purchases` | Versioned migration matches production columns and check: pending_confirmation/payment_confirmed/delivered/disputed/resolved_confirmed/resolved_rejected/cancelled; FKs buyer/seller users, listing, admin resolver. | No rows exist. Current `status <> cancelled` chat rule would grant all non-cancelled states if data arrives. |
| `users` | PK `id`; role check consumer/gym_owner/gym_member/trainer/staff; is_active default true; `gym_id` FK. | No email column, matching project instruction. |

OpenAPI/catal​og search found no table named or shaped as friendship, block, blocked-user, notification, message-read, attachment, conversation-participant, typing, or presence. `user_flags` exists but is user moderation/flag data, not a block relationship. This is a **verified absence among exposed public tables**, not proof of a private-schema/external service.

## 4. Verified functions and triggers

| Function | Production definition/security | Risk / migration action |
|---|---|---|
| `get_or_create_conversation(uuid,uuid) → uuid` | `plpgsql`, `SECURITY DEFINER`, owner `postgres`, no explicit search_path config, executable by PUBLIC/anon/authenticated. It lexically orders input IDs, selects existing ordered pair, else inserts and returns. | No caller `auth.uid()` or relationship validation; allows arbitrary pair/self direct RPC calls; select-then-insert has race/unique-violation risk. Revoke PUBLIC/anon/authenticated and expose only a correctly authorized server path or replace with a safe security-definer function with fixed search_path, auth check, self rejection, conflict-safe insert. |
| `increment_unread(uuid,text) → void` | `plpgsql`, `SECURITY DEFINER`, owner postgres, PUBLIC/anon/authenticated executable. If `field_name='client_unread'` or `trainer_unread`, updates that named column. | Production table has only `p1_unread`/`p2_unread`; function calls with current backend fields silently do nothing. It uses an obsolete dynamic selector model and has no caller check. Replace/revoke; use an atomic, fixed-column message transaction. |
| `auth_gym_id()`, `auth_role()` | SQL, stable SECURITY DEFINER, PUBLIC executable; select caller row through `auth.uid()`. Used by gym RLS policies. | No fixed search_path config. Treat as RLS support functions and harden search_path/grants during baseline migration after full policy regression tests. |

No chat-table triggers or trigger functions exist. No chat notification/realtime function exists. Function bodies above are summarized rather than copied in full; no secrets were present.

## 5. Verified RLS and Realtime configuration

| Object | Direct authenticated policy effect | Security conclusion |
|---|---|---|
| `conversations` | SELECT if historical participant (duplicated participant SELECT policies); INSERT if caller is either supplied participant; UPDATE if participant; no DELETE policy. | Direct client can create a conversation involving self and arbitrary other user, and participant can modify any conversation columns. No current eligibility check. |
| `messages` | SELECT if historical conversation participant (two duplicate SELECT policies); INSERT if `auth.uid()=sender_id`; no UPDATE/DELETE. | Sender can insert into **any conversation ID** without being a participant. This is a confirmed DB-level authorization gap. |
| `buddy_requests` | Participant SELECT; sender INSERT/update/delete; receiver update with receiver-only check. | No block/duplicate control; sender update lacks `WITH CHECK`, so reassignment risk must be tested/hardened. |
| `trainer_clients`, `trainer_profiles`, `gym_memberships`, `gym_staff`, `gyms`, `marketplace_purchases` | Policies match catalog query; all RLS enabled/not forced. Several use `auth_role()`/`auth_gym_id()`. | Service-role backend bypasses RLS. Policy text proves most relationship tables do not by themselves express chat eligibility. |

`pg_publication_tables` returned no `supabase_realtime` membership for conversations, messages, or any target/chat-support object. Therefore database-change Realtime is currently disabled for direct chat tables. A stale participant cannot currently receive message changes through publication, but would be able to SELECT historical messages and would become a Realtime exposure if publication were enabled without policy redesign.

## 6. Conversation integrity counts

| Check | Count | Status |
|---|---:|---|
| Total conversations | 11 | Verified |
| Null participants / self conversations / unordered duplicates / noncanonical order | 0 / 0 / 0 / 0 | Clean currently; no database check prevents future self pairs. |
| Negative or null unread counters | 0 / 0 | Clean currently. |
| No messages | 5 | Expected only if intentionally empty; review before lifecycle migration. |
| Preview/timestamp differs from latest message | 6 | Confirmed denormalized data drift. |
| No active trainer-client or non-cancelled marketplace relation | 9 | Not proof of invalidity: gym/buddy relation was not combined in this aggregate. |

## 7. Message integrity counts

All 11 messages have a conversation, existing auth sender, participant sender, nonempty trimmed content, and `created_at`; all are 0–500 characters. No conversation has over 50 or 500 messages. No production columns exist for `message_type` or `read_at`, so usage count is not applicable.

## 8. Trainer relationship counts

- `trainer_clients`: active 6, removed 2; no other statuses; no duplicate pairs, multiple active pairs, or null client IDs.
- `trainer_profiles`: 9 total; all observed `status='active'` and `is_active=true`; 4 have gym IDs and 5 have null gym IDs. No observed active/status contradiction.
- Actual schema allows only pending/active/paused/removed, disproving repository helper claims that accepted/approved/linked/rejected/expired can occur.

## 9. Gym relationship counts

- `gym_memberships`: active 41, frozen 1, expired 2, inactive 4. No duplicate active user/gym rows; no user has active rows in multiple gyms.
- **25 active memberships have `end_date < current_date`**. Current `canMessage()` uses only `status='active'`, so those stale/expired-by-date rows currently grant gym chat.
- `gym_staff`: 4 active, 0 inactive; no duplicate gym/user pairs.
- `trainer_profiles.gym_id` is the only exposed gym-trainer relationship table; no separate `gym_trainers` table exists.

## 10. Buddy/friend/block findings

`buddy_requests`: pending 3, accepted 1; 2 rows have null gym IDs; no directional or reverse duplicate pair; accepted stale membership 0. Accepted rows are not structurally forced gym-specific, so the current application correctly rejects accepted null-gym rows but direct RLS does not apply that condition. There are no friend remove/block states or block table.

## 11. Marketplace findings

`marketplace_purchases` has 0 rows. Thus 0 relationships currently grant chat via the existing `status <> 'cancelled'` predicate. The schema allows all seven known states; retain product decision before enabling marketplace chat at scale.

## 12. Current messaging eligibility impact

Verified exact: 6 active trainer-client rows, 4 active staff rows, 41 status-active memberships, 4 gym-linked active trainer profiles, 1 accepted buddy row, and 0 marketplace grants. Exact unique relationship-pair counts across combined owner/staff/member/trainer predicates and exact “listed but fails canMessage” count were not calculated because reproducing JavaScript’s full relationship logic in SQL would need a reviewed canonical predicate; do that as a dedicated read-only test query in the next task. Conversation duplicate pairs: 0.

## 13. Repository versus database mismatches

1. Prior audit’s “no participant FKs” and “message conversation FK unproven” are corrected: production has participant FKs to `auth.users` and message→conversation FK; `sender_id` still has no FK.
2. Production has unique ordered pair and canonicalizing RPC; no unordered constraint/check. Seed scripts using `trainer_id/client_id` remain stale.
3. Repository migration `chat_rls_policies.sql` expects no authenticated writes, but production additionally has direct conversation INSERT/UPDATE and message INSERT policies.
4. Frontend fields `read_at` and `message_type` do not exist in production.
5. `increment_unread` is a production function absent from migrations and targets obsolete nonexistent columns.
6. Core chat RPCs/functions/policies/constraints are production-only and must be captured into baseline version control.

## 14. Immediate security risks

1. PUBLIC `SECURITY DEFINER` `get_or_create_conversation` bypasses backend `canMessage()` and RLS relationship policy.
2. Direct message INSERT policy requires only sender identity, not conversation participation.
3. Direct conversation INSERT/UPDATE policies permit participant-controlled arbitrary pairs/metadata/counters.
4. All chat RLS uses historical participation, not active relationship eligibility.
5. Stale status-active memberships past `end_date` grant current application chat access.

## 15. Immediate integrity risks

- Public RPC self chat; lack of no-self constraint.
- RPC race causes possible unique violation under concurrent first start.
- Broken unread RPC plus non-transactional JS counter update; preview/timestamp drift already affects 6 conversations.
- No sender FK/participant guard, content size constraint, message pagination index, or message lifecycle fields.

## 16. Recommended migration sequence

**A — baseline:** version exact production definitions/policies/indexes/functions first; no behavior change.

**B — emergency hardening:** revoke public/anon/authenticated execute from both chat RPCs; remove direct chat INSERT/UPDATE policies or replace them with a single proven authorization path; fix unread implementation. These require backend route regression tests before deploy.

**C — integrity:** after confirming zero incompatible rows, add self check; retain canonical ordering; replace unique ordered pair with/alongside canonical unordered guarantee; add `messages.sender_id → auth.users` FK only after deletion/reference analysis; add sender-participant trigger or atomic send function; add `(conversation_id, created_at, id)` index and bounded content check.

**D — lifecycle:** make gym active/date and trainer status predicates explicit; implement staff↔staff/trainer↔member in server gate; filter lists; decide archived read-only history and marketplace states.

**E — social/delivery:** retain `buddy_requests` only as gym-buddy source; add dedicated canonical friendship and `user_blocks` only after product decision; replace counters with participant read state and use polling until Realtime authorization is safe.

## 17. Required cleanup before constraints

- Reconcile the 6 preview/timestamp mismatches and classify/remove or retain 5 empty threads.
- Decide 25 membership rows with active status but past end date; change policy only through approved migration/process, never ad hoc.
- Backfill/reconcile sender FK only after confirming referenced auth users; current orphan count is zero.
- Before unique social constraints, decide how null gym IDs and declined/pending buddy records should migrate; current duplicates are zero.

## 18. Open product decisions

1. Does date expiry override `gym_memberships.status='active'` for messaging immediately?
2. Should historical messages be readable after unlink, and how does block/moderation change that?
3. Is marketplace chat intended, and which purchase states qualify?
4. Is buddy gym-only forever, or should a separately named friendship model be built?

## 19. Exact next Codex task

> Stay on main. Read AGENTS.md. Do not run migrations or deploy. Add a focused, disposable-environment chat authorization test suite that proves direct Supabase/RPC access cannot bypass active relationship checks, then prepare—not apply—a migration proposal to revoke public chat-RPC execution, eliminate unsafe direct chat write policies, repair unread updates, and enforce sender participation. Include regression tests for active, stale, self, forged conversation, gym expiry, and public-RPC calls.

## 20. Queries and commands run

- Read `AGENTS.md`, prior audit, branch/status; remained on `main` with pre-existing unrelated changes untouched.
- Read-only Supabase REST/OpenAPI introspection and `supabase_list_tables`.
- Read-only catalog queries: `pg_class`, `pg_attribute`, `pg_attrdef`, `pg_constraint`, `pg_indexes`, `pg_trigger`, `pg_proc`, `pg_policies`, `information_schema.role_table_grants`, `pg_publication_tables`.
- Read-only aggregate duplicate/orphan/status/content-size/relationship-date queries.
- No tests were run: this task changes no code and validation was live read-only query verification.
