'use strict';

// LOCAL-ONLY. Ensures the local Supabase Docker stack's `postgres` database
// (the one the real API server actually reads via SUPABASE_URL) has the
// Gymvyn Plans schema applied, then seeds one persistent, idempotent
// end-to-end fixture: one trainer, one workout template, one published
// listing. Unlike scripts/run-plans-local-e2e.js this does NOT clean up
// after itself -- it is meant to be the stable fixture later phases build
// on, so IDs are fixed/deterministic and re-running this script is a no-op
// once the rows exist.
//
// Refuses to run unless the local Supabase Docker stack is explicitly
// selected (never touches a hosted/production project).

const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { createClient } = require('@supabase/supabase-js');

const ROOT = path.resolve(__dirname, '..');
const CONTAINER = 'supabase_db_gymvyn-backend';

const TRAINER_EMAIL = 'demo-trainer@gymvyn-plans.local';
const TRAINER_PASSWORD = 'GymvynPlansDemo!2026';
const TRAINER_FULL_NAME = 'Jordan Ellis';

const WORKOUT_TEMPLATE_ID = '81000000-0000-0000-0000-000000000001';
const WORKOUT_TEMPLATE_NAME = 'Strength Foundations Block';

const LISTING_ID = '82000000-0000-0000-0000-000000000001';
const LISTING_SLUG = 'strength-foundations-8-week';
const LISTING_TITLE = '8-Week Strength Foundations';
const LISTING_DESCRIPTION = 'A trainer-built 8-week strength block for lifters who want a structured, no-guesswork progression.';
const PRICE_INR_PAISE = 149900;
const PRICE_USD_CENTS = 1900;

