'use strict';

/*
 * Auth regression suite — routes/trainerRoutes.js
 *
 * Companion to tests/auth.test.js. Covers the consolidated trainer routes
 * file (merged from the dead root trainerRoutes.js, then rewritten same-day
 * for the email/phone/manual invite flow + POST /api/trainer/claim-invite +
 * join-gym). Zero coverage existed before this file.
 *
 * Patterns covered (see PR description / task notes for the full inventory):
 *   P1 — explicit self-scoped by param/body id            → PATCH /profile/:userId
 *   P2 — self-OR-active-trainer-client-link (isLinkedPair) → GET /my-trainer/:clientId
 *   P3 — fetch-resource-then-compare-owner-field           → PATCH /client/:relationshipId
 *   P4 — implicit self-scope, no forgeable target id       → my-code, invite, join,
 *        pending-invites, accept-invite/:id, decline-invite/:id, my-trainer,
 *        unlink, gym-status, join-gym
 *   P5 — anti-impersonation contract (NEW, critical)        → POST /claim-invite
 *
 * Runs its own server on a DIFFERENT port (3098) than tests/auth.test.js
 * (3099) — node's test runner can run test files concurrently, so a shared
 * port would race.
 *
 * Prerequisites: same as tests/auth.test.js (.env with SUPABASE_URL +
 * SUPABASE_SERVICE_KEY, seeded test ecosystem).
 */

require('dotenv').config();
const { describe, test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('child_process');
const { createClient } = require('@supabase/supabase-js');
const path = require('path');

const PORT = 3098;
const BASE = `http://localhost:${PORT}`;
const PASS = 'TestFF!2026';
const CLAIM_INVITE_CODE = 'ZZCLAIM1'; // invite_code is varchar(8)
const CODEX_AUTH_TEST = 'CODEX_AUTH_TEST';

let srv;
let sb;       // client used ONLY for signInWithPassword calls
let adminDb;  // separate service-role client for all .from() setup/verify/teardown queries
              // — sb's Authorization header gets overwritten by whichever concurrent
              // login finishes last, so reusing it for data queries would run them as
              // that user (RLS-filtered) instead of the service role.
const tokens = {};
const ids = {};

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
  let json = null;
  try { json = await r.json(); } catch {}
  return { status: r.status, json };
}

// ── Setup / Teardown ─────────────────────────────────────────────────────

let acceptTestRelId;   // fresh 'pending' row for accept-invite/:id test
let declineTestRelId;  // fresh 'pending' row for decline-invite/:id test

async function trainerCodeFor(userId) {
  const { data, error } = await adminDb
    .from('trainer_profiles')
    .select('trainer_code, invite_code')
    .eq('user_id', userId)
    .maybeSingle();
  if (error) throw error;
  return data?.trainer_code || data?.invite_code;
}

async function activeGymCodes() {
  const { data, error } = await adminDb
    .from('gyms')
    .select('id, join_code')
    .eq('is_active', true)
    .not('join_code', 'is', null)
    .limit(2);
  if (error) throw error;
  return data || [];
}

