# Gymvyn chat-system architecture and code audit

**Audit date:** 2026-07-17
**Scope:** `/Users/artazayaz/Desktop/gymvyn-backend` and sibling `/Users/artazayaz/Desktop/gymvyn-frontend`, source and versioned migrations only. No production data, migrations, deploys, or application code were changed.

## 1. Executive summary

Gymvyn has a partly repaired direct-message system: one Express router (`routes/chatRoutes.js`) uses a service-role Supabase client and a shared `canMessage()` permission helper (`src/utils/canMessage.js`). It has four API endpoints: conversation list, message history/read, message send, contact discovery, and start/get-or-create. The normal member, owner, and staff UI uses a polling `src/pages/ChatWindow.jsx`; trainer has a separate full chat implementation. There is also an orphaned Supabase-Realtime chat component that is not imported by a page.

The backend has good protection against manually supplied recipient and conversation IDs on **start, read, and send**: it authenticates the bearer token, checks participant membership for a supplied conversation ID, and calls `canMessage()` again for reads and sends. Self-chat is blocked. This is not a complete product permission model, however.

Confirmed gaps:

- There is no blocking model, friend/friend-request API, or friend UI. `buddy_requests` is only referenced as an already-existing table; no creation/accept/reject/remove routes were found.
- Same-gym staff-to-staff and trainer-to-member messaging are **not** implemented, despite being required. `sharedGymId()` and `canMessage()` omit those pairings.
- Conversation listing exposes old conversations without a current `canMessage()` recheck. Opening them correctly returns 403 after unlinking, but users still see unusable contacts/conversations.
- The repository does not version the base schema for `conversations`, `messages`, `buddy_requests`, `trainer_clients`, `gym_memberships`, `gym_staff`, or `gyms`, nor the `get_or_create_conversation`/`increment_unread` functions. Their full constraints, RLS state, and production contents cannot be proven from this checkout.
- The active message route has no size limit, pagination cursor, transaction/RPC for unread increments, rate limit, attachment support, edit/delete, read receipts, notifications, or realtime delivery.
- The normal UI polls. Its explicit “Realtime” function is actually a 3-second interval. The separate direct-Supabase component has a real subscription but is dead and its RLS only checks participant status, not current relationship eligibility.

Do not treat chat as fixed. Preserve existing messages, retain the useful backend authorization pattern, and repair the canonical model in phases.

## 2. Current architecture

```text
Browser pages
  member / client, trainer, owner, staff
       | Bearer token via apiFetch
       v
Express: /api/chat (routes/chatRoutes.js)
  local auth() -> supabase.auth.getUser(token)
  service-role Supabase client (bypasses RLS)
       | canMessage() on create/read/send
       v
Supabase public tables: conversations <-> messages
  + relationship lookups: trainer_clients, gym_*, trainer_profiles,
    buddy_requests, marketplace_purchases

Delivery now: HTTP polling (messages every 3s while open; lists every 5s)
```

`server.js:5304` mounts the only people-chat router at `/api/chat`. `server.js:228` is unrelated legacy AI Coach HTTP chat at `/chat`; it must not be confused with direct messaging. `routes/assistantRoutes.js` also has separate `assistant_conversations`/`assistant_messages`, an owner-to-AI feature, not people chat.

The chat router creates its own authentication middleware rather than importing `middleware/auth.js`; both validate tokens through a service-role client. That duplication is not presently a bypass, but it can drift.

## 3. Database schema map

### Evidence limit

No baseline schema dump, Supabase migration history, or migration that creates the core direct-message/relationship tables is in this repository. The “exact” columns below are either present in versioned DDL or used by current code and comments claiming live-schema confirmation. Unknown means **unverified**, not absent from production. Before a redesign, export the production schema/constraints/functions/policies read-only and reconcile it into versioned migrations.

