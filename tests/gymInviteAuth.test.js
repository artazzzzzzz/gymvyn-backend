'use strict';

// Live regression coverage for member-code/QR/phone onboarding authorization.
require('dotenv').config();
const { after, before, describe, test } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('child_process');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

const PORT = 3104;
const BASE = `http://localhost:${PORT}`;
const PASS = 'TestFF!2026';
let server; let db;
const tokens = {}; const ids = {}; const gyms = {};

async function waitReady(ms) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    try { if ((await fetch(`${BASE}/health`)).ok) return; } catch {}
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  throw new Error('Invite test server did not start');
}
async function hit(method, pathName, { token, body } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const response = await fetch(`${BASE}${pathName}`, { method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  return { status: response.status, body: await response.json().catch(() => null) };
}

before(async () => {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) throw new Error('Missing Supabase test configuration');
  db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
  const loginClient = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
  const login = async (key, email) => {
    const { data, error } = await loginClient.auth.signInWithPassword({ email, password: PASS });
    if (error) throw error;
    tokens[key] = data.session.access_token; ids[key] = data.user.id;
  };
  server = spawn('node', ['server.js'], { cwd: path.join(__dirname, '..'), env: { ...process.env, PORT: String(PORT) }, stdio: 'ignore' });
  await Promise.all([
    login('ownerA', 'test_ff_owner_1@fitforge.test'), login('ownerB', 'test_ff_owner_2@fitforge.test'),
    login('trainer', 'test_ff_trainer_2@fitforge.test'), login('member', 'test_ff_member_1@fitforge.test'),
    login('solo', 'test_ff_solo_2@fitforge.test'), waitReady(20000),
  ]);
  const { data, error } = await db.from('gyms').select('id, name, join_code').in('name', ['TEST_FF_Gym_Alpha', 'TEST_FF_Gym_Beta']);
  if (error) throw error;
  gyms.a = data.find(g => g.name === 'TEST_FF_Gym_Alpha'); gyms.b = data.find(g => g.name === 'TEST_FF_Gym_Beta');
  if (!gyms.a || !gyms.b) throw new Error('Expected both seeded gyms');
});

after(async () => {
  server?.kill('SIGTERM');
  if (!db || !ids.solo) return;
  await db.from('gym_memberships').update({ status: 'inactive' }).eq('user_id', ids.solo);
  await db.from('users').update({ gym_id: null, role: 'consumer' }).eq('id', ids.solo);
});

describe('member invitation authorization', () => {
  test('owner gets only its own join code; other roles and no token are blocked', async () => {
    const own = await hit('GET', '/api/gym/my-gym-code', { token: tokens.ownerA });
    assert.equal(own.status, 200); assert.equal(own.body.gym_id, gyms.a.id); assert.equal(own.body.join_code, gyms.a.join_code);
    assert.equal((await hit('GET', '/api/gym/my-gym-code')).status, 401);
    assert.equal((await hit('GET', '/api/gym/my-gym-code', { token: tokens.member })).status, 404);
    assert.equal((await hit('GET', '/api/gym/my-gym-code', { token: tokens.trainer })).status, 404);
  });

  test('a member can join the exact gym from its shared code, while privileged roles cannot', async () => {
    const joined = await hit('POST', '/api/gym/join', { token: tokens.solo, body: { join_code: gyms.a.join_code } });
    assert.equal(joined.status, 200); assert.equal(joined.body.gym_id, gyms.a.id);
    assert.equal((await hit('POST', '/api/gym/join', { token: tokens.ownerA, body: { join_code: gyms.b.join_code } })).status, 403);
    assert.equal((await hit('POST', '/api/gym/join', { token: tokens.trainer, body: { join_code: gyms.b.join_code } })).status, 403);
    assert.equal((await hit('POST', '/api/gym/join', { token: tokens.solo, body: { join_code: 'WRONG1' } })).status, 400);
  });

  test('email invitation validates input and cannot be targeted at another owner’s gym', async () => {
    assert.equal((await hit('POST', '/api/gym-members/invite-email')).status, 401);
    assert.equal((await hit('POST', '/api/gym-members/invite-email', { token: tokens.ownerA, body: { gym_id: gyms.b.id, email: 'member@example.com' } })).status, 403);
    assert.equal((await hit('POST', '/api/gym-members/invite-email', { token: tokens.ownerA, body: { gym_id: gyms.a.id, email: 'not-an-email' } })).status, 400);
    assert.equal((await hit('POST', '/api/gym-members/invite-email', { token: tokens.member, body: { gym_id: gyms.a.id, email: 'member@example.com' } })).status, 403);
  });
});
