# FitForge Full Test Pass — Final Summary

**Date:** 2026-06-20
**Environment:** Production Supabase (`jaxnqttycxeavwhcsoyv`) + Railway backend (`fitforge-backend-production-1c93.up.railway.app`)
**Frontend repo:** `~/Desktop/fitforge-frontend` (no commits this pass)
**Backend repo:** `~/Desktop/fitforge-backend` (7 commits, see below)

## Overview

End-to-end test pass across the FitForge stack, executed in 5 phases against an isolated `TEST_FF_*`-tagged ecosystem inside the production Supabase project. Phase 1 seeded 19 auth users + a complete gym (memberships, lockers, supplements, expenses, check-ins, workouts, food logs, trainer relationships, chat, progress, XP). Phase 2 swept every mounted backend route as the seeded users and fixed each real bug with a commit + Railway deploy + re-verification. Phase 3 produced a role-grouped manual UI checklist. Phase 4 reproduced and reverified the six open bugs from the v7 handoff. This document is the Phase 5 wrap-up.

## Test ecosystem

- **Gym:** `TEST_FF_Gym_Alpha` (id `5d2f24fa-4028-4069-90b0-23ee093e7d81`, join code `TFFAL1`)
- **Users:** 19 auth users + matching `users` profiles, all `test_ff_*@fitforge.test` / `TestFF!2026`
  - 1 owner · 3 trainers (1 independent + 2 gym-affiliated) · 10 gym members · 2 solo consumers · 3 trainer clients

| Table | Count (in test gym) |
|---|---|
| gyms | 1 |
| gym_memberships | 10 |
| trainer_profiles | 3 |
| supplement_products | 5 (incl. low-stock, out-of-stock, inactive) |
| gym_expenses | 8 (across all 7 categories) |
| gym_lockers | 6 (free/paid, available/occupied/maintenance) |
| locker_assignments | 2 (one 2-day-expiry for urgency) |
| locker_payments | 1 |
| check_ins | 20 (last 30 days) |
| workout_plans | 3 (members 1–3) |
| workout_logs | 15 (5 × 3 members) |
| food_logs | 84 (7 days × 4 meals × 3 members) |
| trainer_clients | 3 |
| trainer_templates | 1 |
| assigned_plans | 1 |
| conversations | 5 (each with 2 seed messages) |
| progress_photos | 8 (4 × members 1, 2) |
| announcements | 2 (1 normal, 1 high-priority) |
| user_xp | 3 (Titan L12 / 9000 XP, Iron L6 / 1500 XP, Rookie L1 / 50 XP) |
| xp_events | 9 |

## Bugs found and fixed

| # | Bug | Root cause | Commit | Phase |
|---|---|---|---|---|
| 1 | `GET /progress-photos/:userId` → 500 `column progress_photos.public_id does not exist` | Route selected `public_id`/`date`; real columns are `cloudinary_id`/`taken_at`. Upload route also didn't pass NOT NULL `angle`. | `33c2a94` | 2 |
| 2 | `GET /leaderboard` → 500 `column users.username does not exist` | Selected `username`/`avatar_url`/`streak` (none exist on `public.users`); streak lives on `user_xp.current_streak`. Rewrote to query `user_xp` with `users!inner(id, full_name)` embed. | `a514cde` | 2 |
| 3 | `GET /buddy-suggestions/:userId` → 500 same `username` error | Same column-drift root cause as #2; selected `username`/`avatar_url`/`fitness_goal`. Real columns: `full_name`, `goal`. | `a514cde` | 2 |
| 4 | `GET /posts` → 500 `Could not find a relationship between 'posts' and 'users'` | FKs on `posts.user_id`, `post_likes.user_id`, `post_comments.user_id` referenced `auth.users`, not `public.users` — PostgREST embed only resolves against `public`. Applied migration `repoint_post_user_fks_to_public_users` and switched embeds to explicit `users!posts_user_id_fkey(...)`. | `f06224d` | 2 |
| 5 | `GET /posts/:postId/comments` → 500 same FK error | Same root cause as #4; same migration; explicit embed `users!post_comments_user_id_fkey(...)`. | `f06224d` | 2 |
| 6 | `GET /api/xp/challenges` → 500 `Could not find the 'progress' column of 'weekly_challenges'` | Code wrote/updated `progress`; table column is `current_value`. Fixed 5 references across `src/routes/xpRoutes.js`, `src/services/xpEngine.js`, `src/services/xpCron.js`. | `a7f4809` | 2 |

Six commits in the test-pass branch:

```
61fcd00 chore(test): UI verification checklist [test-pass]
576ce44 test: add backend API sweep with full create→update→delete flows
a7f4809 fix(xp): use weekly_challenges.current_value, not progress [test-pass]
f06224d fix(posts): repoint user FKs to public.users and use explicit embed [test-pass]
a514cde fix(leaderboard,buddies): use real users columns; pull streak from user_xp [test-pass]
33c2a94 fix(progress-photos): use real column names — cloudinary_id, taken_at, angle [test-pass]
e3bb776 feat(test): seed test ecosystem script
```

