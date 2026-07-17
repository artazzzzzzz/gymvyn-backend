'use strict';

// TEST ONLY. This loader never uses `supabase db reset`, `supabase link`, a
// hosted URL, or the normal Supabase migration directory. It recreates only
// the dedicated local database named in .env.chat-test.local.
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const dotenv = require('dotenv');

const ROOT = path.resolve(__dirname, '..');
const ENV_FILE = path.join(ROOT, '.env.chat-test.local');
const CONTAINER = 'supabase_db_gymvyn-backend';
const DB_NAME = 'gymvyn_chat_security_test';
const PRODUCTION_PROJECT_REF = 'jaxnqttycxeavwhcsoyv';

function fail(message) { throw new Error(`Refusing local chat fixture operation: ${message}`); }
function localUrl(value) {
  try { return ['localhost', '127.0.0.1', '::1'].includes(new URL(value).hostname); } catch { return false; }
}
function run(command, args, options = {}) {
  const result = spawnSync(command, args, { cwd: ROOT, encoding: 'utf8', input: options.input, stdio: options.input === undefined ? ['ignore', 'pipe', 'pipe'] : ['pipe', 'pipe', 'pipe'] });
  if (result.error || result.status !== 0) fail(`${command} ${args.join(' ')} failed${result.stderr ? `: ${result.stderr.trim()}` : ''}`);
  return result.stdout;
}
function sql(database, statement) {
  return run('docker', ['exec', '-i', CONTAINER, 'psql', '-X', '-A', '-t', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres', '-d', database], { input: statement });
}
function loadEnv() {
  if (!fs.existsSync(ENV_FILE)) fail('missing .env.chat-test.local (copy .env.chat-test.local.example)');
  const parsed = dotenv.parse(fs.readFileSync(ENV_FILE));
  if (parsed.GYMVYN_CHAT_TEST_LOCAL_ONLY !== 'true') fail('GYMVYN_CHAT_TEST_LOCAL_ONLY=true is required');
  if (parsed.NODE_ENV === 'production') fail('NODE_ENV must not be production');
  if (parsed.CHAT_TEST_PROJECT_REF !== 'local') fail('CHAT_TEST_PROJECT_REF must be local');
  if (!localUrl(parsed.CHAT_TEST_SUPABASE_URL || '') || (parsed.CHAT_TEST_SUPABASE_URL || '').includes(PRODUCTION_PROJECT_REF)) fail('CHAT_TEST_SUPABASE_URL must be localhost, never production');
  if (parsed.CHAT_TEST_DATABASE !== DB_NAME) fail(`CHAT_TEST_DATABASE must be ${DB_NAME}`);
  return parsed;
}
function assertSafe() {
  const env = loadEnv();
  const status = JSON.parse(run('supabase', ['status', '--output', 'json']));
  const apiUrl = status.API_URL || status.api_url || status.apiUrl;
  if (!localUrl(apiUrl || '') || apiUrl.includes(PRODUCTION_PROJECT_REF)) fail('local Supabase stack is not reporting a localhost API');
  const names = run('docker', ['ps', '--format', '{{.Names}}']).split(/\r?\n/);
  if (!names.includes(CONTAINER)) fail('local Supabase database container is not running');
  return env;
}
function applyFile(database, file) { sql(database, fs.readFileSync(path.join(ROOT, file), 'utf8')); }
function recreateFixture() {
  assertSafe();
  const exists = sql('postgres', `SELECT 1 FROM pg_database WHERE datname = '${DB_NAME}';`).trim() === '1';
  if (!exists) run('docker', ['exec', CONTAINER, 'createdb', '-U', 'postgres', DB_NAME]);
  applyFile(DB_NAME, 'supabase/tests/chat_security_baseline.sql');
  applyFile(DB_NAME, 'supabase/tests/chat_security_seed.sql');
}
if (require.main === module) {
  try {
    assertSafe();
    if (process.argv.includes('--check')) console.log('Local chat fixture safeguards passed. No database was changed.');
    else { recreateFixture(); console.log(`Loaded test-only chat fixture into local database ${DB_NAME}.`); }
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
module.exports = { DB_NAME, ROOT, assertSafe, applyFile, recreateFixture, sql };