before(async () => {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY)
    throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_KEY — copy .env');

  sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  adminDb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const login = async (email) => {
    const { data, error } = await sb.auth.signInWithPassword({ email, password: PASS });
    if (error) throw new Error(`login(${email}): ${error.message}`);
    return { token: data.session.access_token, id: data.user.id };
  };

  srv = spawn('node', ['server.js'], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, PORT: String(PORT) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const [[trainer1, trainer2, client1, client2, client3, solo1, solo2]] = await Promise.all([
    Promise.all([
      login('test_ff_trainer_1@fitforge.test'),
      login('test_ff_trainer_2@fitforge.test'),
      login('test_ff_client_1@fitforge.test'),
      login('test_ff_client_2@fitforge.test'),
      login('test_ff_client_3@fitforge.test'),
      login('test_ff_solo_1@fitforge.test'),
      login('test_ff_solo_2@fitforge.test'),
    ]),
    waitReady(20_000),
  ]);

  tokens.trainer1 = trainer1.token; ids.trainer1 = trainer1.id;
  tokens.trainer2 = trainer2.token; ids.trainer2 = trainer2.id;
  tokens.client1  = client1.token;  ids.client1  = client1.id;
  tokens.client2  = client2.token;  ids.client2  = client2.id;
  tokens.client3  = client3.token;  ids.client3  = client3.id;
  tokens.solo1    = solo1.token;    ids.solo1    = solo1.id;
  tokens.solo2    = solo2.token;    ids.solo2    = solo2.id;

  // Existing seeded relationship: trainer_1 → client_1 (active) — used by P3.
  const { data: rel, error: relErr } = await adminDb
    .from('trainer_clients')
    .select('id')
    .eq('trainer_id', ids.trainer1)
    .eq('client_id', ids.client1)
    .eq('status', 'active')
    .single();
  if (relErr || !rel) throw new Error('Expected seeded trainer_1→client_1 active relationship not found');
  ids.trainer1Client1Rel = rel.id;

  // Fresh pending rows for accept/decline tests — these don't exist in the seed
  // and are cleaned up in after().
  const { data: acceptRow, error: acceptErr } = await adminDb
    .from('trainer_clients')
    .insert({ trainer_id: ids.trainer2, client_id: ids.client2, status: 'pending' })
    .select('id')
    .single();
  if (acceptErr) throw acceptErr;
  acceptTestRelId = acceptRow.id;

  const { data: declineRow, error: declineErr } = await adminDb
    .from('trainer_clients')
    .insert({ trainer_id: ids.trainer2, client_id: ids.client3, status: 'pending' })
    .select('id')
    .single();
  if (declineErr) throw declineErr;
  declineTestRelId = declineRow.id;

  // Phone-invite placeholder for the claim-invite anti-impersonation test.
  // user_id is nullable + unclaimed; status='phone_invited' is what
  // POST /claim-invite looks for.
  await adminDb.from('trainer_profiles').delete().eq('invite_code', CLAIM_INVITE_CODE);
  const { error: placeholderErr } = await adminDb
    .from('trainer_profiles')
    .insert({ invite_code: CLAIM_INVITE_CODE, status: 'phone_invited', user_id: null });
  if (placeholderErr) throw placeholderErr;
});

after(async () => {
  srv?.kill('SIGTERM');

  // Best-effort cleanup — don't let teardown failures mask test results.
  try {
    if (acceptTestRelId) await adminDb.from('trainer_clients').delete().eq('id', acceptTestRelId);
    if (declineTestRelId) await adminDb.from('trainer_clients').delete().eq('id', declineTestRelId);
    await adminDb.from('trainer_profiles').delete().eq('invite_code', CLAIM_INVITE_CODE);
    // claim-invite promotes the claimant to role:'trainer' — revert so solo_2
    // stays a plain consumer for other suites/future runs.
    if (ids.solo2) await adminDb.from('users').update({ role: 'consumer' }).eq('id', ids.solo2);
  } catch (e) {
    console.error('trainerRoutesAuth teardown cleanup error:', e.message);
  }
});

// ── P1 — explicit self-scoped by param ──────────────────────────────────
// Route: PATCH /api/trainer/profile/:userId
// Guard: req.user.id !== req.params.userId → 403

describe('P1 — profile (self-scoped) PATCH /api/trainer/profile/:userId', () => {
  test('no token → 401', async () => {
    const { status } = await hit('PATCH', `/api/trainer/profile/${ids.trainer1}`, { body: {} });
    assert.equal(status, 401);
  });
  test('wrong user (solo_1 patches trainer_1 profile) → 403', async () => {
    const { status } = await hit('PATCH', `/api/trainer/profile/${ids.trainer1}`, {
      token: tokens.solo1, body: {},
    });
    assert.equal(status, 403);
  });
  test('correct user → 200 (empty update, no data mutated besides updated_at)', async () => {
    const { status } = await hit('PATCH', `/api/trainer/profile/${ids.trainer1}`, {
      token: tokens.trainer1, body: {},
    });
    assert.equal(status, 200);
  });
});