| Object | Purpose and known columns | FKs / uniqueness / lifecycle / RLS | Audit finding |
|---|---|---|---|
| `conversations` | Direct one-to-one thread. Runtime uses `id`, `participant_1_id`, `participant_2_id`, `p1_unread`, `p2_unread`, `last_message_at`, `last_message_preview`. | Current route comments say no FK from either participant column to `users.id`. No base DDL or unique pair constraint is versioned. `migrations/chat_rls_policies.sql` enables RLS and grants authenticated SELECT only to either participant. No soft-delete field is known. | Deduplication relies entirely on unversioned RPC `get_or_create_conversation`; concurrency/ordering/constraint cannot be verified. Old seed code still uses nonexistent `trainer_id`/`client_id`, proving schema drift. Listing does not filter current eligibility. |
| `messages` | Direct message rows. Runtime uses `id`, `conversation_id`, `sender_id`, `content`, `created_at`; UI assumes optional `read_at` and `message_type`, but backend comments say those do not exist in the real schema. | Route comments say no FK from `sender_id` to `users.id`; `conversation_id` FK is not proven. RLS migration grants participant SELECT only; no client write policy. No edit/delete/soft-delete column known. | No content length/type validation, attachment metadata, read receipt, retention/audit fields, or pagination index proven. Sender identity integrity cannot be proven without schema export. |
| `get_or_create_conversation(user_a,user_b)` RPC | Returns a conversation UUID after `canMessage()` passes. | Definition, SECURITY mode, canonical ordering, locking, and unique-index backing are not versioned. | Critical unverified dependency; must be inspected before relying on duplicate prevention. Do not replace until messages are mapped. |
| `increment_unread(convo_id,field_name)` RPC | Used only by trainer plan-assignment side effect. | Definition and field-name validation are not versioned. | Dynamic column name is a poor public RPC shape; message route uses non-atomic JS read-modify-write instead. |
| `trainer_clients` | Trainer/client link. Code uses `id`, `trainer_id`, `client_id`, `status`, `started_at`, `created_at`, `updated_at`. | Base FK/unique/checks/RLS unknown. `relationshipAuth.js` considers `active`, `accepted`, `approved`, `linked` active; chat accepts **only** `active`. Routes soft-remove by `status='removed'`. | Inconsistent active-status vocabulary across backend. Chat correctly blocks pending/removed/etc. if status is not exactly `active`, but this can diverge from relationship routes. |
| `trainer_profiles` | Trainer identity and gym affiliation. Chat uses `user_id`, `gym_id`, `is_active`; migration adds `status`, `is_active`, `full_name`; join-request migration adds `pending_gym_id`. | `pending_gym_id` and `gym_id` reference `gyms(id)` in versioned migration for pending field only. Base uniqueness/RLS unknown. | `canMessage()` only checks `is_active=true`, not profile `status='active'`; stale/disabled status may still grant chat if `is_active` is left true. |
| `gyms` | Gym owner relationship. Chat uses `id`, `owner_id`. | Base DDL/RLS unknown. | Owner has no explicit active/deleted state checked by chat. If a gym has a soft-delete/status field, it is ignored. |
| `gym_staff` | Staff-to-gym relation. Chat uses `gym_id`, `user_id`, `is_active`; other routes use `id`, `role_label`, `created_at`. | Base FKs/unique/RLS unknown. | `is_active=true` is correctly required, but staff↔staff is missing. Candidate discovery reads inactive rows then filters later (wasteful but not authorization bypass). |
| `gym_memberships` | Member-to-gym relation. Chat uses `gym_id`, `user_id`, `status`. Other code uses membership/payment/date fields. | `member_import_claiming_foundation.sql` adds `imported_member_id`; creates partial unique index `uniq_gym_memberships_one_active_per_user (gym_id,user_id) WHERE status='active'`. Base FKs/RLS unknown. | Chat correctly requires `status='active'`. Historical inactive rows remain; candidate discovery reads them but `canMessage()` filters them. |
| `buddy_requests` | Opt-in same-gym member-member permission. Chat uses `sender_id`, `receiver_id`, `status`, `gym_id`. | `migrations/add_gym_id_to_buddy_requests.sql` adds nullable `gym_id REFERENCES gyms(id)` and a non-unique index. Base FKs/unique/status check/RLS/created fields unknown. | Only `status='accepted'` plus both active memberships at that same `gym_id` grants member↔member chat. No API/UI creates or manages it. Pre-migration accepted rows with null `gym_id` cannot chat. No block precedence. |
| `marketplace_purchases` | Purchase link, unexpectedly also a chat grant. Versioned DDL contains `id`, listing/buyer/seller IDs, status, confirmations, timestamps. | FKs to users/listing; indexes on buyer/seller/listing/status; RLS grants buyer/seller read and broad buyer-or-seller update. Status enum: `pending_confirmation`, `payment_confirmed`, `delivered`, `disputed`, `resolved_confirmed`, `resolved_rejected`, `cancelled`. | `canMessage()` permits any status except `cancelled`, including pending, disputed, and resolved-rejected. This is undocumented in the requested product model and needs a deliberate product decision. |
| `assistant_conversations`, `assistant_messages` | Owner-to-Gymvyn AI conversations; unrelated to people chat. Versioned migration defines conversation `id,gym_id,owner_id,title,context_summary,created_at,updated_at`; messages `id,conversation_id,role,content,is_compacted,created_at`. | FKs/cascade and owner RLS are versioned; cron compacts/deletes summarized AI messages. | Keep separate. Do not merge with direct messages or apply people-chat retention rules blindly. |
| Blocking/friends/message reads/attachments/typing/notifications tables | No table, migration, route, or frontend implementation found for `blocks`, friendships, friend requests, per-message reads, attachments, typing, or chat notifications. | N/A | Required capabilities must be introduced only after a schema export confirms no differently named production equivalent exists. |

