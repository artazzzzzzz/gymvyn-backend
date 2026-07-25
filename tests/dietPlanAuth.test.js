'use strict';

/*
 * Auth regression suite — AI diet-plan surfaces
 *
 * Covers:
 * - Member AI diet plans in user_diet_plans:
 *   POST /api/diet-plan/generate
 *   GET  /api/diet-plan/:userId
 * - Direct macro recalculation used by member diet generation:
 *   POST /api/macros/calculate
 * - Trainer-edited AI client plans in client_diet_plans:
 *   PATCH /api/client-diet-plans/:planId
 *
 * The external DeepSeek call is not exercised here. Generate-route tests stop
 * at auth/ownership/validation so the suite stays deterministic and cheap.
 */

require('dotenv').config();
const { describe, test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('child_process');
const { createClient } = require('@supabase/supabase-js');
const path = require('path');

const PORT = 3097;
const BASE = `http://localhost:${PORT}`;
const PASS = 'TestFF!2026';
const CODEX_AUTH_TEST = 'CODEX_AUTH_TEST:DIET_PLAN_AUTH';

let srv;
let sb;
let adminDb;
const tokens = {};
const ids = {};
const cleanup = {
  userDietPlanIds: [],
  clientDietPlanIds: [],
  trainerClientIds: [],
};

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
  const res = await fetch(BASE + urlPath, init);
  let json = null;
  try { json = await res.json(); } catch {}
  return { status: res.status, json };
}

before(async () => {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
    throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_KEY — copy .env');
  }

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

  const [[solo1, solo2, trainer1, trainer2, client1]] = await Promise.all([
    Promise.all([
      login('test_ff_solo_1@fitforge.test'),
      login('test_ff_solo_2@fitforge.test'),
      login('test_ff_trainer_1@fitforge.test'),
      login('test_ff_trainer_2@fitforge.test'),
      login('test_ff_client_1@fitforge.test'),
    ]),
    waitReady(20_000),
  ]);

  tokens.solo1 = solo1.token;     ids.solo1 = solo1.id;
  tokens.solo2 = solo2.token;     ids.solo2 = solo2.id;
  tokens.trainer1 = trainer1.token; ids.trainer1 = trainer1.id;
  tokens.trainer2 = trainer2.token; ids.trainer2 = trainer2.id;
  tokens.client1 = client1.token; ids.client1 = client1.id;
});

after(async () => {
  srv?.kill('SIGTERM');

  if (adminDb) {
    if (cleanup.userDietPlanIds.length) {
      await adminDb.from('user_diet_plans').delete().in('id', cleanup.userDietPlanIds);
    }
    if (cleanup.clientDietPlanIds.length) {
      await adminDb.from('client_diet_plans').delete().in('id', cleanup.clientDietPlanIds);
    }
    if (cleanup.trainerClientIds.length) {
      await adminDb.from('trainer_clients').delete().in('id', cleanup.trainerClientIds);
    }
  }
});

describe('member user_diet_plans authorization', () => {
  test('GET /api/diet-plan/:userId requires auth', async () => {
    const res = await hit('GET', `/api/diet-plan/${ids.solo1}`);
    assert.equal(res.status, 401);
  });

  test('GET /api/diet-plan/:userId blocks a changed URL userId', async () => {
    const res = await hit('GET', `/api/diet-plan/${ids.solo1}`, { token: tokens.solo2 });
    assert.equal(res.status, 403);
  });

  test('GET /api/diet-plan/:userId returns only the caller active plan', async () => {
    const { data, error } = await adminDb
      .from('user_diet_plans')
      .insert({
        user_id: ids.solo1,
        plan_data: {
          marker: CODEX_AUTH_TEST,
          daily_targets: { calories: 2000, protein_g: 120, carbs_g: 220, fat_g: 60 },
          days: [],
        },
        diet_type: 'veg',
        cuisine_pref: 'gujarati',
        is_active: true,
      })
      .select('id')
      .single();
    if (error) throw error;
    cleanup.userDietPlanIds.push(data.id);

    const res = await hit('GET', `/api/diet-plan/${ids.solo1}`, { token: tokens.solo1 });
    assert.equal(res.status, 200);
    assert.equal(res.json.id, data.id);
    assert.equal(res.json.user_id, ids.solo1);
  });

  test('POST /api/diet-plan/generate requires auth', async () => {
    const res = await hit('POST', '/api/diet-plan/generate', {
      body: { dietType: 'veg', cuisinePref: 'north_indian' },
    });
    assert.equal(res.status, 401);
  });

  test('POST /api/diet-plan/generate rejects forged body userId before AI generation', async () => {
    const res = await hit('POST', '/api/diet-plan/generate', {
      token: tokens.solo1,
      body: { userId: ids.solo2, dietType: 'veg', cuisinePref: 'north_indian' },
    });
    assert.equal(res.status, 403);
  });

  test('POST /api/diet-plan/generate rejects client-supplied profile fields', async () => {
    const res = await hit('POST', '/api/diet-plan/generate', {
      token: tokens.solo1,
      body: { dietType: 'veg', cuisinePref: 'north_indian', current_weight: 999 },
    });
    assert.equal(res.status, 400);
  });
});