// ── P2 — self-OR-active-trainer-client-link ─────────────────────────────
// Route: GET /api/trainer/my-trainer/:clientId
// Guard: req.user.id !== clientId && !isLinkedPair(caller, clientId) → 403

describe('P2 — my-trainer/:clientId (self-or-linked) GET /api/trainer/my-trainer/:clientId', () => {
  test('no token → 401', async () => {
    const { status } = await hit('GET', `/api/trainer/my-trainer/${ids.client1}`);
    assert.equal(status, 401);
  });
  test('unrelated user (solo_1, no link to client_1) → 403', async () => {
    const { status } = await hit('GET', `/api/trainer/my-trainer/${ids.client1}`, { token: tokens.solo1 });
    assert.equal(status, 403);
  });
  test('linked trainer (trainer_1, active link to client_1) → 200', async () => {
    const { status } = await hit('GET', `/api/trainer/my-trainer/${ids.client1}`, { token: tokens.trainer1 });
    assert.equal(status, 200);
  });
});

// ── P3 — fetch-resource-then-compare-owner-field ────────────────────────
// Route: PATCH /api/trainer/client/:relationshipId
// Guard: fetch trainer_clients row, existingRel.trainer_id !== req.user.id → 403

describe('P3 — client/:relationshipId (owner-field compare) PATCH /api/trainer/client/:relationshipId', () => {
  test('no token → 401', async () => {
    const { status } = await hit('PATCH', `/api/trainer/client/${ids.trainer1Client1Rel}`, { body: {} });
    assert.equal(status, 401);
  });
  test('wrong trainer (trainer_2 does not own this relationship) → 403', async () => {
    const { status } = await hit('PATCH', `/api/trainer/client/${ids.trainer1Client1Rel}`, {
      token: tokens.trainer2, body: { status: 'active' },
    });
    assert.equal(status, 403);
  });
  test('owning trainer (trainer_1) → 200', async () => {
    const { status } = await hit('PATCH', `/api/trainer/client/${ids.trainer1Client1Rel}`, {
      token: tokens.trainer1, body: { status: 'active' },
    });
    assert.equal(status, 200);
  });
});

// ── P4 — implicit self-scope routes ─────────────────────────────────────
// No forgeable target id in the URL/body; every query is WHERE-scoped
// server-side to req.user.id. No "wrong user → 403" variant exists — the
// wrong-user analogue for these routes is "acts on my own row regardless
// of what I ask for", which the individual tests verify where relevant.

describe('P4 — my-code (implicit self) GET /api/trainer/my-code', () => {
  test('no token → 401', async () => {
    assert.equal((await hit('GET', '/api/trainer/my-code')).status, 401);
  });
  test('trainer with a profile → 200', async () => {
    assert.equal((await hit('GET', '/api/trainer/my-code', { token: tokens.trainer1 })).status, 200);
  });
  test('caller with no trainer profile → 404 (auth passed, reached data layer)', async () => {
    assert.equal((await hit('GET', '/api/trainer/my-code', { token: tokens.solo1 })).status, 404);
  });
});

describe('P4 — invite (implicit self, trainerId = req.user.id) POST /api/trainer/invite', () => {
  test('no token → 401', async () => {
    assert.equal((await hit('POST', '/api/trainer/invite', { body: { identifier: 'x' } })).status, 401);
  });
  test('caller with no trainer profile → 404 (auth passed, no mutation)', async () => {
    const { status } = await hit('POST', '/api/trainer/invite', {
      token: tokens.solo1, body: { identifier: 'nobody@fake.test' },
    });
    assert.equal(status, 404);
  });
  test('trainer, nonexistent identifier → 400 (auth passed, no mutation)', async () => {
    const { status } = await hit('POST', '/api/trainer/invite', {
      token: tokens.trainer1, body: { identifier: 'no_such_user_zz@fake.test' },
    });
    assert.equal(status, 400);
  });
});