## 4. Relationship and permission map

### Canonical current gate

`src/utils/canMessage.js:132` is the direct-message policy used by `POST /start`, `GET /messages/:conversationId`, and `POST /message`. It returns false for blank IDs or `userA === userB`. Its checks are symmetric because each pair direction is queried or set intersections are reversed.

| Current relationship | Exact active condition | Implemented | Product result |
|---|---|---:|---|
| Trainer ↔ client | Any `trainer_clients` row with exactly `status='active'` in either direction | Yes | Correctly symmetric and stale rows with other statuses are blocked. |
| Marketplace buyer ↔ seller | Any `marketplace_purchases` row where `status != 'cancelled'` | Yes, undocumented | Cross-gym grant; needs decision and tighter terminal/status semantics. |
| Owner ↔ staff | Owner of same `gyms.id`; staff `gym_staff.is_active=true` | Yes | Correct. |
| Owner ↔ member | Owner of same gym; member `gym_memberships.status='active'` | Yes | Correct. |
| Owner ↔ gym-affiliated trainer | Owner of same gym; `trainer_profiles.is_active=true` and `gym_id` match | Yes | Correct only if `is_active` is reliable. |
| Staff ↔ member | Active staff and active member at same gym | Yes | Correct. |
| Staff ↔ trainer | Active staff and `is_active` trainer profile at same gym | Yes | Correct. |
| Staff ↔ staff | Same active `gym_staff` gym | **No** | Confirmed missing from `canMessage()` and `sharedGymId()`. |
| Trainer ↔ member | Trainer profile and active member at same gym | **No** | Confirmed missing from `canMessage()` and `sharedGymId()`. |
| Member ↔ member | Both active members in `buddy_requests.gym_id`, request exactly `accepted` | Yes, opt-in | This is gym-buddy, not general friendship. |
| Friends | No table/API/check | **No** | Not implemented. |
| Block override | No table/API/check | **No** | Not implemented; cannot override any grant. |

`candidateContactIds()` (`routes/chatRoutes.js:215`) gathers a deliberately loose candidate superset from all trainer links, all same-gym rows, and buddy rows. `/contacts` calls `canMessage()` per candidate, so its final allow decisions align with start/send/read. It executes `Promise.all` for every candidate and then calls `getGymContexts()` once per returned contact: N+1-like relationship querying that will grow badly at larger gyms.

### Authorization lifecycle

| Operation | Current server enforcement | Result |
|---|---|---|
| Discover contacts | Token then `canMessage()` per candidate | Safe decision, slow; no blocks/friends. |
| Create/reuse conversation | Token, reject self, `getOrCreateConversationIfAllowed()` → `canMessage()` then RPC | Recipient-ID tampering is blocked unless a real permitted relationship exists. RPC internals unverified. |
| List conversations | Token and participant SQL filter only | **Defect:** stale/unlinked/blocked-in-future threads remain visible; no current permission recheck. |
| Read history | Token, retrieve conversation, require participant, then `canMessage()` | Conversation-ID tampering blocked; history becomes unreadable immediately after link ends. |
| Mark read | Same as history, then updates caller's unread field | Authorization precedes update, but no per-message read receipt. |
| Send | Token, conversation participant check, then `canMessage()` | Conversation-ID tampering blocked; relationship rechecked. |
| Realtime (active page) | No realtime subscription; polling calls protected history endpoint | Protected indirectly. |
| Realtime (dead component) | Direct Supabase subscription protected only by participant RLS policy | Unsafe for the intended current-eligibility rule; it can subscribe to stale history while participant remains. |

The required security matrix was inspected statically, not executed against a dedicated chat fixture:

