'use strict';

/*
 * Auth regression suite — gymvyn-backend
 *
 * One representative route per IDOR-remediation batch (Batches 1-12).
 * For each route, asserts the three-state ownership contract:
 *   1. No token        → 401
 *   2. Wrong principal → 403
 *   3. Correct caller  → non-401/403 (auth passed, route reached data layer)
 *
 * Prerequisites:
 *   - .env present with SUPABASE_URL + SUPABASE_SERVICE_KEY
 *   - Test ecosystem seeded (node scripts/seed-test-ecosystem.js)
 *
 * The suite spawns its own server on port 3099 — no manually running
 * server needed.
 */

require('dotenv').config();
const { describe, test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('child_process');
const { createClient } = require('@supabase/supabase-js');
const path = require('path');

// ── Constants ──────────────────────────────────────────────────────────────

const PORT   = 3099;              // dedicated test port, no conflict with dev (3000)
const BASE   = `http://localhost:${PORT}`;
const GYM_ID = '5d2f24fa-4028-4069-90b0-23ee093e7d81'; // TEST_FF_Gym_Alpha
const PASS   = 'TestFF!2026';

// Populated in before()
let srv;
const tokens = {};   // .owner | .solo | .member
const ids    = {};   // .owner | .solo | .member

// ── Helpers ────────────────────────────────────────────────────────────────

async function waitReady(ms) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    try { if ((await fetch(`${BASE}/health`)).ok) return; } catch {}
    await new Promise(r => setTimeout(r, 300));
  }
  throw new Error(`Server on :${PORT} did not become ready within ${ms}ms`);
}

async function hit(method, urlPath, { token, body } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const init = { method, headers };
  if (body !== undefined) init.body = JSON.stringify(body);
  const r = await fetch(BASE + urlPath, init);
  return r.status;
}

async function hitJson(method, urlPath, { token, body } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const init = { method, headers };
  if (body !== undefined) init.body = JSON.stringify(body);
  const response = await fetch(BASE + urlPath, init);
  return { status: response.status, body: await response.json().catch(() => null) };
}

// ── Setup / Teardown ───────────────────────────────────────────────────────

before(async () => {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY)
    throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_KEY — copy .env');

  const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const login = async (email) => {
    const { data, error } = await sb.auth.signInWithPassword({ email, password: PASS });
    if (error) throw new Error(`login(${email}): ${error.message}`);
    return { token: data.session.access_token, id: data.user.id };
  };

  // Sign in test users AND start the server in parallel
  srv = spawn('node', ['server.js'], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, PORT: String(PORT) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const [[owner, solo, member]] = await Promise.all([
    Promise.all([
      login('test_ff_owner_1@fitforge.test'),
      login('test_ff_solo_1@fitforge.test'),
      login('test_ff_member_1@fitforge.test'),
    ]),
    waitReady(20_000),
  ]);

  tokens.owner  = owner.token;   ids.owner  = owner.id;
  tokens.solo   = solo.token;    ids.solo   = solo.id;
  tokens.member = member.token;  ids.member = member.id;
});

after(() => { srv?.kill('SIGTERM'); });

// ── BATCH 1 — user-profile (self-scoped) ───────────────────────────────────
// Route: GET /api/users/:userId
// Guard: req.user.id !== userId → 403

describe('Batch 1 — user-profile (self-scoped) GET /api/users/:userId', () => {
  test('no token → 401', async () => {
    assert.equal(await hit('GET', `/api/users/${ids.owner}`), 401);
  });
  test('wrong user (solo_1 reads owner_1 profile) → 403', async () => {
    assert.equal(await hit('GET', `/api/users/${ids.owner}`, { token: tokens.solo }), 403);
  });
  test('correct user → 200', async () => {
    assert.equal(await hit('GET', `/api/users/${ids.owner}`, { token: tokens.owner }), 200);
  });
});

