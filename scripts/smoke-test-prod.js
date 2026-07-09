#!/usr/bin/env node
/*
 * Production smoke test — run this immediately after every deploy.
 *
 * Hits the LIVE backend directly over HTTP (not through a browser), so it
 * can never produce the false positive/negative that a sandboxed or
 * network-restricted browser preview can: this script's result reflects
 * what the backend actually returns, headers included, with no browser-
 * side egress policy in the way.
 *
 * Checks, in order:
 *   1. CORS allows a representative localhost origin (any port — the
 *      unconditional localhost/127.0.0.1 rule from commit ddafa87).
 *   2. CORS blocks a non-allowlisted origin (evil.example.com).
 *   3. Core owner/trainer/member endpoints implicated in the recurring
 *      "Couldn't load" bug all return 200 with a valid token — not
 *      401/403/404/500.
 *
 * Usage:
 *   node scripts/smoke-test-prod.js
 *   API_BASE=https://your-other-env node scripts/smoke-test-prod.js
 *
 * Exit code is non-zero if anything fails — safe to wire into CI or a
 * post-deploy step.
 */

require('dotenv').config();

const API_BASE = process.env.API_BASE || 'https://gymvyn-backend-production.up.railway.app';
// Publishable anon key — safe to default in source, matches the value already
// checked into the frontend's .env. Overridable via env var for other projects.
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://jaxnqttycxeavwhcsoyv.supabase.co';
// .env in this repo has previously carried a corrupted anon key — a truthy
// but malformed value would otherwise silently win over the fallback below,
// so require it to actually look like a Supabase key before trusting it.
const envKey = process.env.SUPABASE_ANON_KEY;
const SUPABASE_ANON_KEY = /^(sb_publishable_|eyJ)/.test(envKey || '')
  ? envKey
  : 'sb_publishable_NB1QD-neSnB3uknLBSDkcQ_wY3nI9Uu';
const PASSWORD = 'TestFF!2026';

const counters = { pass: 0, fail: 0 };
const failures = [];

function report(name, ok, detail) {
  if (ok) {
    counters.pass++;
    console.log(`  ✓ ${name}`);
  } else {
    counters.fail++;
    failures.push(`${name} — ${detail}`);
    console.log(`  ✗ ${name} — ${detail}`);
  }
}

async function login(email) {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: SUPABASE_ANON_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: PASSWORD }),
  });
  const data = await res.json();
  if (!res.ok || !data.access_token) {
    throw new Error(`login failed for ${email}: ${res.status} ${JSON.stringify(data)}`);
  }
  return { token: data.access_token, uid: data.user.id };
}

async function checkCorsAllowed(origin) {
  const res = await fetch(`${API_BASE}/health`, { headers: { Origin: origin } });
  const acao = res.headers.get('access-control-allow-origin');
  report(`CORS allows Origin: ${origin}`, acao === origin, `expected ACAO="${origin}", got "${acao}"`);
}

async function checkCorsBlocked(origin) {
  const res = await fetch(`${API_BASE}/health`, { headers: { Origin: origin } });
  const acao = res.headers.get('access-control-allow-origin');
  report(`CORS blocks Origin: ${origin}`, !acao, `expected no ACAO header, got "${acao}"`);
}

async function checkEndpoint(name, path, token, origin) {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { Authorization: `Bearer ${token}`, Origin: origin },
  });
  report(`${name} (${path})`, res.status === 200, `expected 200, got ${res.status}`);
}

async function main() {
  console.log(`Smoke-testing ${API_BASE}\n`);

  console.log('CORS —');
  await checkCorsAllowed(`http://localhost:${5170 + Math.floor(Math.random() * 100)}`); // arbitrary port, proves the rule isn't a hardcoded list
  await checkCorsAllowed('http://127.0.0.1:5174');
  await checkCorsBlocked('https://evil.example.com');
  await checkCorsAllowed('https://gymvyn-frontend.vercel.app');
  await checkCorsAllowed('https://gymvyn-admin.vercel.app');

  console.log('\nAuth —');
  const owner = await login('test_ff_owner_1@fitforge.test');
  const trainer = await login('test_ff_trainer_1@fitforge.test');
  const client = await login('test_ff_client_1@fitforge.test');
  report('owner login', !!owner.token, 'no token returned');
  report('trainer login', !!trainer.token, 'no token returned');
  report('client login', !!client.token, 'no token returned');

  const origin = 'http://localhost:5173';
  console.log('\nCore endpoints (owner/trainer/member dashboards) —');
  await checkEndpoint('gym-by-userId (owner dashboard)', `/api/gyms/${owner.uid}`, owner.token, origin);
  await checkEndpoint('my-gym (member My Gym / My Trainer surface)', `/api/my-gym/${client.uid}`, client.token, origin);
  await checkEndpoint('trainer profile (trainer dashboard)', `/api/trainer/profile/${trainer.uid}`, trainer.token, origin);
  await checkEndpoint('trainer clients (trainer dashboard)', `/api/trainer/clients/${trainer.uid}`, trainer.token, origin);
  await checkEndpoint('my-trainer (member My Trainer card)', `/api/trainer/my-trainer/${client.uid}`, client.token, origin);

  // gym-members needs a gymId — resolve it from the gym-by-userId response.
  const gymRes = await fetch(`${API_BASE}/api/gyms/${owner.uid}`, {
    headers: { Authorization: `Bearer ${owner.token}`, Origin: origin },
  });
  const gym = await gymRes.json().catch(() => null);
  if (gym?.id) {
    await checkEndpoint('gym-members (owner dashboard)', `/api/gym-members?gymId=${gym.id}`, owner.token, origin);
  } else {
    report('gym-members (owner dashboard)', false, 'could not resolve gym id from /api/gyms/:userId response');
  }

  console.log(`\n${counters.pass} passed, ${counters.fail} failed`);
  if (counters.fail > 0) {
    console.log('\nFailures:');
    failures.forEach((f) => console.log(`  - ${f}`));
    process.exit(1);
  }
  process.exit(0);
}

main().catch((err) => {
  console.error('Smoke test crashed:', err);
  process.exit(1);
});