1. Unrelated user: would fail `canMessage()` in start/read/send; **not test-covered**.
2–3. Active trainer/client: allowed by `isLinkedTrainerClient`; **not test-covered**.
4. Removed trainer/client: rejected because only `active` matches; **not test-covered**.
5. Same-gym pairs: owner-staff/member/trainer and staff-member/trainer allowed; staff-staff and trainer-member rejected (confirmed code defect).
6. Different gyms: rejected unless trainer-client, marketplace, or buddy predicate applies.
7–10. Accepted friends/pending/removed/blocked: no friend/block system; cannot meet requirement. Accepted gym buddy only works with current active same-gym membership.
11. Self-chat: explicitly rejected in both `canMessage()` and `/start`.
12. Forged conversation/recipient ID: protected on start/read/send; list cannot be supplied an ID. No automated test exists.

## 5. Backend route inventory

| Method/path | File; auth | Request / response | Tables / authorization | Status |
|---|---|---|---|---|
| `GET /api/chat/conversations` | `routes/chatRoutes.js:25`; local bearer-token `auth` | No params; returns raw conversation columns plus `other_user:{id,full_name,role}` and caller `unread` | `conversations`, then `users`; SQL participant filter only | Frontend uses it. No pagination; stale conversations visible; safe against nonparticipants but incomplete. |
| `GET /api/chat/messages/:conversationId` | `:75`; local auth | UUID path; returns up to 50 ascending raw messages plus `sender` | `conversations`, `messages`, `users`; participant then `canMessage()`, resets caller counter | Frontend uses it. No cursor/older-history access; relationship end hides history. |
| `POST /api/chat/message` | `:140`; local auth | `{conversationId,content}`; returns inserted message + sender | `conversations`, `messages`, `users`; participant then `canMessage()` | Frontend uses it. No max length/rate limit/transaction; concurrent sends can lose unread increments; no attachment/edit/delete. |
| `GET /api/chat/contacts` | `:259`; local auth | No params; returns allowed `{id,full_name,role,gym_id?}` | all current relationship tables plus `users`; `canMessage()` per candidate | Frontend uses it. No search/pagination; expensive at gym scale. |
| `POST /api/chat/start` | `:303`; local auth | `{targetUserId}`; returns `{conversationId}` | RPC + all relations through `canMessage()` | Frontend uses it. Recipient forging protected; duplicate behavior is unverified RPC implementation. |
| `POST /chat` | `server.js:228`; normal auth | AI message/history/profile; AI response | No people-chat tables | Existing frontend `src/pages/Chat.jsx`; separate legacy AI Coach, not direct chat. |
| `GET/POST /api/assistant/...` | `routes/assistantRoutes.js` | AI assistant conversations/messages | assistant tables | Separate product; exclude from direct-chat redesign. |

No people-chat routes were found for edit/delete, read receipts, unread summary, attachments/upload/download, search, block, friends, notification delivery, typing, websocket tokens, or subscription authorization.

`routes/trainerRoutes.js:486` is a non-route chat write side effect when assigning a plan. It reuses `getOrCreateConversationIfAllowed`, inserts a plain text message, updates preview/time, and calls unversioned `increment_unread`. It uses no transaction and ignores some write errors. Its rich `message_type='plan_share'` UI intent is unsupported by the actual schema.

## 6. Frontend route/component inventory

| Role / path | Page and implementation | Current behavior / audit result |
|---|---|---|
| Member `/client/chat` | `src/pages/ClientChatPage.jsx` + active `src/pages/ChatWindow.jsx` | First calls `/api/trainer/my-trainer/:user.id`, then auto-starts a trainer conversation; also has a duplicated contact picker permitting all `/contacts`. Has skeleton/empty states; logs errors rather than showing initial load/send errors. Fixed `calc(100vh - 64px)` attempts to keep composer above bottom nav. |
| Trainer `/trainer/chat`, `/trainer/chat/:convoId` | `src/pages/TrainerChatPage.jsx` | Separate ~700-line list/thread/composer/picker implementation, polling conversation list only. It loads messages only on selection and after send; no live incoming message polling while thread stays open. Query code looks for `convoId`, while links such as `TrainerClientDetail.jsx` use `/trainer/chat` or `?clientId=...`; clientId preselection is not implemented. Optimistic message is retained on failed send (it clears input and only logs), until another load overwrites it. |
| Gym owner `/gym/chat` | `src/pages/gym/GymChatPage.jsx` + active `pages/ChatWindow.jsx` + `components/chat/ContactPicker.jsx` | Polls conversation list every 5 seconds; shared window polls messages every 3 seconds. Has loading/empty but silent contact/start failures. Active thread uses `h-screen` even though this page renders `GymBottomNav`; composer can again be behind bottom nav (unlike member/staff workaround). |
| Staff `/staff/chat` | `src/pages/staff/StaffChatPage.jsx` + active window + shared picker | Same pattern; fixed 64px height mitigation. No staff-staff contacts because backend denies them. Silent contact/start failures. |
| Marketplace listing | `src/pages/MarketplaceListingDetail.jsx` + active window | Starts chat with seller after a marketplace purchase path. This relies on marketplace being a messaging grant. |
| Dead realtime component | `src/components/chat/ChatWindow.jsx` | Implements direct Supabase `postgres_changes` INSERT subscription, `chatFetch`, own composer and UI. No page imports it (`rg` found only its definition). It should not be revived without current-eligibility-safe realtime policy/token design. |
| Shared picker | `src/components/chat/ContactPicker.jsx` | Used by owner/staff only. Client/trainer maintain copied picker UIs. No search, relationship labels, block/friend UI, error state, or accessibility focus handling. |