describe('macro recalculation authorization used by diet generation', () => {
  test('POST /api/macros/calculate requires auth', async () => {
    const res = await hit('POST', '/api/macros/calculate', { body: { userId: ids.solo1 } });
    assert.equal(res.status, 401);
  });

  test('POST /api/macros/calculate blocks another userId', async () => {
    const res = await hit('POST', '/api/macros/calculate', {
      token: tokens.solo1,
      body: { userId: ids.solo2 },
    });
    assert.equal(res.status, 403);
  });

  test('POST /api/macros/calculate allows self', async () => {
    const res = await hit('POST', '/api/macros/calculate', {
      token: tokens.solo1,
      body: { userId: ids.solo1 },
    });
    assert.equal(res.status, 200);
    assert.equal(res.json.success, true);
    assert.equal(res.json.macros.user_id, ids.solo1);
  });
});

describe('trainer AI client diet-plan edit authorization', () => {
  test('active trainer can edit own generated client diet plan', async () => {
    const { data, error } = await adminDb
      .from('client_diet_plans')
      .insert({
        trainer_id: ids.trainer1,
        client_user_id: ids.client1,
        name: `${CODEX_AUTH_TEST} active`,
        description: CODEX_AUTH_TEST,
        plan_data: { marker: CODEX_AUTH_TEST, days: [] },
        is_active: true,
      })
      .select('id')
      .single();
    if (error) throw error;
    cleanup.clientDietPlanIds.push(data.id);

    const res = await hit('PATCH', `/api/client-diet-plans/${data.id}`, {
      token: tokens.trainer1,
      body: { description: `${CODEX_AUTH_TEST} updated` },
    });
    assert.equal(res.status, 200);
    assert.equal(res.json.description, `${CODEX_AUTH_TEST} updated`);
  });

  test('stale trainer-client relationship cannot edit historical generated plan', async () => {
    const { data: rel, error: relErr } = await adminDb
      .from('trainer_clients')
      .insert({
        trainer_id: ids.trainer2,
        client_id: ids.client1,
        status: 'removed',
        notes: CODEX_AUTH_TEST,
      })
      .select('id')
      .single();
    if (relErr) throw relErr;
    cleanup.trainerClientIds.push(rel.id);

    const { data: plan, error: planErr } = await adminDb
      .from('client_diet_plans')
      .insert({
        trainer_id: ids.trainer2,
        client_user_id: ids.client1,
        name: `${CODEX_AUTH_TEST} stale`,
        description: CODEX_AUTH_TEST,
        plan_data: { marker: CODEX_AUTH_TEST, days: [] },
        is_active: true,
      })
      .select('id')
      .single();
    if (planErr) throw planErr;
    cleanup.clientDietPlanIds.push(plan.id);

    const res = await hit('PATCH', `/api/client-diet-plans/${plan.id}`, {
      token: tokens.trainer2,
      body: { description: `${CODEX_AUTH_TEST} should not update` },
    });
    assert.equal(res.status, 403);
  });
});
