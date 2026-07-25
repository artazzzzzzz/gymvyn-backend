'use strict';

/*
 * /api/admin/* auth-gate regression suite — gymvyn-backend
 *
 * GAPS.md item 4: the admin console previously had zero backend test
 * coverage. Every route in routes/adminRoutes.js sits behind a single
 * `router.use(auth, requireAdmin)`, so the contract under test is:
 *   1. No token           → 401
 *   2. Authenticated, but
 *      not on ADMIN_EMAILS → 403
 *
 * The "successful admin caller" case is intentionally NOT covered here —
 * there is no disposable admin test account (ADMIN_EMAILS holds a real
 * person's email), and creating one would mean either handling real admin
 * credentials in a test (not appropriate) or changing production config to
 * add a throwaway admin allowlist entry. Mirrors the existing convention in
 * auth.test.js (see "Batch 4 — account-deletion", which omits the
 * "correct user" case for the same reason: no safe way to exercise success
 * without touching something that shouldn't be touched from a test).
 * deleteUserCascade's actual deletion behavior is covered separately and
 * safely in tests/userDeletionCascade.test.js, which unit-tests the
 * function directly against a throwaway account the test creates and
 * destroys itself.
 *
 * Prerequisites: same as auth.test.js — .env present, test ecosystem seeded.
 * Spawns its own server on a dedicated port, no manually running server needed.
 */

require('dotenv').config();
const { describe, test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('child_process');
const { createClient } = require('@supabase/supabase-js');
const path = require('path');

const PORT = 3096; // dedicated port -- 3097/3098/3099 already used by other suites
const BASE = `http://localhost:${PORT}`;
const PASS = 'TestFF!2026';

let srv;
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
  return r.status;
}

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

  srv = spawn('node', ['server.js'], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, PORT: String(PORT) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const [[owner, solo]] = await Promise.all([
    Promise.all([
      login('test_ff_owner_1@fitforge.test'),
      login('test_ff_solo_1@fitforge.test'),
    ]),
    waitReady(20_000),
  ]);

  tokens.owner = owner.token; ids.owner = owner.id;
  tokens.solo  = solo.token;  ids.solo  = solo.id;
});

after(() => { srv?.kill('SIGTERM'); });

describe('GET /api/admin/whoami', () => {
  test('no token → 401', async () => {
    assert.equal(await hit('GET', '/api/admin/whoami'), 401);
  });
  test('non-admin caller (test fixture, not on ADMIN_EMAILS) → 403', async () => {
    assert.equal(await hit('GET', '/api/admin/whoami', { token: tokens.solo }), 403);
  });
});

describe('GET /api/admin/users', () => {
  test('no token → 401', async () => {
    assert.equal(await hit('GET', '/api/admin/users'), 401);
  });
  test('non-admin caller → 403', async () => {
    assert.equal(await hit('GET', '/api/admin/users', { token: tokens.owner }), 403);
  });
});

describe('GET /api/admin/users/:userId', () => {
  test('no token → 401', async () => {
    assert.equal(await hit('GET', `/api/admin/users/${ids.owner}`), 401);
  });
  test('non-admin caller (querying their own id does not grant admin access) → 403', async () => {
    assert.equal(await hit('GET', `/api/admin/users/${ids.owner}`, { token: tokens.owner }), 403);
  });
});

describe('PATCH /api/admin/users/:userId', () => {
  test('no token → 401', async () => {
    assert.equal(await hit('PATCH', `/api/admin/users/${ids.owner}`, { body: { age: 30 } }), 401);
  });
  test('non-admin caller → 403 (fires before any field update)', async () => {
    assert.equal(await hit('PATCH', `/api/admin/users/${ids.owner}`, { token: tokens.solo, body: { age: 30 } }), 403);
  });
});

describe('PATCH /api/admin/users/:userId/role', () => {
  test('no token → 401', async () => {
    assert.equal(await hit('PATCH', `/api/admin/users/${ids.owner}/role`, { body: { role: 'trainer' } }), 401);
  });
  test('non-admin caller cannot escalate their own role → 403', async () => {
    assert.equal(await hit('PATCH', `/api/admin/users/${ids.owner}/role`, { token: tokens.owner, body: { role: 'trainer' } }), 403);
  });
});

describe('PATCH /api/admin/users/:userId/flags', () => {
  test('no token → 401', async () => {
    assert.equal(await hit('PATCH', `/api/admin/users/${ids.owner}/flags`, { body: { ai_blocked: true } }), 401);
  });
  test('non-admin caller → 403', async () => {
    assert.equal(await hit('PATCH', `/api/admin/users/${ids.owner}/flags`, { token: tokens.solo, body: { ai_blocked: true } }), 403);
  });
});

describe('DELETE /api/admin/users/:userId', () => {
  test('no token → 401', async () => {
    assert.equal(await hit('DELETE', `/api/admin/users/${ids.owner}`), 401);
  });
  test('non-admin caller cannot delete their own account via the admin route → 403 (fires before deleteUserCascade)', async () => {
    assert.equal(await hit('DELETE', `/api/admin/users/${ids.owner}`, { token: tokens.owner }), 403);
  });
});

describe('GET /api/admin/dashboard', () => {
  test('no token → 401', async () => {
    assert.equal(await hit('GET', '/api/admin/dashboard'), 401);
  });
  test('non-admin caller → 403', async () => {
    assert.equal(await hit('GET', '/api/admin/dashboard', { token: tokens.owner }), 403);
  });
});

describe('GET /api/admin/platform-stats', () => {
  test('no token → 401', async () => {
    assert.equal(await hit('GET', '/api/admin/platform-stats'), 401);
  });
  test('non-admin caller → 403', async () => {
    assert.equal(await hit('GET', '/api/admin/platform-stats', { token: tokens.solo }), 403);
  });
});

describe('GET /api/admin/ai-monitor', () => {
  test('no token → 401', async () => {
    assert.equal(await hit('GET', '/api/admin/ai-monitor'), 401);
  });
  test('non-admin caller → 403', async () => {
    assert.equal(await hit('GET', '/api/admin/ai-monitor', { token: tokens.owner }), 403);
  });
});

describe('POST /api/admin/feature-flags/:key', () => {
  test('no token → 401', async () => {
    assert.equal(await hit('POST', '/api/admin/feature-flags/AI_FOOD_VISION_ENABLED', { body: { enabled: true } }), 401);
  });
  test('non-admin caller cannot toggle a platform feature flag → 403', async () => {
    assert.equal(await hit('POST', '/api/admin/feature-flags/AI_FOOD_VISION_ENABLED', { token: tokens.solo, body: { enabled: true } }), 403);
  });
});

describe('DELETE /api/admin/food-vision-cache', () => {
  test('no token → 401', async () => {
    assert.equal(await hit('DELETE', '/api/admin/food-vision-cache'), 401);
  });
  test('non-admin caller → 403', async () => {
    assert.equal(await hit('DELETE', '/api/admin/food-vision-cache', { token: tokens.owner }), 403);
  });
});