Additional frontend facts:

- `src/pages/ChatWindow.jsx` labels the 3-second polling function `subscribeRealtime`; it is not Realtime.
- It always displays “Online” without presence data.
- It attempts plan-share/read status rendering (`message_type`, `read_at`) unsupported by documented live schema.
- Both active chat windows fetch only the newest 50 messages. There is no pagination, attachment UI, delete/edit, typing, unread global badge, notification UI, or block/friend UI.
- All role pages rely on server authorization; their role/picker filtering is UX only, which is correct in principle. Directly modifying a route payload should still be rejected by the backend.
- Unbounded 3/5-second polling causes overlapping requests; there is no abort, request sequence guard, visibility pause, or focus refetch strategy. Responses can arrive out of order and overwrite newer UI state.

## 7. Realtime architecture

**Used by live people-chat pages:** polling only.

- `pages/ChatWindow.jsx`: `GET /api/chat/messages/:id` immediately and every 3 seconds while mounted. The same GET marks the thread read every time.
- `GymChatPage`, `StaffChatPage`, and `TrainerChatPage`: `GET /api/chat/conversations` every 5 seconds. `ClientChatPage` does not list/poll conversations.
- The active window has normal effect cleanup (`clearInterval`). It has no visibility optimization, exponential backoff, retry/error UI, abort signal, dedupe of overlapping fetches, or multi-device reconciliation beyond next poll.

**Abandoned direct-Supabase implementation:** `src/components/chat/ChatWindow.jsx` subscribes to `supabase.channel('chat:'+conversationId).on('postgres_changes', { table:'messages', filter:'conversation_id=eq.<id>' })`, then removes the channel in effect cleanup. It has basic ID dedupe and reconnect is delegated to Supabase client defaults. It has no subscription-status handling, backfill-on-reconnect, sender enrichment, conversation-list update, read updates, or explicit eligibility token.

`migrations/chat_rls_policies.sql` grants direct SELECT to anyone still listed as a conversation participant. It does **not** call `canMessage()` or check active gym/trainer/buddy state. Therefore, a stale participant could read historical messages and possibly receive Realtime changes if any direct/database writer inserts them. The backend service role bypasses these policies by design. Do not use this RLS policy as the authorization model for Realtime.

Polling can miss only transient UI updates until the next fetch; because it retrieves persisted history, it does not permanently miss successfully stored messages. It can duplicate visual messages briefly around optimistic sends and has race/out-of-order overwrite risk. It works across devices only with 3–5 second delay and while the app/page is active.

## 8. Friend and gym-buddy architecture

No general friends, friend requests, followers, blocks, or user-discovery feature was found in either repository. The only social relationship is the partially present `buddy_requests` table referenced by chat. It is a same-gym-only opt-in gate: an accepted row must carry the specific `gym_id`, and both people must remain active members of that gym at message time.

This can be reused only as a **migration source** if product calls it “friends.” It is not ready to be a safe friendship layer because its lifecycle routes/UI/constraints/RLS/status vocabulary are absent from source, it is gym-scoped, it lacks blocking, and duplicate/directional request guarantees are unknown. Do not create a second social system until production schema confirms whether `buddy_requests` is in use and what its existing data means.

## 9. Notification audit

No incoming-direct-message notification integration exists. The only chat indicator is `p1_unread`/`p2_unread` in conversation rows, reset when history is fetched and incremented by a send/plan-assignment write. No browser Notification API, Web Push, push-token table/service, email sender, notification table, queue/job, or chat unread badge outside conversation rows was found. Gym settings have generic `notifications` configuration, but no chat code consumes it.

## 10. Current working functionality

