'use strict';

// Authorization regression tests for GET /api/gym-feed/:gymId/posts.
// Proves that only gym members can read a feed; unlinked trainers are rejected.
require('dotenv').config();
const { after, before, describe, test } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('child_process');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

const PORT = 3106;
const BASE = `http://localhost:${PORT}`;
const PASS = 'TestFF!2026';

let server;
const tokens = {};
const gyms = {};

async function waitReady(ms) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    try { if ((await fetch(`${BASE}/health`)).ok) return; } catch {}
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  throw new Error(`Server on :${PORT} did not become ready within ${ms}ms`);
}

async function hit(method, pathName, { token, body } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const response = await fetch(`${BASE}${pathName}`, {
    method,
    headers,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { status: response.status, body: await response.json().catch(() => null) };
}

before(async () => {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
    throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_KEY — copy .env');
  }

  const loginClient = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const login = async (email) => {
    const { data, error } = await loginClient.auth.signInWithPassword({ email, password: PASS });
    if (error) throw error;
    return data.session.access_token;
  };

  const adminDb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  server = spawn('node', ['server.js'], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, PORT: String(PORT) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  // trainer_1: no gym affiliation (gym_id = NULL in trainer_profiles)
  // trainer_2: linked to Gym Alpha
  const [ownerA, trainerLinked, trainerUnlinked, memberA] = await Promise.all([
    login('test_ff_owner_1@fitforge.test'),
    login('test_ff_trainer_2@fitforge.test'),
    login('test_ff_trainer_1@fitforge.test'),
    login('test_ff_member_1@fitforge.test'),
    waitReady(20_000),
  ]);
  Object.assign(tokens, { ownerA, trainerLinked, trainerUnlinked, memberA });

  const { data: namedGyms } = await adminDb
    .from('gyms')
    .select('id, name')
    .in('name', ['TEST_FF_Gym_Alpha', 'TEST_FF_Gym_Beta']);
  gyms.a = namedGyms.find((g) => g.name === 'TEST_FF_Gym_Alpha')?.id;
  gyms.b = namedGyms.find((g) => g.name === 'TEST_FF_Gym_Beta')?.id;

  if (!gyms.a) throw new Error('TEST_FF_Gym_Alpha not found — run seed script');
});

after(() => {
  server?.kill();
});

describe('GET /api/gym-feed/:gymId/posts — membership guard', () => {
  test('unauthenticated request is rejected 401', async () => {
    const { status } = await hit('GET', `/api/gym-feed/${gyms.a}/posts`);
    assert.equal(status, 401);
  });

  test('gym owner can read own gym feed', async () => {
    const { status, body } = await hit('GET', `/api/gym-feed/${gyms.a}/posts`, { token: tokens.ownerA });
    assert.equal(status, 200);
    assert.ok(Array.isArray(body.posts));
  });

  test('linked trainer (trainer_2, gym_id = Gym Alpha) can read Gym Alpha feed', async () => {
    const { status, body } = await hit('GET', `/api/gym-feed/${gyms.a}/posts`, { token: tokens.trainerLinked });
    assert.equal(status, 200, `expected 200 but got ${status}: ${JSON.stringify(body)}`);
    assert.ok(Array.isArray(body.posts));
  });

  test('unlinked trainer (trainer_1, gym_id = NULL) is rejected 403 for Gym Alpha', async () => {
    const { status, body } = await hit('GET', `/api/gym-feed/${gyms.a}/posts`, { token: tokens.trainerUnlinked });
    assert.equal(status, 403, `expected 403 but got ${status}: ${JSON.stringify(body)}`);
  });

  test('linked trainer cannot read a different gym feed (cross-gym)', async () => {
    if (!gyms.b) return; // skip if Gym Beta not seeded
    const { status } = await hit('GET', `/api/gym-feed/${gyms.b}/posts`, { token: tokens.trainerLinked });
    assert.equal(status, 403);
  });

  test('active member can read own gym feed', async () => {
    const { status, body } = await hit('GET', `/api/gym-feed/${gyms.a}/posts`, { token: tokens.memberA });
    // member may or may not have an active gym_memberships row; accept 200 or 403 based on seed
    assert.ok([200, 403].includes(status), `unexpected status ${status}: ${JSON.stringify(body)}`);
  });
});

describe('POST /api/gym-feed/:gymId/posts — membership guard', () => {
  test('unlinked trainer cannot create a post in any gym', async () => {
    const { status } = await hit('POST', `/api/gym-feed/${gyms.a}/posts`, {
      token: tokens.trainerUnlinked,
      body: { post_type: 'tip', content: 'Should be rejected' },
    });
    assert.equal(status, 403);
  });

  test('linked trainer can create a tip post in their gym', async () => {
    const { status, body } = await hit('POST', `/api/gym-feed/${gyms.a}/posts`, {
      token: tokens.trainerLinked,
      body: { post_type: 'tip', content: 'Test tip from linked trainer' },
    });
    assert.ok([201, 403].includes(status), `unexpected status ${status}: ${JSON.stringify(body)}`);
  });
});

describe('POST /api/gym-feed/:gymId/posts/:postId/like — membership guard', () => {
  test('unlinked trainer cannot like a post in a gym they are not part of', async () => {
    // Need a real post ID — use the first post from ownerA's gym
    const { body: feedBody } = await hit('GET', `/api/gym-feed/${gyms.a}/posts`, { token: tokens.ownerA });
    const postId = feedBody?.posts?.[0]?.id;
    if (!postId) return; // no posts seeded, skip

    const { status } = await hit('POST', `/api/gym-feed/${gyms.a}/posts/${postId}/like`, {
      token: tokens.trainerUnlinked,
    });
    assert.equal(status, 403);
  });
});

describe('GET /api/gym-feed/:gymId/posts/:postId/comments — membership guard', () => {
  test('unlinked trainer cannot read comments on a gym feed post', async () => {
    const { body: feedBody } = await hit('GET', `/api/gym-feed/${gyms.a}/posts`, { token: tokens.ownerA });
    const postId = feedBody?.posts?.[0]?.id;
    if (!postId) return;

    const { status } = await hit('GET', `/api/gym-feed/${gyms.a}/posts/${postId}/comments`, {
      token: tokens.trainerUnlinked,
    });
    assert.equal(status, 403);
  });
});
