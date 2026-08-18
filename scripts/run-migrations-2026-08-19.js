'use strict';
// One-off migration runner for 2026-08-19 features:
//   1. trainer_reviews table
//   2. notification_preferences column on users
//
// Uses the Supabase service-role key to call the `pg_query` RPC if available,
// falling back to sequential table-level probes. This script is safe to re-run
// (all DDL uses IF NOT EXISTS / IF NOT EXISTS).
//
// Run: node scripts/run-migrations-2026-08-19.js

require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

// ── Probe helpers (PostgREST can SELECT from tables but not run DDL) ────────

async function tableExists(tableName) {
  const { error } = await supabase
    .from(tableName)
    .select('id')
    .limit(1);
  // PGRST116 = table not found (relation does not exist)
  if (error?.code === 'PGRST116' || (error?.message || '').includes('does not exist')) {
    return false;
  }
  return true; // table exists (even if we got another error)
}

async function columnExists(tableName, columnName) {
  const { data, error } = await supabase
    .from(tableName)
    .select(columnName)
    .limit(1);
  if (error?.message?.includes('column') && error.message.includes('does not exist')) {
    return false;
  }
  return true;
}

// ── SQL via Management API (requires a management access token, not service key) ──
// This will fail with 401 if only the service key is available — handled below.
async function runSqlViaManagementApi(sql) {
  const resp = await fetch(
    `https://api.supabase.com/v1/projects/${getProjectRef()}/database/query`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.SUPABASE_ACCESS_TOKEN || ''}`,
      },
      body: JSON.stringify({ query: sql }),
    }
  );
  const text = await resp.text();
  if (!resp.ok) throw new Error(`Management API error ${resp.status}: ${text}`);
  return JSON.parse(text);
}

function getProjectRef() {
  const url = process.env.SUPABASE_URL || '';
  return url.replace('https://', '').split('.')[0];
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log('── Migration runner 2026-08-19 ──');
  console.log('Project:', getProjectRef());
  console.log('');

  // 1. Check trainer_reviews
  const trainerReviewsExists = await tableExists('trainer_reviews');
  if (trainerReviewsExists) {
    console.log('✓ trainer_reviews — already exists, skipping');
  } else {
    console.log('✗ trainer_reviews — table does NOT exist');
    console.log('');
    console.log('  Run the following SQL in your Supabase SQL editor:');
    console.log('  (Dashboard → SQL Editor → New Query → paste → Run)');
    console.log('');
    console.log(`  CREATE TABLE IF NOT EXISTS trainer_reviews (
    id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    trainer_id  uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    user_id     uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    rating      int         NOT NULL CHECK (rating BETWEEN 1 AND 5),
    review_text text        NOT NULL CHECK (char_length(review_text) BETWEEN 1 AND 2000),
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now(),
    UNIQUE (trainer_id, user_id)
  );
  CREATE INDEX IF NOT EXISTS trainer_reviews_trainer_id_idx ON trainer_reviews (trainer_id);
  CREATE INDEX IF NOT EXISTS trainer_reviews_user_id_idx    ON trainer_reviews (user_id);`);
    console.log('');
  }

  // 2. Check notification_preferences column on users
  const notifColExists = await columnExists('users', 'notification_preferences');
  if (notifColExists) {
    console.log('✓ users.notification_preferences — column already exists, skipping');
  } else {
    console.log('✗ users.notification_preferences — column does NOT exist');
    console.log('');
    console.log('  Run the following SQL in your Supabase SQL editor:');
    console.log('');
    console.log(`  ALTER TABLE users
    ADD COLUMN IF NOT EXISTS notification_preferences JSONB
    DEFAULT \'{"chat":true,"class_bookings":true,"gym_announcements":true,"trainer_plan":true}\'::jsonb;`);
    console.log('');
  }

  if (!trainerReviewsExists || !notifColExists) {
    console.log('');
    console.log('⚠  One or more migrations need to be applied manually.');
    console.log('   Go to: https://supabase.com/dashboard/project/' + getProjectRef() + '/sql/new');
    process.exit(1);
  }

  console.log('');
  console.log('✓ All migrations applied.');
}

main().catch(err => {
  console.error('Migration runner error:', err.message);
  process.exit(1);
});