- Authenticated users can list conversations in which they are participants.
- Active trainer-client pairs can create/read/send direct messages; both directions share the symmetric gate.
- Owner↔staff, owner↔member, owner↔gym trainer, staff↔member, and staff↔gym trainer same-gym pairs can do the same when active fields match.
- Accepted same-gym buddies can message if their relationship row has a matching gym ID and both memberships are still active.
- Start, history, and send reject self-chat and unauthorized manipulated IDs.
- The active member/staff/owner pages poll and offer basic text composition; frontend build succeeds.

## 11. Confirmed broken or incomplete functionality

1. Staff↔staff and gym trainer↔gym member are required but omitted from the backend permission map.
2. Friend requests, accepted friends, reject/remove/block, and block override are absent.
3. Existing conversations remain listed after permission ends, but opening them fails. Current behavior hides all history after unlinking because history calls `canMessage()`.
4. Owner chat's `h-screen` layout conflicts with its bottom navigation, reopening the known hidden-composer risk.
5. Trainer is a duplicate implementation and does not poll an open thread for incoming messages; all normal polling windows do.
6. No message loading errors are surfaced in active `pages/ChatWindow.jsx`; owner/staff also silently swallow contact/start errors.
7. Direct Supabase Realtime component is orphaned and unsafe for current eligibility semantics.
8. UI supports fields that the backend says do not exist (`message_type`, `read_at`); plan assignment cannot render a real plan-share message.
9. Old `scripts/seed-test-ecosystem.js` still queries/inserts obsolete `conversations.trainer_id` and `.client_id`; its chat seed/cleanup is broken against current schema.

## 12. Security vulnerabilities and integrity risks

### Security/product authorization

- **High:** no block model means abusive/blocked relationship override is impossible.
- **High:** direct Realtime RLS protects only participant status, not current eligibility; do not expose/revive it.
- **Medium:** conversation list leaks continuing presence/name/preview of stale relationships. It does not expose message bodies through protected history, but violates the intended “only see eligible contacts” rule.
- **Medium:** marketplace purchase grants chat for every non-cancelled status, including disputes/rejections. This is a broad cross-gym access path not in the stated product model.
- **Medium:** trainer profile check uses `is_active` but not `status`, while relationship helpers elsewhere accept a different set of active statuses. Stale status fields can drift.
- **Medium:** no rate limit or content maximum on message send permits spam, storage growth, and expensive polling amplification.

### Integrity

- Duplicate conversations are only as strong as an unversioned RPC and unknown database uniqueness constraint.
- Message and conversation user FKs are reportedly absent. Orphans can result when users are deleted; account deletion manually deletes messages/conversations in `server.js:5229`, but foreign-key behavior is unknown.
- `POST /message` reads unread counts then writes incremented values. Simultaneous sends can overwrite one another (lost increment). Use atomic DB operation.
- Read reset can race with send increment, losing unread state.
- No transactions couple message insert, preview, timestamp, unread, and notification. A partial failure creates inconsistent threads.
- No message size cap, attachment ownership model, status audit, soft delete, retention policy, or immutable moderation audit is defined.

## 13. Dead or duplicate code

- Dead: `gymvyn-frontend/src/components/chat/ChatWindow.jsx` direct Realtime component (not imported).
- Duplicate: active `src/pages/ChatWindow.jsx` and dead component both implement message loading/composer/rendering.
- Duplicate: `TrainerChatPage.jsx` repeats list/thread/composer/contact-picker logic rather than using active shared parts.
- Duplicate: client and trainer each have local contact picker variants while owner/staff use `components/chat/ContactPicker.jsx`.
- Stale: `scripts/seed-test-ecosystem.js` conversation field names; test-result cleanup SQL carries similar `trainer_id/client_id` assumptions.
- Duplicated auth: `routes/chatRoutes.js` local `auth()` vs `middleware/auth.js`.

## 14. Recommended canonical chat architecture (do not implement in this audit)

### Must-have initial repair

