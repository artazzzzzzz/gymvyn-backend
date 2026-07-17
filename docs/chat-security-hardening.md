# Direct-message emergency security hardening

## Vulnerability summary

Production verification found publicly executable SECURITY DEFINER chat RPCs, browser RLS policies allowing direct conversation/message writes, an obsolete unread RPC, and active memberships past expiry still qualifying for chat. This change prepares but does not apply a migration to close those paths.

## Threat model and changes

An authenticated browser user could bypass `/api/chat` and call `get_or_create_conversation` for arbitrary users, create self threads, write a conversation where they were one participant, or insert a message into a conversation they did not participate in. The only rollout migrations are `migrations/chat_security_phase1_additive.sql` and `migrations/chat_security_phase2_lockdown.sql`; together they revoke old RPC execution, remove direct browser write policies, add participant/self/content guards, and create service-role-only `chat_get_or_create_conversation`, `chat_send_message`, and `chat_mark_read` RPCs. All use fixed `search_path` and atomic row locking.

Backend now validates text (trimmed, 1–4,000 chars), calls `canMessage()` before new service RPCs, uses atomic send/read operations, and treats a gym membership as active only when `status='active'` and `end_date` is null or not past UTC today. Active gyms and trainer profiles now require `is_active=true`; trainers also require `status='active'`.

## Two-phase compatibility and deployment order

The original one-step migration was unsafe: new backend code needs new RPCs, while old backend code needs old RPCs. `chat_security_phase1_additive.sql` adds restricted service-role RPCs only; old RPCs and browser policies remain, so both backend versions work. `chat_security_phase2_lockdown.sql` is applied only after the new backend API is verified; it revokes old RPC execution, drops exactly `participants can insert conversations`, `participants can update conversations`, and `sender can insert messages`, then adds self/canonical/content constraints and pagination index.

| Backend | Database | Result |
|---|---|---|
| Old | Current | Works |
| Old | Phase 1 | Works: its old RPC/policies remain |
| New | Phase 1 | Works: service role uses new restricted RPCs |
| New | Phase 2 | Works: new RPCs remain service-role granted |
| Old | Phase 2 | Expected to fail sending/starting; old RPCs revoked |
| Frontend | All states | Uses backend API; no direct active write dependency found |

Production sequence: snapshot and preflight → apply Phase 1 → old-backend smoke test → deploy backend with `railway up` → API start/send/read verification → apply Phase 2 → direct-write/RPC denial checks → API recheck. Rollback before Phase 2 is backend rollback only; after Phase 2, deploy the prior backend only after explicitly restoring reviewed grants/policies.

`chat_metadata_reconciliation_review.sql` is read-only and identifies empty/mismatched conversation metadata; it does not update or delete anything.

## Tests and deferred work

`tests/chatSecurity.test.js` is production-independent unit/static coverage for content validation, self denial, and migration hardening declarations. `npm run test:chat-db` builds an isolated local fixture, proves Phase 1/Phase 2 role grants and denials as `anon`, `authenticated`, and `service_role`, verifies direct-write lockdown, constraints, atomic create/send/read metadata, and stale membership fixture state. It does not test production or the complete relationship matrix.

Staff↔staff and trainer↔member remain deferred. Friends, blocks, attachments, group chat, Realtime, pagination UI, and historical-read lifecycle are unchanged. No frontend code changed.

## Manual verification checklist

After applying only to a disposable database: invoke old RPCs as anon/authenticated (must fail), attempt direct conversation/message writes (must fail), exercise service-role API start/send/read, send concurrent messages, and verify expired membership/gym/trainer deactivation deny messaging. Confirm metadata review count before any future backfill.
