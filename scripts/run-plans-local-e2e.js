'use strict';

// LOCAL-ONLY Gymvyn Plans smoke test. It creates one synthetic trainer plus
// workout/diet templates, exercises the authenticated API, and removes every
// row it created. It refuses to run unless the local Supabase Docker stack is
// explicitly selected.

const { spawn, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { createClient } = require('@supabase/supabase-js');

const ROOT = path.resolve(__dirname, '..');
const PLANS_SITE_ROOT = path.resolve(ROOT, '..', 'gymvyn-plans');
const CONTAINER = 'supabase_db_gymvyn-backend';
const PORT = 5057;
const SITE_PORT = 3057;
const TRAINER_EMAIL = 'gymvyn-plans-e2e-trainer@local.test';
const BUYER_EMAIL = 'gymvyn-plans-e2e-buyer@local.test';
const OTHER_BUYER_EMAIL = 'gymvyn-plans-e2e-other-buyer@local.test';
const PASSWORD = 'LocalPlansE2E!2026';
const WORKOUT_ID = '71000000-0000-0000-0000-000000000001';
const DIET_ID = '72000000-0000-0000-0000-000000000001';

function fail(message) { throw new Error(`Plans local E2E: ${message}`); }
function run(command, args, input) {
  const result = spawnSync(command, args, { cwd: ROOT, encoding: 'utf8', input, stdio: input === undefined ? ['ignore', 'pipe', 'pipe'] : ['pipe', 'pipe', 'pipe'] });
  if (result.error || result.status !== 0) fail(`${command} ${args.join(' ')} failed: ${(result.stderr || '').trim()}`);
  return result.stdout;
}
function sql(statement) {
  return run('docker', ['exec', '-i', CONTAINER, 'psql', '-X', '-A', '-t', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres', '-d', 'postgres'], statement);
}
function isLocal(url) {
  try { return ['localhost', '127.0.0.1', '::1'].includes(new URL(url).hostname); } catch { return false; }
}
function status() {
  if (process.env.GYMVYN_PLANS_E2E_LOCAL_ONLY !== 'true') fail('set GYMVYN_PLANS_E2E_LOCAL_ONLY=true');
  const value = JSON.parse(run('supabase', ['status', '--output', 'json']));
  if (!isLocal(value.API_URL)) fail('Supabase API must be localhost');
  if (!run('docker', ['ps', '--format', '{{.Names}}']).split(/\r?\n/).includes(CONTAINER)) fail('local Supabase database container is not running');
  return value;
}
function tableExists(name) {
  return sql(`SELECT to_regclass('public.${name}') IS NOT NULL;`).trim() === 't';
}
function ensureLocalSchema() {
  sql(`
    CREATE EXTENSION IF NOT EXISTS pgcrypto;
    CREATE TABLE IF NOT EXISTS trainer_profiles (user_id UUID PRIMARY KEY REFERENCES users(id), is_active BOOLEAN NOT NULL DEFAULT true, status TEXT NOT NULL DEFAULT 'active');
    CREATE TABLE IF NOT EXISTS trainer_templates (id UUID PRIMARY KEY, trainer_id UUID NOT NULL REFERENCES users(id), type TEXT NOT NULL, name TEXT NOT NULL, template_data JSONB NOT NULL DEFAULT '{}'::jsonb, updated_at TIMESTAMPTZ NOT NULL DEFAULT now());
    CREATE TABLE IF NOT EXISTS diet_plan_templates (id UUID PRIMARY KEY, trainer_id UUID NOT NULL REFERENCES users(id), name TEXT NOT NULL, detail_level TEXT, updated_at TIMESTAMPTZ NOT NULL DEFAULT now());
    CREATE TABLE IF NOT EXISTS assigned_plans (id UUID PRIMARY KEY);
    CREATE TABLE IF NOT EXISTS assigned_diet_plans (id UUID PRIMARY KEY);
  `);
  sql(fs.readFileSync(path.join(ROOT, 'migrations/plans_phase1_foundation.sql'), 'utf8'));
  sql(`
    GRANT USAGE ON SCHEMA public TO service_role;
    GRANT ALL ON TABLE users, trainer_profiles, trainer_templates, diet_plan_templates, assigned_plans, assigned_diet_plans,
      plans_listings, plans_listing_versions, plans_purchases, plans_payment_events, plans_reviews TO service_role;
    NOTIFY pgrst, 'reload schema';
  `);
}
function cleanupRows(userId) {
  if (!userId) return;
  sql(`
    DELETE FROM plans_reviews WHERE buyer_id = '${userId}' OR listing_id IN (SELECT id FROM plans_listings WHERE trainer_id = '${userId}');
    DELETE FROM plans_payment_events WHERE purchase_id IN (SELECT id FROM plans_purchases WHERE trainer_id = '${userId}' OR buyer_id = '${userId}');
    DELETE FROM plans_purchases WHERE trainer_id = '${userId}' OR buyer_id = '${userId}';
    DELETE FROM plans_listing_versions WHERE listing_id IN (SELECT id FROM plans_listings WHERE trainer_id = '${userId}');
    DELETE FROM plans_listings WHERE trainer_id = '${userId}';
    DELETE FROM trainer_templates WHERE trainer_id = '${userId}';
    DELETE FROM diet_plan_templates WHERE trainer_id = '${userId}';
    DELETE FROM trainer_profiles WHERE user_id = '${userId}';
    DELETE FROM users WHERE id = '${userId}';
  `);
}
async function request(base, endpoint, token, options = {}) {
  const response = await fetch(`${base}${endpoint}`, {
    ...options,
    headers: { ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
  });
  const body = await response.json().catch(() => null);
  return { response, body };
}
async function waitForServer(base, child, pathName = '/health') {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    if (child.exitCode !== null) fail(`local process exited before ${pathName} became available`);
    try { if ((await fetch(`${base}${pathName}`)).ok) return; } catch { /* keep waiting */ }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  fail(`local process did not make ${pathName} available`);
}

async function main() {
  const local = status();
  const before = Object.fromEntries(['trainer_profiles', 'trainer_templates', 'diet_plan_templates', 'assigned_plans', 'assigned_diet_plans', 'plans_listings', 'plans_listing_versions', 'plans_purchases', 'plans_payment_events', 'plans_reviews'].map((name) => [name, tableExists(name)]));
  ensureLocalSchema();
  const service = createClient(local.API_URL, local.SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
  const existing = await service.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (existing.error) fail(existing.error.message);
  for (const email of [TRAINER_EMAIL, BUYER_EMAIL, OTHER_BUYER_EMAIL]) {
    const oldUser = existing.data.users.find((user) => user.email === email);
    if (oldUser) { cleanupRows(oldUser.id); await service.auth.admin.deleteUser(oldUser.id); }
  }
  const createdUsers = await Promise.all([TRAINER_EMAIL, BUYER_EMAIL, OTHER_BUYER_EMAIL].map(async (email) => {
    const created = await service.auth.admin.createUser({ email, password: PASSWORD, email_confirm: true });
    if (created.error || !created.data.user) fail(created.error?.message || `could not create synthetic auth user ${email}`);
    return created.data.user;
  }));
  const [trainerUser, buyerUser, otherBuyerUser] = createdUsers;
  const userId = trainerUser.id;
  let backend;
  let site;
  try {
    sql(`
      INSERT INTO users (id, email, role) VALUES
        ('${userId}', '${TRAINER_EMAIL}', 'trainer'),
        ('${buyerUser.id}', '${BUYER_EMAIL}', 'consumer'),
        ('${otherBuyerUser.id}', '${OTHER_BUYER_EMAIL}', 'consumer');
      INSERT INTO trainer_profiles (user_id, is_active, status) VALUES ('${userId}', true, 'active');
      INSERT INTO trainer_templates (id, trainer_id, type, name, template_data) VALUES ('${WORKOUT_ID}', '${userId}', 'workout', 'Local E2E Workout', '{"days":[{"name":"Day 1"}]}'::jsonb);
      INSERT INTO diet_plan_templates (id, trainer_id, name, detail_level) VALUES ('${DIET_ID}', '${userId}', 'Local E2E Diet', 'macros');
    `);
    const apiBase = `http://127.0.0.1:${PORT}`;
    backend = spawn(process.execPath, ['server.js'], { cwd: ROOT, env: { ...process.env, PORT: String(PORT), SUPABASE_URL: local.API_URL, SUPABASE_SERVICE_KEY: local.SERVICE_ROLE_KEY, FRONTEND_URL: 'http://localhost:3000' }, stdio: 'ignore' });
    await waitForServer(apiBase, backend);
    const trainerClient = createClient(local.API_URL, local.ANON_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
    const signedIn = await trainerClient.auth.signInWithPassword({ email: TRAINER_EMAIL, password: PASSWORD });
    if (signedIn.error || !signedIn.data.session) fail(signedIn.error?.message || 'local trainer sign-in failed');
    const trainerToken = signedIn.data.session.access_token;
    const buyerClient = createClient(local.API_URL, local.ANON_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
    const buyerSignedIn = await buyerClient.auth.signInWithPassword({ email: BUYER_EMAIL, password: PASSWORD });
    if (buyerSignedIn.error || !buyerSignedIn.data.session) fail(buyerSignedIn.error?.message || 'local buyer sign-in failed');
    const buyerToken = buyerSignedIn.data.session.access_token;
    const otherBuyerClient = createClient(local.API_URL, local.ANON_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
    const otherBuyerSignedIn = await otherBuyerClient.auth.signInWithPassword({ email: OTHER_BUYER_EMAIL, password: PASSWORD });
    if (otherBuyerSignedIn.error || !otherBuyerSignedIn.data.session) fail(otherBuyerSignedIn.error?.message || 'local other-buyer sign-in failed');
    const otherBuyerToken = otherBuyerSignedIn.data.session.access_token;
    const templates = await request(apiBase, '/api/plans/trainer/templates', trainerToken);
    if (!templates.response.ok || templates.body.workout?.[0]?.id !== WORKOUT_ID || templates.body.diet?.[0]?.id !== DIET_ID) fail(`owned workout/diet templates were not returned (${templates.response.status}: ${templates.body?.error || 'unexpected response'})`);
    const createdListing = await request(apiBase, '/api/plans/trainer/listings', trainerToken, { method: 'POST', body: JSON.stringify({ templateType: 'workout', templateId: WORKOUT_ID, title: 'Local E2E Strength', description: 'Synthetic local verification listing.', priceInrPaise: 2000, priceUsdCents: 100 }) });
    if (createdListing.response.status !== 201 || createdListing.body.status !== 'draft') fail('listing was not created as a draft');
    const id = createdListing.body.id;
    const slug = createdListing.body.slug;
    const hidden = await request(apiBase, '/api/plans/listings');
    if (!hidden.response.ok || hidden.body.some((listing) => listing.id === id)) fail('draft listing was public');
    const unauthenticatedPurchase = await request(apiBase, '/api/plans/purchases', null, { method: 'POST', body: JSON.stringify({ listingId: id, currency: 'INR' }) });
    const draftPurchase = await request(apiBase, '/api/plans/purchases', buyerToken, { method: 'POST', body: JSON.stringify({ listingId: id, currency: 'INR' }) });
    if (unauthenticatedPurchase.response.status !== 401 || draftPurchase.response.status !== 404) fail('purchase access did not reject unauthenticated or draft-listing requests');
    const published = await request(apiBase, `/api/plans/trainer/listings/${id}/publish`, trainerToken, { method: 'POST' });
    if (!published.response.ok || published.body.status !== 'published') fail('listing did not publish');
    const visible = await request(apiBase, '/api/plans/listings');
    if (!visible.response.ok || !visible.body.some((listing) => listing.id === id)) fail('published listing was not public');
    const detail = await request(apiBase, `/api/plans/listings/${slug}`);
    if (!detail.response.ok || detail.body.id !== id) fail('published listing detail did not resolve');
    if (sql(`SELECT count(*) FROM plans_listing_versions WHERE listing_id = '${id}';`).trim() !== '1') fail('publish did not create a listing version snapshot');
    const ownPurchase = await request(apiBase, '/api/plans/purchases', trainerToken, { method: 'POST', body: JSON.stringify({ listingId: id, currency: 'INR' }) });
    if (ownPurchase.response.status !== 409) fail('trainer could purchase their own listing');
    for (const status of ['unpublished', 'suspended', 'removed']) {
      sql(`UPDATE plans_listings SET status = '${status}' WHERE id = '${id}';`);
      const blockedPurchase = await request(apiBase, '/api/plans/purchases', buyerToken, { method: 'POST', body: JSON.stringify({ listingId: id, currency: 'INR' }) });
      if (blockedPurchase.response.status !== 404) fail(`${status} listing accepted a purchase`);
    }
    sql(`UPDATE plans_listings SET status = 'published' WHERE id = '${id}';`);
    const inrPurchase = await request(apiBase, '/api/plans/purchases', buyerToken, { method: 'POST', body: JSON.stringify({ listingId: id, currency: 'INR' }) });
    if (inrPurchase.response.status !== 201 || inrPurchase.body.currency !== 'INR' || inrPurchase.body.final_price_minor !== 2000 || inrPurchase.body.commission_bps !== 500 || inrPurchase.body.commission_minor !== 100 || inrPurchase.body.status !== 'payment_pending' || !inrPurchase.body.listing_version_id) fail('INR purchase did not preserve the listing price and pending status');
    const usdPurchase = await request(apiBase, '/api/plans/purchases', buyerToken, { method: 'POST', body: JSON.stringify({ listingId: id, currency: 'USD' }) });
    if (usdPurchase.response.status !== 201 || usdPurchase.body.currency !== 'USD' || usdPurchase.body.final_price_minor !== 100 || usdPurchase.body.commission_minor !== 5 || usdPurchase.body.status !== 'payment_pending') fail('USD purchase did not preserve the listing price and commission');
    const purchases = await request(apiBase, '/api/plans/my-purchases', buyerToken);
    if (!purchases.response.ok || !purchases.body.some((purchase) => purchase.id === inrPurchase.body.id && purchase.status === 'payment_pending')) fail('buyer purchase was missing from my-purchases');
    const ownedPurchase = await request(apiBase, `/api/plans/purchases/${inrPurchase.body.id}`, buyerToken);
    const otherBuyerPurchase = await request(apiBase, `/api/plans/purchases/${inrPurchase.body.id}`, otherBuyerToken);
    if (!ownedPurchase.response.ok || otherBuyerPurchase.response.status !== 404) fail('purchase detail ownership was not enforced');
    if (sql(`SELECT count(*) FROM plans_purchases WHERE id IN ('${inrPurchase.body.id}', '${usdPurchase.body.id}') AND status = 'payment_pending' AND workout_assigned_plan_id IS NULL AND diet_assigned_plan_id IS NULL;`).trim() !== '2') fail('purchase skeleton wrote delivery data or changed its pending status');
    const siteBase = `http://localhost:${SITE_PORT}`;
    site = spawn('npm', ['run', 'dev', '--', '--port', String(SITE_PORT)], { cwd: PLANS_SITE_ROOT, env: { ...process.env, NEXT_PUBLIC_API_BASE_URL: apiBase }, stdio: 'ignore' });
    await waitForServer(siteBase, site, '/plans');
    const plansPage = await (await fetch(`${siteBase}/plans`)).text();
    const detailPage = await (await fetch(`${siteBase}/plans/${slug}`)).text();
    if (!plansPage.includes('Local E2E Strength') || !detailPage.includes('Local E2E Strength') || !detailPage.includes('Purchasing is coming soon.')) fail('standalone public pages did not render the published listing');
    const unpublished = await request(apiBase, `/api/plans/trainer/listings/${id}/unpublish`, trainerToken, { method: 'POST' });
    if (!unpublished.response.ok || unpublished.body.status !== 'unpublished') fail('listing did not unpublish');
    const hiddenAgain = await request(apiBase, '/api/plans/listings');
    const missingDetail = await request(apiBase, `/api/plans/listings/${slug}`);
    if (hiddenAgain.body.some((listing) => listing.id === id) || missingDetail.response.status !== 404) fail('unpublished listing remained public');
    const unpublishedPlansPage = await (await fetch(`${siteBase}/plans`)).text();
    const unpublishedDetailPage = await (await fetch(`${siteBase}/plans/${slug}`)).text();
    if (unpublishedPlansPage.includes('Local E2E Strength') || !unpublishedDetailPage.includes('Plan not available')) fail('standalone public pages did not hide the unpublished listing');
    console.log('Gymvyn Plans local E2E passed: auth, templates, listing publish loop, pending INR/USD purchase skeleton, ownership checks, standalone public browse/detail, and unpublish.');
  } finally {
    if (site) site.kill('SIGTERM');
    if (backend) backend.kill('SIGTERM');
    for (const testUser of createdUsers) cleanupRows(testUser.id);
    for (const testUser of createdUsers) await service.auth.admin.deleteUser(testUser.id);
    for (const name of Object.keys(before).reverse()) if (!before[name]) sql(`DROP TABLE IF EXISTS ${name} CASCADE;`);
  }
}

main().catch((error) => { console.error(error.message); process.exitCode = 1; });