1. Export production schema/functions/policies first; create a versioned baseline/reconciliation migration. Confirm and preserve every existing conversation/message.
2. Keep a one-to-one `conversations` record with two canonical sorted participant IDs **or** introduce `conversation_participants` only if future group chat is truly planned. Enforce no self-pair and a unique canonical pair at the database level. Make one transactional/RPC create-or-get operation.
3. Centralize a server-only `canMessageNow(actorId,targetId)` that enumerates exactly: active trainer-client; active same-gym owner/staff/trainer/member pairs including staff-staff and trainer-member; accepted friendship; any approved marketplace rule if retained; then block override last/first as a deny.
4. Apply it to contacts, create, list, history, send, mark-read, attachment authorization, unread summary, notification enqueue, and realtime authorization. Frontend remains UX only.
5. Choose an explicit history policy: recommended default is **stop new messages and remove from active contact/list immediately, but let former participants read historical messages read-only unless blocked, deleted, or legal/safety policy says otherwise.** This avoids accidental data loss and gives users a coherent archive. A block should normally hide/deny history and future delivery for the blocked party; finalize legal/safety behavior with product counsel.
6. Replace p1/p2 counters with per-participant `last_read_message_id`/`last_read_at` (or maintain counters transactionally from it). Derive unread counts reliably; never reset/increment through competing JS writes.
7. Add cursor pagination (`before` message ID/time), bounded content length, validation, transactional message write + preview + unread update, request idempotency key, and per-user/conversation rate limits.

### Needed for stable beta

- Add/normalize a single friendship lifecycle only after proving `buddy_requests` can be migrated safely: canonical pair uniqueness, statuses `pending/accepted/rejected/removed/blocked` or separate `user_blocks`, timestamps/actor IDs, and active-contact indexing. Blocking must override all grants.
- Define active gym relationship predicates from authoritative status fields and add indexes for every permission lookup. Treat gym/trainer deactivation and expiry as immediate permission revocation.
- Use server-authorized realtime. Given current Supabase stack, either (a) keep efficient visibility-aware polling for initial repair, or (b) use Supabase Realtime only after RLS/authorization is redesigned to enforce active eligibility and every reconnect backfills through protected API. Do not subscribe raw `messages` merely because the user is historical participant.
- Add an outbox/notification event after transaction commit, then in-app unread badge; defer push/email until device consent/preferences and reliable delivery exist.
- Attachment table/storage policy with message FK, author/conversation authorization, signed URLs, MIME/size scanning, retention/deletion, and quota.
- Audit log for relationship and moderation actions; soft-delete/retention rules for messages.

### Can be deferred

- Typing indicators/presence, reactions, edit windows, message search, push/email, rich plan cards, full-text search, group chat, media previews, end-to-end encryption.

### Should not be built now

- A second friend system alongside `buddy_requests` without a migration decision.
- Direct client writes to chat tables.
- Raw direct Supabase Realtime subscriptions under participant-only RLS.
- Group chat or complex attachments before the direct authorization/data model is correct.

## 15. Reuse versus replace

| Reuse / repair | Replace / retire |
|---|---|
| Express `/api/chat` router shape and bearer-token authentication pattern | Duplicate `routes/chatRoutes.js` auth implementation (use shared middleware after verified compatibility) |
| `canMessage()` concept, but rewrite predicate matrix and centralize status constants/block precedence | Current incomplete `canMessage()` body and unreviewed marketplace grant |
| Existing `conversations` and `messages` records; migrate in place after schema export | Any assumption that old `trainer_id/client_id` conversation schema is valid |
| `/contacts`, `/start`, protected read/send endpoints as product boundaries | Unbounded/N+1 contacts algorithm and JS unread read-modify-write |
| Shared contact picker and active chat UI styling as a base | Trainer fork, client picker fork, orphaned direct-Realtime `components/chat/ChatWindow.jsx` |
| Current polling as a safe temporary delivery mechanism | Misnamed “Realtime” and participant-only direct Realtime subscription |
| `buddy_requests` data only if schema/data audit proves it is viable | A parallel friends model created before that decision |

## 16. Proposed implementation phases

1. **Schema truth and tests:** Read-only production schema export, data counts/duplicate/orphan report, function/policy definition capture; add isolated chat authorization integration tests with fixtures. No production mutation.
2. **Permission repair:** Define/implement canonical active relationship evaluator, include all required gym pairs, decide marketplace treatment, add block/friend migration plan, filter contacts/list consistently. Preserve message rows.
3. **Conversation/data integrity:** Add validated canonical pair uniqueness, repair/reconcile duplicate conversations without losing history, transactional create/send/read mechanics, cursor pagination, indexes and request limits.
4. **Shared frontend:** Consolidate role pages onto one conversation list, contact picker, and window; fix owner mobile/nav sizing; clear error/loading/retry states; remove dead component only after replacement works.
5. **Delivery and unread:** Visibility-aware polling first; then, only with proven authorization, realtime and multi-device reconciliation. Add in-app unread events.
6. **Social/attachments/notifications:** Migrate buddy/friends/block safely; add attachments and notification outbox/push as separately tested features.

## 17. Migration requirements and production risk