// ── BATCH 2 — gym-members list (owner-or-staff) ────────────────────────────
// Route: GET /api/gym-members?gymId=
// Guard: isGymOwner || getActiveGymStaffRow → 403 if neither

describe('Batch 2 — gym-members list (owner-or-staff) GET /api/gym-members', () => {
  test('no token → 401', async () => {
    assert.equal(await hit('GET', `/api/gym-members?gymId=${GYM_ID}`), 401);
  });
  test('unrelated user (solo_1, not owner or staff) → 403', async () => {
    assert.equal(await hit('GET', `/api/gym-members?gymId=${GYM_ID}`, { token: tokens.solo }), 403);
  });
  test('gym owner → 200', async () => {
    assert.equal(await hit('GET', `/api/gym-members?gymId=${GYM_ID}`, { token: tokens.owner }), 200);
  });
});

// ── BATCH 3 — food-logs / workout (self-scoped) ────────────────────────────
// Route: GET /api/food-logs/:userId
// Guard: req.user.id !== userId && !isActiveTrainerOfClient → 403

describe('Batch 3 — food-logs/workout (self-scoped) GET /api/food-logs/:userId', () => {
  test('no token → 401', async () => {
    assert.equal(await hit('GET', `/api/food-logs/${ids.owner}`), 401);
  });
  test('wrong user (solo_1 has no trainer link to owner_1) → 403', async () => {
    assert.equal(await hit('GET', `/api/food-logs/${ids.owner}`, { token: tokens.solo }), 403);
  });
  test('correct user → 200', async () => {
    assert.equal(await hit('GET', `/api/food-logs/${ids.owner}`, { token: tokens.owner }), 200);
  });
});

// ── BATCH 4 — account-deletion (self-scoped) ───────────────────────────────
// Route: DELETE /api/users/:userId
// Guard: req.user.id !== userId → 403 (fires before any DB mutation)
// Note: "correct user" case omitted — destructive, would delete test data.

describe('Batch 4 — account-deletion (self-scoped) DELETE /api/users/:userId', () => {
  test('no token → 401', async () => {
    assert.equal(await hit('DELETE', `/api/users/${ids.owner}`), 401);
  });
  test('wrong user → 403 (auth check fires before any mutation)', async () => {
    assert.equal(await hit('DELETE', `/api/users/${ids.owner}`, { token: tokens.solo }), 403);
  });
});

// ── BATCH 5 — gym-lifecycle / settings (owner-only, requireGymOwner) ────────
// Route: GET /api/gyms/:gymId/settings
// Guard: requireGymOwner middleware — gyms.owner_id must equal req.user.id

describe('Batch 5 — gym-settings (owner-only, requireGymOwner) GET /api/gyms/:gymId/settings', () => {
  test('no token → 401', async () => {
    assert.equal(await hit('GET', `/api/gyms/${GYM_ID}/settings`), 401);
  });
  test('non-owner → 403', async () => {
    assert.equal(await hit('GET', `/api/gyms/${GYM_ID}/settings`, { token: tokens.solo }), 403);
  });
  test('gym owner → 200', async () => {
    assert.equal(await hit('GET', `/api/gyms/${GYM_ID}/settings`, { token: tokens.owner }), 200);
  });
});

// ── BATCH 6 — gym-members-write (owner-only) ───────────────────────────────
// Route: DELETE /api/gym-members/:memberId  (:memberId is user_id)
// Guard: isGymOwner(caller, member's gym_id) → 403 before soft-delete
// Note: "correct owner" case omitted — would remove member_1 from test ecosystem.

describe('Batch 6 — gym-members-write (owner-only) DELETE /api/gym-members/:memberId', () => {
  test('no token → 401', async () => {
    assert.equal(await hit('DELETE', `/api/gym-members/${ids.member}`), 401);
  });
  test('non-owner (solo_1 tries to remove member_1 from owner_1 gym) → 403', async () => {
    // Handler resolves gym_id from member_1's active membership, then checks
    // isGymOwner(solo_1, gym_id) — false → 403 before any soft-delete runs.
    assert.equal(await hit('DELETE', `/api/gym-members/${ids.member}`, { token: tokens.solo }), 403);
  });
});

