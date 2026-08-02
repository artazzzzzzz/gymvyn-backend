'use strict';

// Live authorization regression coverage for /api/equipment/:gymId.
require('dotenv').config();
const { after, before, describe, test } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('child_process');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

const PORT = 3102;
const BASE = `http://localhost:${PORT}`;
const PASS = 'TestFF!2026';
const PREFIX = 'CODEX_DEF003_';

let server;
let adminDb;
const tokens = {};
const gyms = {};
const records = {};

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

  adminDb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const loginClient = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const login = async (email) => {
    const { data, error } = await loginClient.auth.signInWithPassword({ email, password: PASS });
    if (error) throw error;
    return data.session.access_token;
  };

  server = spawn('node', ['server.js'], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, PORT: String(PORT) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const [ownerA, ownerB, trainerA, memberA] = await Promise.all([
    login('test_ff_owner_1@fitforge.test'),
    login('test_ff_owner_2@fitforge.test'),
    login('test_ff_trainer_2@fitforge.test'),
    login('test_ff_member_1@fitforge.test'),
    waitReady(20_000),
  ]);
  Object.assign(tokens, { ownerA, ownerB, trainerA, memberA });

  const { data: namedGyms, error: gymError } = await adminDb
    .from('gyms')
    .select('id, name')
    .in('name', ['TEST_FF_Gym_Alpha', 'TEST_FF_Gym_Beta']);
  if (gymError) throw gymError;
  gyms.a = namedGyms.find((gym) => gym.name === 'TEST_FF_Gym_Alpha')?.id;
  gyms.b = namedGyms.find((gym) => gym.name === 'TEST_FF_Gym_Beta')?.id;
  if (!gyms.a || !gyms.b) throw new Error('Expected seeded Gym Alpha and Gym Beta');

  const { data: betaItem, error: betaError } = await adminDb
    .from('gym_equipment')
    .insert({ gym_id: gyms.b, name: `${PREFIX}B_TARGET`, category: 'Cardio', quantity: 1, condition: 'Good' })
    .select('id')
    .single();
  if (betaError) throw betaError;
  records.beta = betaItem.id;
});

after(async () => {
  server?.kill('SIGTERM');
  if (adminDb) await adminDb.from('gym_equipment').delete().like('name', `${PREFIX}%`);
});

describe('equipment route ownership isolation', () => {
  test('rejects unauthenticated, trainer, and member inventory requests', async () => {
    assert.equal((await hit('GET', `/api/equipment/${gyms.a}`)).status, 401);
    assert.equal((await hit('GET', `/api/equipment/${gyms.a}`, { token: tokens.trainerA })).status, 403);
    assert.equal((await hit('GET', `/api/equipment/${gyms.a}`, { token: tokens.memberA })).status, 403);
  });

  test('allows an owner to create, list, update, and delete only their own equipment', async () => {
    const created = await hit('POST', `/api/equipment/${gyms.a}`, {
      token: tokens.ownerA,
      body: { name: `${PREFIX}A_OWN`, category: 'Strength', quantity: 1, condition: 'Good', gym_id: gyms.b },
    });
    assert.equal(created.status, 201);
    assert.equal(created.body.gym_id, gyms.a, 'server must ignore a client-supplied gym_id');
    records.alpha = created.body.id;

    const listed = await hit('GET', `/api/equipment/${gyms.a}`, { token: tokens.ownerA });
    assert.equal(listed.status, 200);
    assert.ok(listed.body.some((item) => item.id === records.alpha));
    assert.ok(!listed.body.some((item) => item.id === records.beta));

    const updated = await hit('PATCH', `/api/equipment/${gyms.a}/${records.alpha}`, {
      token: tokens.ownerA, body: { condition: 'Needs Repair' },
    });
    assert.equal(updated.status, 200);
    assert.equal(updated.body.condition, 'Needs Repair');

    assert.equal((await hit('DELETE', `/api/equipment/${gyms.a}/${records.alpha}`, { token: tokens.ownerA })).status, 200);
  });

  test('rejects cross-gym URLs, actual foreign IDs, and guessed IDs without changing Gym B equipment', async () => {
    assert.equal((await hit('GET', `/api/equipment/${gyms.b}`, { token: tokens.ownerA })).status, 403);
    assert.equal((await hit('PATCH', `/api/equipment/${gyms.b}/${records.beta}`, {
      token: tokens.ownerA, body: { name: `${PREFIX}STOLEN` },
    })).status, 403);
    assert.equal((await hit('PATCH', `/api/equipment/${gyms.a}/${records.beta}`, {
      token: tokens.ownerA, body: { name: `${PREFIX}STOLEN` },
    })).status, 404);
    assert.equal((await hit('DELETE', `/api/equipment/${gyms.a}/00000000-0000-0000-0000-000000000000`, {
      token: tokens.ownerA,
    })).status, 404);

    const { data, error } = await adminDb.from('gym_equipment').select('gym_id, name').eq('id', records.beta).single();
    if (error) throw error;
    assert.deepEqual(data, { gym_id: gyms.b, name: `${PREFIX}B_TARGET` });
  });
});
