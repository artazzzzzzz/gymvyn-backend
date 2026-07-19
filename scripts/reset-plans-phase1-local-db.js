'use strict';

// TEST ONLY. This uses the same guarded local Supabase Docker stack as the
// chat-security fixture and never calls a hosted project or normal migration
// commands. It recreates one dedicated synthetic-data database.
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { assertSafe } = require('./reset-chat-security-local-db');

const ROOT = path.resolve(__dirname, '..');
const CONTAINER = 'supabase_db_gymvyn-backend';
const DB_NAME = 'gymvyn_plans_phase1_test';

function run(command, args, input) {
  const result = spawnSync(command, args, { cwd: ROOT, encoding: 'utf8', input, stdio: input === undefined ? ['ignore', 'pipe', 'pipe'] : ['pipe', 'pipe', 'pipe'] });
  if (result.error || result.status !== 0) throw new Error(`${command} ${args.join(' ')} failed: ${(result.stderr || '').trim()}`);
  return result.stdout;
}

function sql(statement) {
  return run('docker', ['exec', '-i', CONTAINER, 'psql', '-X', '-A', '-t', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres', '-d', DB_NAME], statement);
}

function apply(relativePath) {
  sql(fs.readFileSync(path.join(ROOT, relativePath), 'utf8'));
}

function recreateFixture({ applyPlansMigration = true } = {}) {
  assertSafe();
  const exists = run('docker', ['exec', '-i', CONTAINER, 'psql', '-X', '-A', '-t', '-U', 'postgres', '-d', 'postgres', '-c', `SELECT 1 FROM pg_database WHERE datname = '${DB_NAME}'`]).trim() === '1';
  if (!exists) run('docker', ['exec', CONTAINER, 'createdb', '-U', 'postgres', DB_NAME]);
  apply('supabase/tests/plans_phase1_baseline.sql');
  if (applyPlansMigration) apply('migrations/plans_phase1_foundation.sql');
}

if (require.main === module) {
  try {
    recreateFixture();
    console.log(`Loaded Gymvyn Plans Phase 1 fixture into local-only database ${DB_NAME}.`);
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}

module.exports = { DB_NAME, recreateFixture, sql };