// ── BATCH 7 — payments / financials (owner-or-staff-with-payment-access) ────
// Route: GET /api/gym-payments/:gymId
// Guard: isGymOwner || (activeStaff && staffHasPaymentAccess) → 403

describe('Batch 7 — gym-payments (owner-or-staff-payment) GET /api/gym-payments/:gymId', () => {
  test('no token → 401', async () => {
    assert.equal(await hit('GET', `/api/gym-payments/${GYM_ID}`), 401);
  });
  test('unrelated user → 403', async () => {
    assert.equal(await hit('GET', `/api/gym-payments/${GYM_ID}`, { token: tokens.solo }), 403);
  });
  test('gym owner → 200', async () => {
    assert.equal(await hit('GET', `/api/gym-payments/${GYM_ID}`, { token: tokens.owner }), 200);
  });
});

// ── BATCH 8 — checkin / schedule / announcements (owner-or-staff) ───────────
// Route: GET /api/gym-announcements/:gymId
// Guard: isGymOwner || (activeStaff && staffHasPermission(['view_announcements'])) → 403

describe('Batch 8 — announcements (owner-or-staff) GET /api/gym-announcements/:gymId', () => {
  test('no token → 401', async () => {
    assert.equal(await hit('GET', `/api/gym-announcements/${GYM_ID}`), 401);
  });
  test('unrelated user → 403', async () => {
    assert.equal(await hit('GET', `/api/gym-announcements/${GYM_ID}`, { token: tokens.solo }), 403);
  });
  test('gym owner → 200', async () => {
    assert.equal(await hit('GET', `/api/gym-announcements/${GYM_ID}`, { token: tokens.owner }), 200);
  });
});

// ── BATCH 9 — churn / ML / analytics (owner-only, requireGymOwner) ──────────
// Route: GET /api/gym-stats/:gymId
// Guard: requireGymOwner middleware
// ML-specific assertions skipped (ML shelved); auth-gate regression still tested.

describe('Batch 9 — gym-stats/analytics (owner-only, requireGymOwner) GET /api/gym-stats/:gymId', () => {
  test('no token → 401', async () => {
    assert.equal(await hit('GET', `/api/gym-stats/${GYM_ID}`), 401);
  });
  test('non-owner → 403', async () => {
    assert.equal(await hit('GET', `/api/gym-stats/${GYM_ID}`, { token: tokens.solo }), 403);
  });
  test('gym owner → 200', async () => {
    assert.equal(await hit('GET', `/api/gym-stats/${GYM_ID}`, { token: tokens.owner }), 200);
  });
});

// ── BATCH 10 — diet / nutrition (self-scoped) ──────────────────────────────
// Route: GET /api/macros/:userId
// Guard: req.user.id !== userId && !isActiveTrainerOfClient → 403
// (macros are computed on-the-fly if none stored → always 200 for correct user)

describe('Batch 10 — diet/macros (self-scoped) GET /api/macros/:userId', () => {
  test('no token → 401', async () => {
    assert.equal(await hit('GET', `/api/macros/${ids.owner}`), 401);
  });
  test('wrong user → 403', async () => {
    assert.equal(await hit('GET', `/api/macros/${ids.owner}`, { token: tokens.solo }), 403);
  });
  test('correct user → auth passes (not 401/403; may 500 if no fitness profile stored for test user)', async () => {
    const s = await hit('GET', `/api/macros/${ids.owner}`, { token: tokens.owner });
    assert.notEqual(s, 401, 'correct user should not be rejected by auth');
    assert.notEqual(s, 403, 'correct user should not be forbidden from own resource');
  });
});

