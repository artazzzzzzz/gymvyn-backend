'use strict';

/*
 * /api/plans/admin/* auth-gate regression suite — gymvyn-backend
 *
 * GAPS.md items 2 & 3: the Gymvyn Plans admin/moderation routes
 * (routes/plansRoutes.js) had no HTTP-level test coverage, and
 * /admin/listings/:id/suspend + /admin/listings/:id/remove were 501 stubs
 * until this pass wired them up to requireAdminPlans. Every route here sits
 * behind `auth, requireAdminPlans` (a PLANS_ADMIN_EMAILS allowlist, separate
 * from the platform-wide ADMIN_EMAILS used by /api/admin/*), so the
 * contract under test is the same fail-closed shape as adminRoutesAuth.test.js:
 *   1. No token           → 401
 *   2. Authenticated, but
 *      not an allowed
 *      Plans admin        → 403
 *
 * The "successful Plans admin caller" case is intentionally NOT covered
 * here, for the same reason adminRoutesAuth.test.js omits it: no disposable
 * PLANS_ADMIN_EMAILS account exists to sign in as without touching real
 * config. Mirrors that file's convention exactly.
 *
 * Prerequisites: same as adminRoutesAuth.test.js — .env present, test
 * ecosystem seeded. Spawns its own server on a dedicated port.
 */

require('dotenv').config();
const { describe, test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('child_process');
const { createClient } = require('@supabase/supabase-js');
const path = require('path');

const PORT = 3095; // dedicated port -- 3096/3097/3098/3099 already used by other suites
const BASE = `http://localhost:${PORT}`;
const PASS = 'TestFF!2026';
const PLACEHOLDER_ID = '00000000-0000-0000-0000-000000000000';

let srv;
const tokens = {};

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
    return data.session.access_token;
  };

  srv = spawn('node', ['server.js'], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, PORT: String(PORT) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const [owner] = await Promise.all([
    login('test_ff_owner_1@fitforge.test'),
    waitReady(20_000),
  ]);

  tokens.owner = owner;
});

after(() => { srv?.kill('SIGTERM'); });

describe('GET /api/plans/admin/purchases', () => {
  test('no token → 401', async () => {
    assert.equal(await hit('GET', '/api/plans/admin/purchases'), 401);
  });
  test('non-admin caller (test fixture, not on PLANS_ADMIN_EMAILS) → 403', async () => {
    assert.equal(await hit('GET', '/api/plans/admin/purchases', { token: tokens.owner }), 403);
  });
});

describe('POST /api/plans/admin/purchases/:id/approve', () => {
  test('no token → 401', async () => {
    assert.equal(await hit('POST', `/api/plans/admin/purchases/${PLACEHOLDER_ID}/approve`), 401);
  });
  test('non-admin caller → 403 (fires before any purchase lookup or delivery)', async () => {
    assert.equal(await hit('POST', `/api/plans/admin/purchases/${PLACEHOLDER_ID}/approve`, { token: tokens.owner }), 403);
  });
});

describe('POST /api/plans/admin/listings/:id/suspend', () => {
  test('no token → 401', async () => {
    assert.equal(await hit('POST', `/api/plans/admin/listings/${PLACEHOLDER_ID}/suspend`), 401);
  });
  test('non-admin caller → 403, not the old 501 stub', async () => {
    assert.equal(await hit('POST', `/api/plans/admin/listings/${PLACEHOLDER_ID}/suspend`, { token: tokens.owner }), 403);
  });
});

describe('POST /api/plans/admin/listings/:id/remove', () => {
  test('no token → 401', async () => {
    assert.equal(await hit('POST', `/api/plans/admin/listings/${PLACEHOLDER_ID}/remove`), 401);
  });
  test('non-admin caller → 403, not the old 501 stub', async () => {
    assert.equal(await hit('POST', `/api/plans/admin/listings/${PLACEHOLDER_ID}/remove`, { token: tokens.owner }), 403);
  });
});