describe('P4 — join (implicit self, client_id = req.user.id) POST /api/trainer/join', () => {
  test('no token → 401', async () => {
    assert.equal((await hit('POST', '/api/trainer/join', { body: { trainer_code: 'ABCD' } })).status, 401);
  });
  test('malformed code → 400 (auth passed, no mutation)', async () => {
    const { status } = await hit('POST', '/api/trainer/join', {
      token: tokens.solo1, body: { trainer_code: 'not valid!!' },
    });
    assert.equal(status, 400);
  });
});

describe('P4 — pending-invites (implicit self) GET /api/trainer/pending-invites', () => {
  test('no token → 401', async () => {
    assert.equal((await hit('GET', '/api/trainer/pending-invites')).status, 401);
  });
  test('any authenticated caller → 200', async () => {
    assert.equal((await hit('GET', '/api/trainer/pending-invites', { token: tokens.solo1 })).status, 200);
  });
});

describe('P4 — accept-invite/:id (scoped by id AND client_id) PATCH /api/trainer/accept-invite/:id', () => {
  test('no token → 401', async () => {
    assert.equal((await hit('PATCH', `/api/trainer/accept-invite/${acceptTestRelId}`)).status, 401);
  });
  test('wrong user (solo_1, not the invited client) → 404 and affects nothing', async () => {
    const { status } = await hit('PATCH', `/api/trainer/accept-invite/${acceptTestRelId}`, {
      token: tokens.solo1,
    });
    assert.equal(status, 404);
    const { data } = await adminDb.from('trainer_clients').select('status').eq('id', acceptTestRelId).single();
    assert.equal(data.status, 'pending', 'row must be untouched by a non-owning caller');
  });
  test('correct client (client_2) → 200 and row actually flips to active', async () => {
    const { status } = await hit('PATCH', `/api/trainer/accept-invite/${acceptTestRelId}`, {
      token: tokens.client2,
    });
    assert.equal(status, 200);
    const { data } = await adminDb.from('trainer_clients').select('status').eq('id', acceptTestRelId).single();
    assert.equal(data.status, 'active');
  });
});

describe('P4 — decline-invite/:id (scoped by id AND client_id) DELETE /api/trainer/decline-invite/:id', () => {
  test('no token → 401', async () => {
    assert.equal((await hit('DELETE', `/api/trainer/decline-invite/${declineTestRelId}`)).status, 401);
  });
  test('wrong user (solo_1, not the invited client) → 200 but row survives', async () => {
    const { status } = await hit('DELETE', `/api/trainer/decline-invite/${declineTestRelId}`, {
      token: tokens.solo1,
    });
    assert.equal(status, 200);
    const { data } = await adminDb.from('trainer_clients').select('id').eq('id', declineTestRelId).maybeSingle();
    assert.ok(data, 'row must survive a decline attempt from a non-owning caller');
  });
  test('correct client (client_3) → 200 and row is actually deleted', async () => {
    const { status } = await hit('DELETE', `/api/trainer/decline-invite/${declineTestRelId}`, {
      token: tokens.client3,
    });
    assert.equal(status, 200);
    const { data } = await adminDb.from('trainer_clients').select('id').eq('id', declineTestRelId).maybeSingle();
    assert.equal(data, null);
    declineTestRelId = null; // already gone — skip redundant cleanup in after()
  });
});

describe('P4 — my-trainer (implicit self, no param) GET /api/trainer/my-trainer', () => {
  test('no token → 401', async () => {
    assert.equal((await hit('GET', '/api/trainer/my-trainer')).status, 401);
  });
  test('linked client (client_1) → 200', async () => {
    assert.equal((await hit('GET', '/api/trainer/my-trainer', { token: tokens.client1 })).status, 200);
  });
  test('unlinked caller (solo_1) → 404 (auth passed, no trainer found)', async () => {
    assert.equal((await hit('GET', '/api/trainer/my-trainer', { token: tokens.solo1 })).status, 404);
  });
});

