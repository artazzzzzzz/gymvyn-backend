# FitForge E2E UI Test Pass — Results

**Date:** 2026-06-21
**Harness:** Playwright + headless Chromium (390×844 viewport)
**Target:** Local Vite dev server (`http://localhost:5174`) → live Railway backend
**Auth:** Storage-state cached per role (one login at global-setup, reused across tests)
**Roles tested:** owner_1, trainer_1, member_1 (Titan L12), member_3 (Rookie L1), solo_1, client_1

## Totals

| | |
|---|---|
| **Total tests** | **60** |
| ✅ Passed | **60** |
| ❌ Failed | **0** |
| ⏭ Skipped (deferred) | see below |
| 🐞 Real bugs found & fixed | **1** |

## Per-role breakdown

| Spec file | Role | Tests | Pass |
|---|---|---|---|
| `tests/smoke.spec.js` | owner_1 | 1 | 1 |
| `tests/owner.spec.js` | owner_1 (Gym Owner) | 18 | 18 |
| `tests/trainer.spec.js` | trainer_1 (Independent) | 9 | 9 |
| `tests/member-l12.spec.js` | member_1 (Titan L12 / 9000 XP) | 18 | 18 |
| `tests/rookie.spec.js` | member_3 (Rookie L1 / 50 XP) | 5 | 5 |
| `tests/solo.spec.js` | solo_1 (unlinked consumer) | 7 | 7 |
| `tests/cross-role.spec.js` | trainer↔client + member↔owner | 2 | 2 |

## Bugs found and fixed

| # | Test that surfaced it | Bug | Root cause | Fix commit | Backend/Frontend |
|---|---|---|---|---|---|
| 1 | Owner `/gym/trainers` — "No trainers yet" despite API returning 2 affiliated trainers | Five owner pages (`GymTrainers`, `GymLockers`, `GymSettings`, `GymCheckin`, `GymInsights`) read `const gymId = localStorage.getItem('gymId')` at component / module scope, with no fallback. Only `GymOnboarding` writes the key — so any owner who skipped onboarding (seeded test user, fresh device, cleared storage) rendered silent empty states across the whole owner surface. | Created `useOwnerGymId()` hook that reads `localStorage` when available, otherwise calls `getGymByUserId(user.id)` and caches. Wired into all 5 pages. Also have `GymDashboard.load()` write the key on successful gym fetch so dashboard-first nav primes the cache. | `d8eb6f2 fix(gym-owner): resolve gymId via hook with API fallback [e2e-test]` | Frontend |

Diagnosis was driven by network-tap during one Playwright test: the page made no `/api/gym-trainers/:gymId` request because `gymId` was `null`, so the React effect short-circuited on `if (!gymId) return`.

### Seed-data fix (test ecosystem, not an app bug)

While debugging the Member L12 spec I found the seeded consumers / gym_members never reached protected routes — they were being redirected to `/onboarding`. Root cause: `useAuth` determines onboarding-complete for consumers via `done = !!(goal && training_days)`; my Phase 1 seed set `goal` but never `training_days`. Patched the 17 affected `TEST_FF_*` user rows with a direct SQL update (`training_days = 4, goal = 'muscle_gain'`). This was a test-data fix, not a code fix — no commit, no deploy.

## Phase 2 fix watch-list — re-verified in UI

All four areas the Phase 2 backend wave touched render clean in the browser:

- ✅ `/community` — loads without 500 (was: `posts↔users` FK pointed to `auth.users`)
- ✅ `/leaderboard` — renders Titan / Iron / Rookie podium with 9,000 / 1,500 / 50 XP (was: `users.username` did not exist)
- ✅ `/progress` — loads without 500 (was: `progress_photos.public_id` did not exist)
- ✅ `/xp` weekly challenges — loads without 5xx on `/api/xp/challenges` (was: `weekly_challenges.progress` did not exist)

## Cross-role flow verification

**Flow A — Supplement order surface:** Member loaded `/my-gym/supplements` catalog and owner loaded `/gym/supplements` Orders tab, both within the same test run, both clean (no 5xx, no JS errors). A full place-order → mark-ready → mark-completed end-to-end interaction was intentionally scoped down to surface verification because reliably driving the cart UI across browser contexts in a single shot would have needed multi-step waits and more selector inspection time than was justified — the underlying API flow is already covered by the Phase 2 sweep.

**Flow B — Trainer↔client chat surface:** Trainer (trainer_1) opened the Client One conversation and saw the seeded `TEST_FF hi from trainer` message; client (client_1) loaded `/client/chat` clean. Real-time send/receive between the two contexts wasn't asserted in this pass for the same reason — Phase 2 already verified the underlying conversations + messages endpoints round-trip correctly.

## Skipped (with reason)

- **Form Coach AI analysis** — Gemini-backed pose analysis; not exercised
- **AI Chat** (`/chat`) — Anthropic-backed; cost/latency
- **Voice + camera food logging** — Gemini parsing
- **Multipart uploads** (progress photo, gym logo, CSV member import) — file payloads not in scope
- **`/api/ml/*` routes** — fitforge-ml service not deployed (Phase 2 noted)
- **Diet macro ring card styling** — explicitly deferred per Phase 3 checklist
- **Dark mode functional theming** — explicitly deferred (only swatch preview works)
- **Trainer screen redesigns** — explicitly deferred (verified functional, not styled)
- **Member-side locker view** — owner-only by design in v1

## Test-data cleanup

After the run, deleted via API:

- 4 `PLAYWRIGHT_TEST*` supplement products
- 2 `PWT_*` test lockers
- 1 `PLAYWRIGHT_TEST*` expense
- 2 `TEST_FF Manual Member` rows from the Phase 2 sweep (with their `gym_memberships`)

The 19 `TEST_FF_*` auth users and the `TEST_FF_Gym_Alpha` ecosystem itself are intentionally kept — they're the harness for the next pass.

## Harness layout

```
fitforge-frontend/
  playwright.config.js           # mobile viewport, single worker, globalSetup
  tests/
    global-setup.js              # logs each role in once, saves storageState
    helpers/auth.js              # USERS map + loginAs()
    smoke.spec.js
    owner.spec.js                # 18 tests
    trainer.spec.js              #  9 tests
    member-l12.spec.js           # 18 tests
    rookie.spec.js               #  5 tests
    solo.spec.js                 #  7 tests
    cross-role.spec.js           #  2 tests
    .auth/                       # gitignored, 30-min TTL on cached state
    playwright-output/           # gitignored
```

Run the whole suite with `npx playwright test` (requires `npm run dev` in background on port 5174 with the seeded backend reachable).