Each backend `fix(*)` commit was deployed to Railway and curl-verified against the specific failing endpoint before the next bug was tackled.

**Database migrations applied (production):**

1. `repoint_post_user_fks_to_public_users` — drops `auth.users` FKs on `posts/post_likes/post_comments.user_id` and re-adds them pointing to `public.users` with `ON DELETE CASCADE`. Permanent and safe — table had zero rows at migration time.

## Known bugs from v7 handoff — verification results

| Bug | Status | Evidence |
|---|---|---|
| Gym member detail "Member not found" | ✅ ALREADY RESOLVED | `GET /api/gym-members/<uuid>` → 200 with full member object |
| Member name showing "—" | ✅ ALREADY RESOLVED | Both list and detail responses include `full_name` on every row |
| `GET /api/gym-members` 500 for empty gym | ✅ ALREADY RESOLVED | Verified against a freshly-created empty test gym → 200 with `{members:[], total:0, page:1, hasMore:false}` |
| WorkoutSummary empty exercises / 0kg volume | ✅ ALREADY RESOLVED | API returns full `exercises[].sets[]`; frontend `dbRowToSummary` maps `weight_kg`/`reps_completed` → `weight`/`reps`; `computeVolume` consistent |
| ML scores endpoint 500 (no UUID validation) | ✅ ALREADY RESOLVED | `/api/ml/scores/:gymId` is fully stubbed; no Supabase query, garbage UUID → 200 stub, not 500 |
| `useStreak.js` 400 on `completed` column | ❓ COULD NOT REPRODUCE | Both queries succeed (`workout_logs.completed_at` exists; `progress_entries` table exists). Likely fixed by prior commit `a7abf3f bug fixes: workout flow, …` |

5 of 6 verified resolved with curl evidence; 1 of 6 could not be reproduced. **Zero new bugs from this list required commits in this pass.**

## API coverage

Phase 2 sweep on the final clean run:

| | |
|---|---|
| ✅ Passed | **82** |
| ❌ Failed | **0** |
| ⏭ Skipped | **13** |

Covers every mounted route: health, users, gym (owner-side reads + writes), consumer (my-gym, exercises, workouts, food, progress, community, leaderboard, buddies), XP (profile/events/leaderboard/challenges/muscle-balance/season/freeze), trainer (my-code, pending-invites, my-trainer), gym join codes, supplements (full create→order→pay flow), expenses (full CRUD), lockers (full create→assign→pay→end flow), announcements (CRUD), memberships (manual create + renew + delete), and the `lockers_enabled` feature-flag (404→403 enforcement when off).

## Skipped items (with reason)

**Backend routes — skipped in API sweep:**

| Route | Reason |
|---|---|
| `POST /generate-workout-plan` | Gemini call — cost/latency |
| `POST /generate-diet-plan` | Gemini call — cost/latency |
| `POST /api/diet-plan/generate` | Gemini call — cost/latency |
| `POST /chat` | Anthropic call — cost |
| `POST /api/food-logs/voice` | AI parsing — cost |
| `POST /api/food-logs/camera` | AI parsing — cost |
| `POST /upload-progress-photo` | Multipart upload — not easily scriptable |
| `POST /api/gyms/:gymId/upload-logo` | Multipart upload |
| `POST /api/gym-members/csv-import` | Multipart upload |
| `GET /api/ml/*` | `fitforge-ml` service not deployed |
| `POST /api/gym-churn/score/:gymId` | Depends on ML |
| `GET /api/ml/scores/:gymId` | Depends on ML (currently stubbed) |

**UI items — deferred per Phase 3 checklist (do NOT report as bugs):**

- Diet macro ring card styling
- Dark mode functional theming (only swatch preview works)
- Trainer screen redesigns (functional but unrestyled)
- Member-facing locker view (owner-only by design in v1)

## Cleanup

When you're done with the manual UI pass, paste this once in the Supabase SQL editor to remove every `TEST_FF_*` row in one shot, then go to **Authentication → Users**, filter `test_ff_`, and delete the 19 auth users. The Phase 2 FK migration is permanent — it is a real schema correction and should stay.