- Backend changes require `cd /Users/artazayaz/Desktop/gymvyn-backend && railway up`; do **not** run it as part of audit.
- Frontend changes require GitHub push and Vercel auto-deployment; no manual Vercel deployment.
- Database changes are likely required: schema baseline, pair uniqueness, indexes, friendship/block decision, read state, validation/transaction functions, and possibly attachment/outbox tables.
- Before deduplication, inventory duplicate pairs and merge messages in deterministic order; retain original IDs/mapping/audit so history is not lost.
- Existing rows can be orphaned because reported user FKs are missing; check invalid participants, missing conversations, messages with nonexistent senders, duplicate pairs, null pair IDs, negative counters, and stale active relationships before constraints/backfill.
- No migration/deploy/data mutation occurred in this audit.

## 18. Testing strategy

Add backend integration tests against a disposable Supabase project/schema that prove, for contacts/start/list/history/send and realtime authorization token/poll path:

1. 401 unauthenticated and unrelated user denied.
2. Active trainer↔client allowed in both directions; pending/rejected/removed/expired denied.
3. All 12 same-gym owner/staff/trainer/member combinations: each required allowed pair and different-gym denial.
4. Accepted friend allowed; pending/rejected/removed denied; block overrides trainer/gym/friend/marketplace if that is product policy.
5. Self, forged recipient ID, forged conversation ID, and old conversation IDs denied appropriately.
6. Contact/list behavior after unlinking and selected historical-read policy.
7. Duplicate start under concurrent requests creates one canonical thread.
8. Concurrent sends/read produce correct unread state; pagination returns no gaps/duplicates.
9. Attachment ownership, MIME/size limits, signed URL, delete/retention once attachments exist.
10. Two-device delivery/reconnect with authorization revoked mid-session.

Frontend tests should cover each role entry path, mobile composer above nav, errors/retry, picker eligibility presentation, optimistic send rollback, pagination, and unread updates. Run a focused lint/type/build gate on changed chat files until repository-wide lint debt is resolved.

## 19. Open questions and unknowns

1. What are the production definitions/owners/security modes of `get_or_create_conversation` and `increment_unread`?
2. Does production actually have FKs, unique indexes, triggers, enums, soft-delete fields, RLS policies, publication membership, or additional schema not checked into this repo?
3. Is `buddy_requests` populated in production, what are its exact statuses/constraints, and should it become “friends” or remain gym-specific?
4. Should a marketplace purchase ever grant chat? If yes, which states and for how long?
5. After gym/trainer/friend unlink, should each party retain read-only history, and how must blocks/moderation alter that?
6. Are trainers allowed to be members too, and if so which relationship/role should win? Can owners/staff be represented by more than one active gym row?
7. Is `trainer_profiles.status` authoritative alongside `is_active`, and is gym owner/gym itself soft-deletable?
8. What notification channels and retention/abuse/legal policies are desired before beta?

## 20. Commands run and outcomes

| Command | Outcome |
|---|---|
| `git branch --show-current`, `git status --short`, `git log --oneline -5` in backend | On `main`; many unrelated pre-existing modified/untracked files. No worktree used. |
| Equivalent branch/status check in frontend | On `main`; many unrelated pre-existing modified/untracked files. No frontend files changed. |
| Repository-wide `rg` searches for chat, conversation, relationship, buddy, friend, block, Realtime, routes, migrations | Produced the inventories and confirmed missing friend/block routes/UI. |
| `npm test` in backend | Passed: 152 tests, 0 failures. Existing suite has no direct chat authorization test. |
| `npm run lint` in frontend | Failed: 300 errors, 55 warnings across repository; unrelated baseline lint debt, including not limited to chat files. |
| `npm run build` in frontend | Passed. Vite warns main JS bundle is 581.67 kB gzip and dynamic Supabase import is ineffective. |

## 21. Exact recommended next Codex task

> Stay on main branch. No worktrees. Read AGENTS.md. Do not change application chat code or production data yet. Perform a read-only Supabase schema and data audit for the direct-message system: export/record definitions of `conversations`, `messages`, `buddy_requests`, `trainer_clients`, `gym_memberships`, `gym_staff`, `trainer_profiles`, `gyms`, `get_or_create_conversation`, `increment_unread`, all constraints/indexes/RLS/policies/triggers/publication settings, and counts for duplicate conversation pairs/orphan rows/stale relationships. Reconcile results with `docs/chat-system-audit.md` in a new `docs/chat-schema-verification.md`. Then add a proposed migration plan only; do not run migrations or deploy.