function run(command, args, input) {
  const result = spawnSync(command, args, { cwd: ROOT, encoding: 'utf8', input, stdio: input === undefined ? ['ignore', 'pipe', 'pipe'] : ['pipe', 'pipe', 'pipe'] });
  if (result.error || result.status !== 0) throw new Error(`${command} ${args.join(' ')} failed: ${(result.stderr || '').trim()}`);
  return result.stdout;
}
function sql(statement) {
  return run('docker', ['exec', '-i', CONTAINER, 'psql', '-X', '-A', '-t', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres', '-d', 'postgres'], statement);
}
function isLocal(url) {
  try { return ['localhost', '127.0.0.1', '::1'].includes(new URL(url).hostname); } catch { return false; }
}
function status() {
  const value = JSON.parse(run('supabase', ['status', '--output', 'json']));
  if (!isLocal(value.API_URL)) throw new Error('Supabase API must be localhost -- refusing to seed a non-local project.');
  if (!run('docker', ['ps', '--format', '{{.Names}}']).split(/\r?\n/).includes(CONTAINER)) throw new Error('local Supabase database container is not running');
  return value;
}

// Same stand-in schema shape as scripts/run-plans-local-e2e.js's
// ensureLocalSchema() -- the local Docker stack only ships a toy
// users/posts demo schema (supabase/migrations/*_baseline_schema.sql), not
// the real app schema, so these core-app tables (owned elsewhere in
// production) are stubbed with just the columns plansRoutes.js reads.
function ensureLocalSchema() {
  sql(`
    CREATE EXTENSION IF NOT EXISTS pgcrypto;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS full_name TEXT;
    CREATE TABLE IF NOT EXISTS trainer_profiles (user_id UUID PRIMARY KEY REFERENCES users(id), is_active BOOLEAN NOT NULL DEFAULT true, status TEXT NOT NULL DEFAULT 'active');
    CREATE TABLE IF NOT EXISTS trainer_templates (id UUID PRIMARY KEY, trainer_id UUID NOT NULL REFERENCES users(id), type TEXT NOT NULL, name TEXT NOT NULL, template_data JSONB NOT NULL DEFAULT '{}'::jsonb, updated_at TIMESTAMPTZ NOT NULL DEFAULT now());
    CREATE TABLE IF NOT EXISTS diet_plan_templates (id UUID PRIMARY KEY, trainer_id UUID NOT NULL REFERENCES users(id), name TEXT NOT NULL, detail_level TEXT, updated_at TIMESTAMPTZ NOT NULL DEFAULT now());
    CREATE TABLE IF NOT EXISTS assigned_plans (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(), trainer_id UUID NOT NULL REFERENCES users(id), client_id UUID NOT NULL REFERENCES users(id),
      template_id UUID, type TEXT NOT NULL, name TEXT NOT NULL, plan_data JSONB NOT NULL DEFAULT '{}'::jsonb, notes TEXT,
      status TEXT NOT NULL DEFAULT 'active', starts_at DATE, ends_at DATE, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS assigned_diet_plans (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(), trainer_id UUID NOT NULL REFERENCES users(id), client_id UUID NOT NULL REFERENCES users(id),
      template_id UUID, detail_level TEXT, name TEXT NOT NULL, calories_target INTEGER, protein_g INTEGER, carbs_g INTEGER, fat_g INTEGER,
      notes TEXT, is_active BOOLEAN NOT NULL DEFAULT true, assigned_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS diet_plan_days (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), template_id UUID NOT NULL REFERENCES diet_plan_templates(id), day_number INTEGER, calories_target INTEGER, protein_g INTEGER, carbs_g INTEGER, fat_g INTEGER, notes TEXT);
    CREATE TABLE IF NOT EXISTS diet_plan_meals (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), day_id UUID NOT NULL REFERENCES diet_plan_days(id), meal_name TEXT, meal_order INTEGER, calories INTEGER, protein_g INTEGER, carbs_g INTEGER, fat_g INTEGER, notes TEXT);
    CREATE TABLE IF NOT EXISTS diet_plan_foods (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), meal_id UUID NOT NULL REFERENCES diet_plan_meals(id), food_name TEXT, quantity_g NUMERIC, calories INTEGER, protein_g INTEGER, carbs_g INTEGER, fat_g INTEGER);
    CREATE TABLE IF NOT EXISTS assigned_diet_days (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), assigned_plan_id UUID NOT NULL REFERENCES assigned_diet_plans(id), day_number INTEGER, calories_target INTEGER, protein_g INTEGER, carbs_g INTEGER, fat_g INTEGER, notes TEXT);
    CREATE TABLE IF NOT EXISTS assigned_diet_meals (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), assigned_day_id UUID NOT NULL REFERENCES assigned_diet_days(id), meal_name TEXT, meal_order INTEGER, calories INTEGER, protein_g INTEGER, carbs_g INTEGER, fat_g INTEGER, notes TEXT);
    CREATE TABLE IF NOT EXISTS assigned_diet_foods (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), assigned_meal_id UUID NOT NULL REFERENCES assigned_diet_meals(id), food_name TEXT, quantity_g NUMERIC, calories INTEGER, protein_g INTEGER, carbs_g INTEGER, fat_g INTEGER);

    -- CREATE TABLE IF NOT EXISTS above is a no-op against a bare stub table
    -- from an earlier phase's schema (e.g. the Phase C1 "id UUID PRIMARY KEY"
    -- placeholder) -- these ALTERs bring it up to Phase E's real shape either way.
    ALTER TABLE assigned_plans ALTER COLUMN id SET DEFAULT gen_random_uuid();
    ALTER TABLE assigned_diet_plans ALTER COLUMN id SET DEFAULT gen_random_uuid();
    ALTER TABLE assigned_plans
      ADD COLUMN IF NOT EXISTS trainer_id UUID REFERENCES users(id), ADD COLUMN IF NOT EXISTS client_id UUID REFERENCES users(id),
      ADD COLUMN IF NOT EXISTS template_id UUID, ADD COLUMN IF NOT EXISTS type TEXT, ADD COLUMN IF NOT EXISTS name TEXT,
      ADD COLUMN IF NOT EXISTS plan_data JSONB NOT NULL DEFAULT '{}'::jsonb, ADD COLUMN IF NOT EXISTS notes TEXT,
      ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active', ADD COLUMN IF NOT EXISTS starts_at DATE, ADD COLUMN IF NOT EXISTS ends_at DATE,
      ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now(), ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();
    ALTER TABLE assigned_diet_plans
      ADD COLUMN IF NOT EXISTS trainer_id UUID REFERENCES users(id), ADD COLUMN IF NOT EXISTS client_id UUID REFERENCES users(id),
      ADD COLUMN IF NOT EXISTS template_id UUID, ADD COLUMN IF NOT EXISTS detail_level TEXT, ADD COLUMN IF NOT EXISTS name TEXT,
      ADD COLUMN IF NOT EXISTS calories_target INTEGER, ADD COLUMN IF NOT EXISTS protein_g INTEGER, ADD COLUMN IF NOT EXISTS carbs_g INTEGER, ADD COLUMN IF NOT EXISTS fat_g INTEGER,
      ADD COLUMN IF NOT EXISTS notes TEXT, ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT true, ADD COLUMN IF NOT EXISTS assigned_at TIMESTAMPTZ NOT NULL DEFAULT now();
  `);
  sql(fs.readFileSync(path.join(ROOT, 'migrations/plans_phase1_foundation.sql'), 'utf8'));
  sql(`
    GRANT USAGE ON SCHEMA public TO service_role;
    GRANT ALL ON TABLE users, trainer_profiles, trainer_templates, diet_plan_templates, assigned_plans, assigned_diet_plans,
      diet_plan_days, diet_plan_meals, diet_plan_foods, assigned_diet_days, assigned_diet_meals, assigned_diet_foods,
      plans_listings, plans_listing_versions, plans_purchases, plans_payment_events, plans_reviews TO service_role;
    NOTIFY pgrst, 'reload schema';
  `);
}

async function ensureTrainerAuthUser(service) {
  const existing = await service.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (existing.error) throw new Error(existing.error.message);
  const found = existing.data.users.find((user) => user.email === TRAINER_EMAIL);
  if (found) return found;
  const created = await service.auth.admin.createUser({ email: TRAINER_EMAIL, password: TRAINER_PASSWORD, email_confirm: true, user_metadata: { full_name: TRAINER_FULL_NAME } });
  if (created.error || !created.data.user) throw new Error(created.error?.message || 'could not create demo trainer auth user');
  return created.data.user;
}

async function main() {
  const local = status();
  ensureLocalSchema();

  const service = createClient(local.API_URL, local.SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
  const trainerAuthUser = await ensureTrainerAuthUser(service);
  const trainerId = trainerAuthUser.id;

  sql(`
    INSERT INTO users (id, email, role, full_name) VALUES ('${trainerId}', '${TRAINER_EMAIL}', 'trainer', '${TRAINER_FULL_NAME}')
      ON CONFLICT (id) DO UPDATE SET full_name = EXCLUDED.full_name;
    INSERT INTO trainer_profiles (user_id, is_active, status) VALUES ('${trainerId}', true, 'active')
      ON CONFLICT (user_id) DO UPDATE SET is_active = true, status = 'active';
    INSERT INTO trainer_templates (id, trainer_id, type, name, template_data) VALUES
      ('${WORKOUT_TEMPLATE_ID}', '${trainerId}', 'workout', '${WORKOUT_TEMPLATE_NAME}', '{"days":[{"name":"Day 1: Squat + Push"},{"name":"Day 2: Hinge + Pull"},{"name":"Day 3: Full Body"}]}'::jsonb)
      ON CONFLICT (id) DO NOTHING;
    INSERT INTO plans_listings (id, trainer_id, template_type, template_id, slug, title, description, price_inr_paise, price_usd_cents, status, published_at) VALUES
      ('${LISTING_ID}', '${trainerId}', 'workout', '${WORKOUT_TEMPLATE_ID}', '${LISTING_SLUG}', '${LISTING_TITLE}', '${LISTING_DESCRIPTION}', ${PRICE_INR_PAISE}, ${PRICE_USD_CENTS}, 'published', now())
      ON CONFLICT (id) DO NOTHING;
  `);

  console.log('Gymvyn Plans local fixture ready.');
  console.log(JSON.stringify({
    trainer: { id: trainerId, email: TRAINER_EMAIL, password: TRAINER_PASSWORD, full_name: TRAINER_FULL_NAME },
    workoutTemplateId: WORKOUT_TEMPLATE_ID,
    listing: { id: LISTING_ID, slug: LISTING_SLUG, title: LISTING_TITLE },
  }, null, 2));
}

main().catch((error) => { console.error(error.message); process.exitCode = 1; });