// ── BATCH 11 — user-plans (self-scoped; trainer-of-client also allowed) ─────
// Route: GET /api/user-plans/:userId
// Guard: req.user.id !== userId && !isActiveTrainerOfClient → 403

describe('Batch 11 — user-plans (self-scoped) GET /api/user-plans/:userId', () => {
  test('no token → 401', async () => {
    assert.equal(await hit('GET', `/api/user-plans/${ids.owner}`), 401);
  });
  test('wrong user → 403', async () => {
    assert.equal(await hit('GET', `/api/user-plans/${ids.owner}`, { token: tokens.solo }), 403);
  });
  test('correct user → 200', async () => {
    assert.equal(await hit('GET', `/api/user-plans/${ids.owner}`, { token: tokens.owner }), 200);
  });
});

// ── BATCH 12 — legacy live routes (pre-/api prefix, self-scoped) ─────────────
// Route: GET /progress-photos/:userId   (no /api prefix — legacy path)
// Guard: userId !== req.user.id → 403

describe('Batch 12 — legacy progress-photos (self-scoped) GET /progress-photos/:userId', () => {
  test('no token → 401', async () => {
    assert.equal(await hit('GET', `/progress-photos/${ids.owner}`), 401);
  });
  test('wrong user → 403', async () => {
    assert.equal(await hit('GET', `/progress-photos/${ids.owner}`, { token: tokens.solo }), 403);
  });
  test('correct user → 200', async () => {
    assert.equal(await hit('GET', `/progress-photos/${ids.owner}`, { token: tokens.owner }), 200);
  });
});

// ── FINAL DEFECT REGRESSIONS — schedule + locker boundary validation ───────

describe('Final defects — live validation boundaries', () => {
  test('DEF-030 rejects a negative class capacity without mutating the class', async () => {
    const schedule = await hitJson('GET', `/api/gym-schedule/${GYM_ID}?week_start=2026-07-27`, {
      token: tokens.owner,
    });
    assert.equal(schedule.status, 200);
    const gymClass = schedule.body.days.flatMap(day => day.classes || [])[0];
    assert.ok(gymClass?.id, 'seeded class is required');
    assert.equal(
      await hit('PATCH', `/api/gym-schedule/${gymClass.id}`, {
        token: tokens.owner,
        body: { capacity: -1 },
      }),
      400
    );
  });

  test('DEF-040 rejects a stored-active membership whose end_date has passed', async () => {
    const lockers = await hitJson('GET', '/api/lockers', { token: tokens.owner });
    assert.equal(lockers.status, 200);
    const available = lockers.body.find(locker => locker.status === 'available');
    assert.ok(available?.id, 'an available seeded locker is required');
    assert.equal(
      await hit('POST', `/api/lockers/${available.id}/assign`, {
        token: tokens.owner,
        body: { member_id: ids.member, duration_days: 30 },
      }),
      400
    );
  });
});

// ── CRITICAL — original unauthenticated account-takeover route ────────────────
// Route: POST /api/users/:userId/change-password
// Was: no auth at all → anyone could change any password (GAPS.md item 1)
// Now: auth + self-scope check guard the Supabase admin.updateUserById call.
// Note: "correct user" case omitted — changing owner_1's password invalidates
//       all subsequent test JWTs acquired in before().

describe('Critical — change-password (was unauthenticated) POST /api/users/:userId/change-password', () => {
  test('no token → 401 (was 200 before remediation)', async () => {
    assert.equal(
      await hit('POST', `/api/users/${ids.owner}/change-password`, {
        body: { new_password: 'HackerPwTest!9' },
      }),
      401
    );
  });
  test('wrong user → 403 (check fires before admin.updateUserById)', async () => {
    assert.equal(
      await hit('POST', `/api/users/${ids.owner}/change-password`, {
        token: tokens.solo,
        body: { new_password: 'HackerPwTest!9' },
      }),
      403
    );
  });
});