describe('P4 — unlink (implicit self) PATCH /api/trainer/unlink', () => {
  // "correct caller" success case omitted deliberately — client_1's active
  // link to trainer_1 is seeded state other tests (P2, my-trainer) depend
  // on; unlinking it here would make this file order-dependent.
  test('no token → 401', async () => {
    assert.equal((await hit('PATCH', '/api/trainer/unlink')).status, 401);
  });
  test('caller with no active trainer → 404 (auth passed, no mutation)', async () => {
    assert.equal((await hit('PATCH', '/api/trainer/unlink', { token: tokens.solo1 })).status, 404);
  });
});

describe('P4 — gym-status (implicit self) GET /api/trainer/gym-status', () => {
  test('no token → 401', async () => {
    assert.equal((await hit('GET', '/api/trainer/gym-status')).status, 401);
  });
  test('trainer with a profile → 200', async () => {
    assert.equal((await hit('GET', '/api/trainer/gym-status', { token: tokens.trainer1 })).status, 200);
  });
});

describe('P4 — join-gym (implicit self) POST /api/trainer/join-gym', () => {
  test('no token → 401', async () => {
    const { status } = await hit('POST', '/api/trainer/join-gym', { body: { trainer_join_code: 'ZZZZ' } });
    assert.equal(status, 401);
  });
  test('trainer, nonexistent gym code → 404 (auth passed, no mutation)', async () => {
    const { status } = await hit('POST', '/api/trainer/join-gym', {
      token: tokens.trainer1, body: { trainer_join_code: 'NOSUCHCODE99' },
    });
    assert.equal(status, 404);
  });
});

// ── P5 — anti-impersonation contract (NEW, critical) ────────────────────
// Route: POST /api/trainer/claim-invite
// Contract: the endpoint never reads a userId from the body — the claimed
// row's user_id is always req.user.id, regardless of what the caller sends.

describe('P5 — claim-invite (anti-impersonation) POST /api/trainer/claim-invite', () => {
  test('no token → 401', async () => {
    const { status } = await hit('POST', '/api/trainer/claim-invite', {
      body: { invite_code: CLAIM_INVITE_CODE },
    });
    assert.equal(status, 401);
  });
  test('invalid/unknown invite code → 404 (auth passed, no mutation)', async () => {
    const { status } = await hit('POST', '/api/trainer/claim-invite', {
      token: tokens.solo2, body: { invite_code: 'NOSUCHCODE99' },
    });
    assert.equal(status, 404);
  });
  test('malicious body cannot claim on behalf of another user', async () => {
    // solo_2 claims the placeholder, but the body tries to impersonate
    // trainer_2 by smuggling a foreign user_id/userId. The endpoint must
    // ignore it and bind the row to req.user.id (solo_2), not the body.
    const { status } = await hit('POST', '/api/trainer/claim-invite', {
      token: tokens.solo2,
      body: { invite_code: CLAIM_INVITE_CODE, user_id: ids.trainer2, userId: ids.trainer2 },
    });
    assert.equal(status, 200);

    const { data } = await adminDb
      .from('trainer_profiles')
      .select('user_id')
      .eq('invite_code', CLAIM_INVITE_CODE)
      .single();
    assert.equal(data.user_id, ids.solo2, 'claimed row must belong to the caller, not the smuggled body id');
    assert.notEqual(data.user_id, ids.trainer2, 'malicious body user_id must be ignored');
  });
});

// ── Relationship status regressions ─────────────────────────────────────

