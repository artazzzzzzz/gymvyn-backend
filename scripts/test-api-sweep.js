#!/usr/bin/env node
/*
 * FitForge API test sweep — hits every mounted backend route with seeded TEST_FF_
 * data and writes incremental results to scripts/test-results-api.md.
 *
 * Skips ML routes (fitforge-ml not deployed) and AI generation routes (cost/slow).
 *
 * Usage:
 *   node scripts/test-api-sweep.js              # full sweep
 *   node scripts/test-api-sweep.js --only=lockers   # one area
 *   API_BASE=http://localhost:3000 node scripts/test-api-sweep.js  # local
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

const API_BASE = process.env.API_BASE || 'https://fitforge-backend-production-1c93.up.railway.app';
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SUPABASE_SERVICE_KEY) {
  console.error('Missing env vars'); process.exit(1);
}

const PASSWORD = 'TestFF!2026';
const onlyArg = process.argv.find((a) => a.startsWith('--only='));
const ONLY = onlyArg ? onlyArg.split('=')[1].split(',') : null;

const REPORT = path.join(__dirname, 'test-results-api.md');
const counters = { pass: 0, fail: 0, skip: 0 };
const failures = [];

const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// ---------------------------------------------------------------------------
// Report helpers
// ---------------------------------------------------------------------------

function startReport() {
  const header = `# FitForge API Sweep Results\n\nGenerated: ${new Date().toISOString()}\nAPI_BASE: ${API_BASE}\n\n`;
  fs.writeFileSync(REPORT, header);
}
function section(title) {
  fs.appendFileSync(REPORT, `\n## ${title}\n`);
  console.log(`\n=== ${title} ===`);
}
function log(line) {
  fs.appendFileSync(REPORT, line + '\n');
  console.log(line);
}
function pass(label, status) { counters.pass++; log(`- ✅ ${label} — ${status}`); }
function fail(label, status, msg) {
  counters.fail++;
  failures.push({ label, status, msg });
  log(`- ❌ ${label} — ${status} — ${truncate(msg, 200)}`);
}
function skip(label, reason) { counters.skip++; log(`- ⏭ SKIP ${label} — ${reason}`); }
function truncate(s, n) { s = String(s || ''); return s.length > n ? s.slice(0, n) + '…' : s; }

// ---------------------------------------------------------------------------
// HTTP helper
// ---------------------------------------------------------------------------

async function req(method, urlPath, { token, body, query } = {}) {
  let url = API_BASE + urlPath;
  if (query) {
    const qs = new URLSearchParams(query).toString();
    if (qs) url += (url.includes('?') ? '&' : '?') + qs;
  }
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const init = { method, headers };
  if (body !== undefined) init.body = JSON.stringify(body);
  const r = await fetch(url, init);
  const text = await r.text();
  let parsed = null;
  try { parsed = JSON.parse(text); } catch {}
  return { status: r.status, body: parsed, raw: text, ok: r.ok };
}

async function test(method, urlPath, opts = {}) {
  const { token, body, query, expect = [200, 201, 204], label } = opts;
  const lbl = label || `${method} ${urlPath}`;
  try {
    const r = await req(method, urlPath, { token, body, query });
    if (expect.includes(r.status)) {
      pass(lbl, r.status);
      return r;
    }
    fail(lbl, r.status, r.raw);
    return r;
  } catch (e) {
    fail(lbl, 'EXCEPTION', e.message);
    return { status: 0, body: null, raw: e.message, ok: false };
  }
}

// ---------------------------------------------------------------------------
// Sign in all test users → token map
// ---------------------------------------------------------------------------

const ROSTER = [
  { key: 'owner_1',   email: 'test_ff_owner_1@fitforge.test' },
  { key: 'trainer_1', email: 'test_ff_trainer_1@fitforge.test' },
  { key: 'trainer_2', email: 'test_ff_trainer_2@fitforge.test' },
  { key: 'trainer_3', email: 'test_ff_trainer_3@fitforge.test' },
  ...Array.from({ length: 10 }, (_, i) => ({ key: `member_${i + 1}`, email: `test_ff_member_${i + 1}@fitforge.test` })),
  { key: 'solo_1', email: 'test_ff_solo_1@fitforge.test' },
  { key: 'solo_2', email: 'test_ff_solo_2@fitforge.test' },
  { key: 'client_1', email: 'test_ff_client_1@fitforge.test' },
  { key: 'client_2', email: 'test_ff_client_2@fitforge.test' },
  { key: 'client_3', email: 'test_ff_client_3@fitforge.test' },
];

async function signInAll() {
  const tokens = {};
  const ids = {};
  // NOTE: SUPABASE_ANON_KEY in this project's .env is a publishable key that
  // GoTrue rejects ("Invalid API key"). Using SERVICE_KEY for sign-in works —
  // the returned access_tokens are still normal user JWTs accepted by backend
  // auth middleware. This is sweep-only; nothing changes for production clients.
  const supabasePub = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
  for (const r of ROSTER) {
    const { data, error } = await supabasePub.auth.signInWithPassword({ email: r.email, password: PASSWORD });
    if (error) { console.error(`Sign-in failed for ${r.email}: ${error.message}`); process.exit(1); }
    tokens[r.key] = data.session.access_token;
    ids[r.key] = data.user.id;
  }
  console.log(`Signed in ${Object.keys(tokens).length} users`);
  return { tokens, ids };
}

// ---------------------------------------------------------------------------
// Discover gym id + locker/product/expense ids for read-side tests
// ---------------------------------------------------------------------------

async function discoverState() {
  const { data: gym } = await supabaseAdmin.from('gyms').select('id').eq('name', 'TEST_FF_Gym_Alpha').single();
  const { data: lockers } = await supabaseAdmin.from('gym_lockers').select('id, label').eq('gym_id', gym.id);
  const { data: products } = await supabaseAdmin.from('supplement_products').select('id, name, is_active, stock_count').eq('gym_id', gym.id);
  const { data: expenses } = await supabaseAdmin.from('gym_expenses').select('id').eq('gym_id', gym.id).limit(1);
  const { data: assignments } = await supabaseAdmin.from('locker_assignments').select('id').eq('gym_id', gym.id);
  return { gymId: gym.id, lockers, products, expenseId: expenses?.[0]?.id, assignmentId: assignments?.[0]?.id };
}

// ---------------------------------------------------------------------------
// Area: health
// ---------------------------------------------------------------------------

async function areaHealth() {
  section('Health');
  await test('GET', '/health');
}

// ---------------------------------------------------------------------------
// Area: users
// ---------------------------------------------------------------------------

async function areaUsers(ctx) {
  section('Users');
  const { tokens, ids } = ctx;
  await test('GET', `/api/users/${ids.owner_1}`, { token: tokens.owner_1 });
  await test('GET', `/api/users/${ids.member_1}`, { token: tokens.member_1 });
  await test('PATCH', `/api/users/${ids.member_5}`, {
    token: tokens.member_5,
    body: { current_weight: 75 },
  });
}

// ---------------------------------------------------------------------------
// Area: gym (owner-side reads)
// ---------------------------------------------------------------------------

async function areaGym(ctx) {
  section('Gym (owner side)');
  const { tokens, ids, gymId } = ctx;
  await test('GET', `/api/gyms/owner/${ids.owner_1}`, { token: tokens.owner_1 });
  await test('GET', `/api/gyms/${gymId}/settings`, { token: tokens.owner_1 });
  await test('GET', `/api/gym-members`, { token: tokens.owner_1, query: { gymId } });
  await test('GET', `/api/gym-members/count/${gymId}`, { token: tokens.owner_1 });
  await test('GET', `/api/gym-members-search/${gymId}`, { token: tokens.owner_1, query: { q: 'TEST_FF' } });
  await test('GET', `/api/gym-trainers/${gymId}`, { token: tokens.owner_1 });
  await test('GET', `/api/gym/revenue`, { token: tokens.owner_1, query: { gym_id: gymId } });
  await test('GET', `/api/gym-payments/${gymId}/summary`, { token: tokens.owner_1 });
  await test('GET', `/api/gym-payments/${gymId}`, { token: tokens.owner_1 });
  await test('GET', `/api/gym-schedule/${gymId}`, { token: tokens.owner_1 });
  await test('GET', `/api/gym-announcements/${gymId}`, { token: tokens.owner_1 });
  await test('GET', `/api/gym-occupancy/${gymId}`, { token: tokens.owner_1 });
  await test('GET', `/api/gym-checkin-history/${gymId}`, { token: tokens.owner_1 });
  await test('GET', `/api/gym-stats/${gymId}`, { token: tokens.owner_1 });
  await test('GET', `/api/gym-activity-heatmap/${gymId}`, { token: tokens.owner_1 });
  await test('GET', `/api/gym-qr/${gymId}`, { query: { user_id: ids.member_1 } });
  // detail of one member
  const memberId = ids.member_1;
  await test('GET', `/api/gym-members/${memberId}`, { token: tokens.owner_1 });
}

// ---------------------------------------------------------------------------
// Area: consumer (my-gym)
// ---------------------------------------------------------------------------

async function areaConsumer(ctx) {
  section('Consumer (my-gym, exercises, workouts, food)');
  const { tokens, ids } = ctx;
  await test('GET', `/api/my-gym/${ids.member_1}`, { token: tokens.member_1 });
  await test('GET', `/workout-plan/${ids.member_1}`);
  await test('GET', `/api/macros/${ids.member_1}`);
  await test('GET', `/api/food-logs/${ids.member_1}`);
  await test('GET', `/api/diet-plan/${ids.member_1}`);
  await test('GET', `/api/custom-meals/${ids.member_1}`);
  await test('GET', `/api/user-plans/${ids.member_1}`);
  // Exercise routes
  await test('GET', `/api/exercises/Bench%20Press/metadata`);
  await test('GET', `/api/exercises/Bench%20Press/stats`, { token: tokens.member_1 });
  await test('GET', `/api/exercises/Bench%20Press/history`, { token: tokens.member_1 });
  await test('GET', `/api/exercises/Bench%20Press/bookmark`, { token: tokens.member_1 });
  await test('POST', `/api/exercises/Bench%20Press/bookmark`, { token: tokens.member_1 });
  await test('DELETE', `/api/exercises/Bench%20Press/bookmark`, { token: tokens.member_1 });
  // Posts + leaderboard
  await test('GET', `/posts`);
  await test('GET', `/leaderboard`);
  await test('GET', `/buddy-suggestions/${ids.member_1}`);
  await test('GET', `/progress-photos/${ids.member_1}`);
}

// ---------------------------------------------------------------------------
// Area: XP
// ---------------------------------------------------------------------------

async function areaXP(ctx) {
  section('XP');
  const { tokens } = ctx;
  await test('GET', '/api/xp/profile', { token: tokens.member_1 });
  await test('GET', '/api/xp/events', { token: tokens.member_1 });
  await test('GET', '/api/xp/leaderboard/global', { token: tokens.member_1 });
  await test('GET', '/api/xp/leaderboard/gym', { token: tokens.member_1 });
  await test('GET', '/api/xp/challenges', { token: tokens.member_1 });
  await test('GET', '/api/xp/muscle-balance', { token: tokens.member_1 });
  await test('GET', '/api/xp/season', { token: tokens.member_1 });
  // freeze (member_3 is Rookie low-activity, but no missed days yet — expect 200 with success:false)
  await test('POST', '/api/xp/freeze', { token: tokens.member_3, expect: [200, 400] });
}

// ---------------------------------------------------------------------------
// Area: trainer
// ---------------------------------------------------------------------------

async function areaTrainer(ctx) {
  section('Trainer');
  const { tokens } = ctx;
  await test('GET', '/api/trainer/my-code', { token: tokens.trainer_1 });
  await test('GET', '/api/trainer/pending-invites', { token: tokens.trainer_1 });
  await test('GET', '/api/trainer/my-trainer', { token: tokens.client_1 });
}

// ---------------------------------------------------------------------------
// Area: gym join codes
// ---------------------------------------------------------------------------

async function areaGymCodes(ctx) {
  section('Gym join codes');
  const { tokens } = ctx;
  await test('GET', '/api/gym/my-gym-code', { token: tokens.owner_1 });
  await test('GET', '/api/gym/join-code', { token: tokens.owner_1 });
  // member joining a gym (already in one — expect 400 "already a member" or 200, both fine)
  await test('POST', '/api/gym/join', { token: tokens.solo_1, body: { join_code: 'TFFAL1' }, expect: [200, 201, 400, 409] });
}

// ---------------------------------------------------------------------------
// Area: supplements (full create→pay→ready→complete flow)
// ---------------------------------------------------------------------------

async function areaSupplements(ctx) {
  section('Supplements');
  const { tokens, products } = ctx;
  await test('GET', '/api/supplements/products', { token: tokens.owner_1 });
  await test('GET', '/api/supplements/products/low-stock', { token: tokens.owner_1 });
  await test('GET', '/api/supplements/catalog', { token: tokens.member_1 });
  await test('GET', '/api/supplements/orders', { token: tokens.owner_1 });
  await test('GET', '/api/supplements/orders/mine', { token: tokens.member_1 });
  // create new product (owner)
  const createRes = await test('POST', '/api/supplements/products', {
    token: tokens.owner_1,
    body: { name: 'TEST_FF Sweep Product', price: 999, category: 'protein', stock_count: 10, description: 'sweep' },
    expect: [200, 201],
  });
  const newProdId = createRes.body?.product?.id || createRes.body?.id;
  if (newProdId) {
    await test('PATCH', `/api/supplements/products/${newProdId}`, {
      token: tokens.owner_1,
      body: { price: 1099, stock_count: 12 },
    });
    await test('DELETE', `/api/supplements/products/${newProdId}`, { token: tokens.owner_1, expect: [200, 204] });
  } else {
    skip('PATCH/DELETE supplement product', 'creation did not return id');
  }
  // member creates order
  const inStock = (products || []).find((p) => p.is_active && p.stock_count > 0);
  if (inStock) {
    const orderRes = await test('POST', '/api/supplements/orders', {
      token: tokens.member_1,
      body: { items: [{ product_id: inStock.id, quantity: 1 }] },
      expect: [200, 201],
    });
    const orderId = orderRes.body?.order?.id || orderRes.body?.id;
    if (orderId) {
      await test('PATCH', `/api/supplements/orders/${orderId}/status`, {
        token: tokens.owner_1, body: { status: 'ready_for_pickup' },
      });
      await test('PATCH', `/api/supplements/orders/${orderId}/payment`, {
        token: tokens.owner_1, body: { payment_status: 'paid', payment_method: 'cash' },
      });
      await test('PATCH', `/api/supplements/orders/${orderId}/confirm-payment`, {
        token: tokens.member_1, body: {},
      });
    }
  } else {
    skip('member create order', 'no in-stock product');
  }
}

// ---------------------------------------------------------------------------
// Area: expenses
// ---------------------------------------------------------------------------

async function areaExpenses(ctx) {
  section('Expenses');
  const { tokens } = ctx;
  await test('GET', '/api/expenses/', { token: tokens.owner_1 });
  await test('GET', '/api/expenses/summary', { token: tokens.owner_1 });
  await test('GET', '/api/expenses/summary/monthly', { token: tokens.owner_1 });
  // create + patch + delete
  const created = await test('POST', '/api/expenses/', {
    token: tokens.owner_1,
    body: { category: 'other', amount: 123.45, description: 'TEST_FF sweep expense', expense_date: new Date().toISOString().slice(0, 10) },
    expect: [200, 201],
  });
  const expId = created.body?.expense?.id || created.body?.id;
  if (expId) {
    await test('PATCH', `/api/expenses/${expId}`, { token: tokens.owner_1, body: { amount: 200 } });
    await test('DELETE', `/api/expenses/${expId}`, { token: tokens.owner_1, expect: [200, 204] });
  } else {
    skip('PATCH/DELETE expense', 'create did not return id');
  }
}

// ---------------------------------------------------------------------------
// Area: lockers
// ---------------------------------------------------------------------------

async function areaLockers(ctx) {
  section('Lockers');
  const { tokens, ids } = ctx;
  await test('GET', '/api/lockers/', { token: tokens.owner_1 });
  await test('GET', '/api/lockers/settings', { token: tokens.owner_1 });
  await test('GET', '/api/lockers/expiring-soon', { token: tokens.owner_1 });
  // Create new locker → assign → mark paid → end
  const created = await test('POST', '/api/lockers/', {
    token: tokens.owner_1,
    body: { label: 'TEST_FF_SWEEP_' + Date.now(), is_paid: true, price: 250, status: 'available' },
    expect: [200, 201],
  });
  const lockerId = created.body?.locker?.id || created.body?.id;
  if (lockerId) {
    await test('PATCH', `/api/lockers/${lockerId}`, { token: tokens.owner_1, body: { status: 'maintenance' } });
    await test('PATCH', `/api/lockers/${lockerId}`, { token: tokens.owner_1, body: { status: 'available' } });
    const assign = await test('POST', `/api/lockers/${lockerId}/assign`, {
      token: tokens.owner_1, body: { member_id: ids.member_4, duration_days: 30 },
      expect: [200, 201],
    });
    if (assign.ok) {
      await test('PATCH', `/api/lockers/${lockerId}/payment`, {
        token: tokens.owner_1, body: { payment_status: 'paid', payment_method: 'cash' }, expect: [200, 204],
      });
      await test('PATCH', `/api/lockers/${lockerId}/end-assignment`, { token: tokens.owner_1, expect: [200, 204] });
    }
    // After ending assignment, locker now has history → DELETE returns 409 by design. Verify that.
    const delRes = await req('DELETE', `/api/lockers/${lockerId}`, { token: tokens.owner_1 });
    if (delRes.status === 409) pass(`DELETE /api/lockers/:id (locker with history)`, '409 (expected — has assignment history)');
    else if (delRes.ok) pass(`DELETE /api/lockers/:id`, delRes.status);
    else fail(`DELETE /api/lockers/:id`, delRes.status, delRes.raw);
  }
}

// ---------------------------------------------------------------------------
// Area: announcements (create → list → delete)
// ---------------------------------------------------------------------------

async function areaAnnouncements(ctx) {
  section('Announcements');
  const { tokens, ids, gymId } = ctx;
  const created = await test('POST', '/api/gym-announcements', {
    token: tokens.owner_1,
    body: { gym_id: gymId, posted_by: ids.owner_1, title: 'TEST_FF sweep', body: 'TEST_FF sweep body', priority: 'normal' },
    expect: [200, 201],
  });
  const annId = created.body?.announcement_id || created.body?.id;
  if (annId) {
    await test('DELETE', `/api/gym-announcements/${annId}`, { token: tokens.owner_1 });
  }
}

// ---------------------------------------------------------------------------
// Area: membership ops (manual create + renew + delete)
// ---------------------------------------------------------------------------

async function areaMemberships(ctx) {
  section('Memberships (manual ops)');
  const { tokens, ids, gymId } = ctx;
  // manual create — use a unique phone per run to allow idempotent sweep re-runs
  const uniquePhone = '9' + String(Date.now()).slice(-9);
  const created = await test('POST', '/api/gym-members/manual', {
    token: tokens.owner_1,
    body: { gym_id: gymId, full_name: 'TEST_FF Manual Member', phone: uniquePhone, membership_type: 'monthly', monthly_fee: 1500, start_date: new Date().toISOString().slice(0, 10) },
    expect: [200, 201],
  });
  const newMemId = created.body?.member?.id || created.body?.id || created.body?.membership?.id;
  // renew existing seeded member
  const renewEnd = new Date(); renewEnd.setDate(renewEnd.getDate() + 30);
  await test('POST', `/api/gym-members/${ids.member_5}/renew`, {
    token: tokens.owner_1,
    body: { membership_type: 'monthly', monthly_fee: 1500, amount: 1500, new_end_date: renewEnd.toISOString().slice(0, 10) },
  });
  if (newMemId) {
    await test('DELETE', `/api/gym-members/${newMemId}`, { token: tokens.owner_1, expect: [200, 204] });
  } else {
    skip('DELETE manual member', 'create did not return id');
  }
}

// ---------------------------------------------------------------------------
// Area: lockers_enabled feature flag (turn off → expect 403, turn back on)
// ---------------------------------------------------------------------------

async function areaLockerFeatureFlag(ctx) {
  section('Locker feature flag');
  const { tokens, gymId } = ctx;
  // turn off
  await supabaseAdmin.from('gyms').update({ lockers_enabled: false }).eq('id', gymId);
  const r = await req('GET', `/api/lockers/`, { token: tokens.owner_1 });
  if (r.status === 403) pass(`GET /api/lockers/ with flag OFF`, '403');
  else if (r.status >= 500) fail(`GET /api/lockers/ with flag OFF`, r.status, r.raw);
  else fail(`GET /api/lockers/ with flag OFF`, r.status, `expected 403, got ${r.status}: ${truncate(r.raw, 100)}`);
  // restore
  await supabaseAdmin.from('gyms').update({ lockers_enabled: true }).eq('id', gymId);
}

// ---------------------------------------------------------------------------
// Area: SKIPPED routes
// ---------------------------------------------------------------------------

async function areaSkipped() {
  section('Skipped (out of scope)');
  skip('POST /generate-workout-plan', 'AI cost/latency');
  skip('POST /generate-diet-plan', 'AI cost/latency');
  skip('POST /api/diet-plan/generate', 'AI cost/latency');
  skip('POST /chat', 'AI cost');
  skip('POST /api/food-logs/voice', 'AI parsing');
  skip('POST /api/food-logs/camera', 'AI parsing');
  skip('POST /upload-progress-photo', 'multipart upload');
  skip('POST /api/gyms/:gymId/upload-logo', 'multipart upload');
  skip('POST /api/gym-members/csv-import', 'multipart upload');
  skip('GET  /api/ml/*', 'fitforge-ml not deployed');
  skip('POST /api/gym-churn/score/:gymId', 'depends on ML');
  skip('GET  /api/ml/scores/:gymId', 'depends on ML');
}

// ---------------------------------------------------------------------------
// Area: route hygiene — dead unmounted file
// ---------------------------------------------------------------------------

async function areaHygiene() {
  section('Route hygiene');
  // routes/xpRoutes.js exists but server.js imports src/routes/xpRoutes.js — the
  // root-level file is dead code (stub routes returning placeholder objects).
  // Not a runtime bug, but flagged per the recurring-bug checklist.
  log(`- ⚠ Dead route file: \`routes/xpRoutes.js\` is a stub and not mounted. Real file is \`src/routes/xpRoutes.js\` (correctly mounted). Recommend deleting the stub.`);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const AREAS = {
  health: areaHealth,
  users: areaUsers,
  gym: areaGym,
  consumer: areaConsumer,
  xp: areaXP,
  trainer: areaTrainer,
  codes: areaGymCodes,
  supplements: areaSupplements,
  expenses: areaExpenses,
  lockers: areaLockers,
  announcements: areaAnnouncements,
  memberships: areaMemberships,
  lockerFlag: areaLockerFeatureFlag,
  skipped: areaSkipped,
  hygiene: areaHygiene,
};

async function main() {
  startReport();
  console.log(`Signing in test users…`);
  const { tokens, ids } = await signInAll();
  const state = await discoverState();
  const ctx = { tokens, ids, ...state };

  for (const [name, fn] of Object.entries(AREAS)) {
    if (ONLY && !ONLY.includes(name)) continue;
    try { await fn(ctx); }
    catch (e) { fail(`AREA ${name}`, 'EXCEPTION', e.message); }
  }

  const summary = `\n## Summary\n\n- ✅ Passed: ${counters.pass}\n- ❌ Failed: ${counters.fail}\n- ⏭ Skipped: ${counters.skip}\n`;
  fs.appendFileSync(REPORT, summary);
  console.log(summary);
  if (failures.length) {
    console.log(`\nFailures:`);
    failures.forEach((f) => console.log(`  - ${f.label} [${f.status}] ${truncate(f.msg, 120)}`));
  }
}

main().catch((e) => { console.error('FATAL', e); process.exit(1); });