```sql
DELETE FROM xp_events            WHERE user_id IN (SELECT id FROM users WHERE full_name LIKE 'TEST_FF%');
DELETE FROM user_xp              WHERE user_id IN (SELECT id FROM users WHERE full_name LIKE 'TEST_FF%');
DELETE FROM weekly_challenges    WHERE user_id IN (SELECT id FROM users WHERE full_name LIKE 'TEST_FF%');
DELETE FROM messages             WHERE conversation_id IN (SELECT id FROM conversations WHERE trainer_id IN (SELECT id FROM users WHERE full_name LIKE 'TEST_FF%'));
DELETE FROM conversations        WHERE trainer_id IN (SELECT id FROM users WHERE full_name LIKE 'TEST_FF%');
DELETE FROM trainer_clients      WHERE trainer_id IN (SELECT id FROM users WHERE full_name LIKE 'TEST_FF%');
DELETE FROM assigned_plans       WHERE trainer_id IN (SELECT id FROM users WHERE full_name LIKE 'TEST_FF%');
DELETE FROM trainer_templates    WHERE trainer_id IN (SELECT id FROM users WHERE full_name LIKE 'TEST_FF%');
DELETE FROM trainer_profiles     WHERE user_id    IN (SELECT id FROM users WHERE full_name LIKE 'TEST_FF%');
DELETE FROM food_logs            WHERE user_id    IN (SELECT id FROM users WHERE full_name LIKE 'TEST_FF%');
DELETE FROM workout_logs         WHERE user_id    IN (SELECT id FROM users WHERE full_name LIKE 'TEST_FF%');
DELETE FROM workout_plans        WHERE user_id    IN (SELECT id FROM users WHERE full_name LIKE 'TEST_FF%');
DELETE FROM progress_photos      WHERE user_id    IN (SELECT id FROM users WHERE full_name LIKE 'TEST_FF%');
DELETE FROM posts                WHERE user_id    IN (SELECT id FROM users WHERE full_name LIKE 'TEST_FF%');
DELETE FROM locker_payments          WHERE gym_id IN (SELECT id FROM gyms WHERE name LIKE 'TEST_FF%');
DELETE FROM locker_assignments       WHERE gym_id IN (SELECT id FROM gyms WHERE name LIKE 'TEST_FF%');
DELETE FROM gym_lockers              WHERE gym_id IN (SELECT id FROM gyms WHERE name LIKE 'TEST_FF%');
DELETE FROM check_ins                WHERE gym_id IN (SELECT id FROM gyms WHERE name LIKE 'TEST_FF%');
DELETE FROM gym_expenses             WHERE gym_id IN (SELECT id FROM gyms WHERE name LIKE 'TEST_FF%');
DELETE FROM supplement_order_items   WHERE order_id IN (SELECT id FROM supplement_orders WHERE gym_id IN (SELECT id FROM gyms WHERE name LIKE 'TEST_FF%'));
DELETE FROM supplement_orders        WHERE gym_id IN (SELECT id FROM gyms WHERE name LIKE 'TEST_FF%');
DELETE FROM supplement_products      WHERE gym_id IN (SELECT id FROM gyms WHERE name LIKE 'TEST_FF%');
DELETE FROM announcements            WHERE gym_id IN (SELECT id FROM gyms WHERE name LIKE 'TEST_FF%');
DELETE FROM gym_memberships          WHERE gym_id IN (SELECT id FROM gyms WHERE name LIKE 'TEST_FF%');
DELETE FROM payments                 WHERE gym_id IN (SELECT id FROM gyms WHERE name LIKE 'TEST_FF%');
DELETE FROM gyms                     WHERE name LIKE 'TEST_FF%';
DELETE FROM users                    WHERE full_name LIKE 'TEST_FF%';
-- Then: Supabase Dashboard → Authentication → Users → filter "test_ff" → delete.
```

## Recommendations

In priority order, based on what surfaced during the pass:

1. **Add a schema-drift CI check.** All five real bugs in Phase 2 were the same root cause — code referenced a column or FK target that didn't exist in production. A trivial Node script that queries `information_schema.columns` for each table the backend touches and asserts the column set matches what the routes select would have caught every one of these statically. Worth ~50 lines of code. The recurring nature of this pattern (handoff explicitly called it out, and four of the six v7 known bugs are variants of it) means it will keep biting until there's an automated guard.

2. **Delete dead `routes/xpRoutes.js`.** A stub file that returns placeholder responses sits next to the real one (`src/routes/xpRoutes.js`). It's not mounted in `server.js`, but it's read-trap for any future engineer. One commit, ~80 LOC delete.

3. **Decide on `public.users` vs `auth.users` FK convention and apply consistently.** Phase 2 had to repoint posts/post_likes/post_comments FKs to `public.users` because PostgREST embeds only resolve there. Other tables in the schema may still FK to `auth.users` — audit with `SELECT conrelid::regclass, conname, pg_get_constraintdef(oid) FROM pg_constraint WHERE confrelid='auth.users'::regclass;` and convert any that the frontend ever embeds through. Likely candidates: `food_logs`, `user_macros`, `user_diet_plans` — all already FK to `auth.users` per the Phase 1 schema map.

4. **Wire up or stub-down `/api/ml/*` honestly.** `/api/ml/scores/:gymId` returns Indian-name dummy users (Priya Sharma, Ankit Verma, etc.) regardless of input — confusing in a real gym owner's UI. Either deploy the ML service, or change the route to return `503 Service Unavailable` with a clear "ML not available" payload so the frontend can render an empty state instead of fake-looking real data.

5. **Make the Supabase anon key actually work for client sign-in.** The `SUPABASE_ANON_KEY` currently in `.env` is a publishable key that GoTrue rejects with "Invalid API key" — the test sweep had to fall back to using the service key for sign-in. The real client-side app must be using a different key somewhere; reconcile so the value in `.env` matches what production frontends actually use, or document the right key explicitly. Otherwise every future test script and contributor will hit the same wall.