describe('relationship status and switch regressions', () => {
  test('inactive and pending trainer-client rows do not authorize linked access', async () => {
    const statuses = ['removed', 'pending'];
    const inserted = [];
    try {
      for (const status of statuses) {
        const { data, error } = await adminDb
          .from('trainer_clients')
          .insert({ trainer_id: ids.trainer2, client_id: ids.client1, status, notes: `${CODEX_AUTH_TEST}:${status}` })
          .select('id')
          .single();
        if (error) throw error;
        inserted.push(data.id);

        const res = await hit('GET', `/api/trainer/my-trainer/${ids.client1}`, { token: tokens.trainer2 });
        assert.equal(res.status, 403, `${status} relationship must not authorize trainer access`);
      }
    } finally {
      if (inserted.length) await adminDb.from('trainer_clients').delete().in('id', inserted);
    }
  });

  test('rejected trainer-client status is blocked by the current schema constraint', async () => {
    const { error } = await adminDb
      .from('trainer_clients')
      .insert({ trainer_id: ids.trainer2, client_id: ids.client1, status: 'rejected', notes: `${CODEX_AUTH_TEST}:rejected` });
    assert.ok(error, 'trainer_clients should reject unsupported rejected status rows');
    assert.equal(error.code, '23514');
  });

  test('self assigned-plans access does not require a relationship row', async () => {
    const { status, json } = await hit('GET', `/api/trainer/assigned-plans/${ids.solo1}`, { token: tokens.solo1 });
    assert.equal(status, 200);
    assert.ok(Array.isArray(json));
  });

  test('route parameter change cannot fetch another client assigned plans', async () => {
    const { status } = await hit('GET', `/api/trainer/assigned-plans/${ids.client1}`, { token: tokens.solo1 });
    assert.equal(status, 403);
  });

  test('assigned-plans for a linked trainer excludes another trainer historical plan', async () => {
    let staleRelId;
    let oldPlanId;
    let currentPlanId;
    try {
      const { data: staleRel, error: staleErr } = await adminDb
        .from('trainer_clients')
        .insert({ trainer_id: ids.trainer2, client_id: ids.client1, status: 'removed', notes: CODEX_AUTH_TEST })
        .select('id')
        .single();
      if (staleErr) throw staleErr;
      staleRelId = staleRel.id;

      const { data: oldPlan, error: oldPlanErr } = await adminDb
        .from('assigned_plans')
        .insert({
          trainer_id: ids.trainer2,
          client_id: ids.client1,
          type: 'workout',
          name: `${CODEX_AUTH_TEST} old trainer plan`,
          plan_data: {},
          status: 'active',
          notes: CODEX_AUTH_TEST,
        })
        .select('id')
        .single();
      if (oldPlanErr) throw oldPlanErr;
      oldPlanId = oldPlan.id;

      const { data: currentPlan, error: currentPlanErr } = await adminDb
        .from('assigned_plans')
        .insert({
          trainer_id: ids.trainer1,
          client_id: ids.client1,
          type: 'workout',
          name: `${CODEX_AUTH_TEST} current trainer plan`,
          plan_data: {},
          status: 'active',
          notes: CODEX_AUTH_TEST,
        })
        .select('id')
        .single();
      if (currentPlanErr) throw currentPlanErr;
      currentPlanId = currentPlan.id;

      const { status, json } = await hit('GET', `/api/trainer/assigned-plans/${ids.client1}`, { token: tokens.trainer1 });
      assert.equal(status, 200);
      const returnedIds = json.map(plan => plan.id);
      assert.ok(returnedIds.includes(currentPlanId), 'current trainer should see own assigned plan');
      assert.ok(!returnedIds.includes(oldPlanId), 'current trainer must not see old trainer plan');
    } finally {
      if (oldPlanId || currentPlanId) await adminDb.from('assigned_plans').delete().in('id', [oldPlanId, currentPlanId].filter(Boolean));
      if (staleRelId) await adminDb.from('trainer_clients').delete().eq('id', staleRelId);
    }
  });

  test('trainer switch removes old trainer access and grants new trainer access', async () => {
    let oldRelId;
    let newRelId;
    try {
      const { data: oldRel, error: oldErr } = await adminDb
        .from('trainer_clients')
        .insert({ trainer_id: ids.trainer2, client_id: ids.solo1, status: 'active', notes: CODEX_AUTH_TEST })
        .select('id')
        .single();
      if (oldErr) throw oldErr;
      oldRelId = oldRel.id;

      const code = await trainerCodeFor(ids.trainer1);
      assert.ok(code, 'seed trainer_1 must have a trainer code or invite code');

      const joinRes = await hit('POST', '/api/trainer/join', {
        token: tokens.solo1,
        body: { trainer_code: code },
      });
      assert.equal(joinRes.status, 200);

      const { data: newRel } = await adminDb
        .from('trainer_clients')
        .select('id')
        .eq('trainer_id', ids.trainer1)
        .eq('client_id', ids.solo1)
        .eq('status', 'active')
        .maybeSingle();
      newRelId = newRel?.id;
      assert.ok(newRelId, 'new trainer relationship should be active');

      assert.equal((await hit('GET', `/api/trainer/my-trainer/${ids.solo1}`, { token: tokens.trainer2 })).status, 403);
      assert.equal((await hit('GET', `/api/trainer/my-trainer/${ids.solo1}`, { token: tokens.trainer1 })).status, 200);
    } finally {
      await adminDb
        .from('trainer_clients')
        .delete()
        .eq('client_id', ids.solo1)
        .in('trainer_id', [ids.trainer1, ids.trainer2]);
      oldRelId = null;
      newRelId = null;
    }
  });

  test('unlink removes duplicate active trainer rows immediately', async () => {
    let relIds = [];
    try {
      const { data, error } = await adminDb
        .from('trainer_clients')
        .insert([
          { trainer_id: ids.trainer1, client_id: ids.solo1, status: 'active', notes: `${CODEX_AUTH_TEST}:dup1` },
          { trainer_id: ids.trainer2, client_id: ids.solo1, status: 'active', notes: `${CODEX_AUTH_TEST}:dup2` },
        ])
        .select('id');
      if (error) throw error;
      relIds = data.map(row => row.id);

      assert.equal((await hit('PATCH', '/api/trainer/unlink', { token: tokens.solo1 })).status, 200);

      const { data: rows } = await adminDb
        .from('trainer_clients')
        .select('id, status')
        .in('id', relIds);
      assert.equal(rows.filter(row => row.status === 'active').length, 0);
      assert.equal((await hit('GET', `/api/trainer/my-trainer/${ids.solo1}`, { token: tokens.trainer1 })).status, 403);
      assert.equal((await hit('GET', `/api/trainer/my-trainer/${ids.solo1}`, { token: tokens.trainer2 })).status, 403);
    } finally {
      if (relIds.length) await adminDb.from('trainer_clients').delete().in('id', relIds);
    }
  });

  test('gym switch removes old gym active membership and grants new gym membership', { skip: false }, async () => {
    const gyms = await activeGymCodes();
    if (gyms.length < 2) {
      console.warn('Skipping gym switch verification: fewer than two active gyms with join codes');
      return;
    }

    const [oldGym, newGym] = gyms;
    let oldMembershipId;
    try {
      const { data: oldMembership, error: oldErr } = await adminDb
        .from('gym_memberships')
        .insert({
          gym_id: oldGym.id,
          user_id: ids.solo1,
          status: 'active',
          start_date: new Date().toISOString().slice(0, 10),
          notes: CODEX_AUTH_TEST,
          metadata: { tag: CODEX_AUTH_TEST },
        })
        .select('id')
        .single();
      if (oldErr) throw oldErr;
      oldMembershipId = oldMembership.id;

      const joinRes = await hit('POST', '/api/gym/join', {
        token: tokens.solo1,
        body: { join_code: newGym.join_code },
      });
      assert.equal(joinRes.status, 200);

      const { data: oldAfter } = await adminDb
        .from('gym_memberships')
        .select('status')
        .eq('id', oldMembershipId)
        .single();
      assert.equal(oldAfter.status, 'inactive');

      const { data: newMembership } = await adminDb
        .from('gym_memberships')
        .select('id, status')
        .eq('gym_id', newGym.id)
        .eq('user_id', ids.solo1)
        .eq('status', 'active')
        .maybeSingle();
      assert.ok(newMembership, 'new gym should have active membership');
    } finally {
      await adminDb
        .from('gym_memberships')
        .delete()
        .eq('user_id', ids.solo1)
        .in('gym_id', [oldGym.id, newGym.id]);
      await adminDb.from('users').update({ gym_id: null, role: 'consumer' }).eq('id', ids.solo1);
    }
  });
});
