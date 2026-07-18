'use strict';

// TEST ONLY: orchestrates the two migration stages against the dedicated local
// fixture database. It deliberately does not call Supabase migration commands.
const { spawnSync } = require('node:child_process');
const { ROOT, DB_NAME, assertSafe, applyFile, recreateFixture } = require('./reset-chat-security-local-db');

function runTests(phase) {
  const result = spawnSync(process.execPath, ['--test', 'tests/chatDatabase.integration.test.js'], {
    cwd: ROOT,
    stdio: 'inherit',
    env: { ...process.env, CHAT_TEST_FIXTURE_PHASE: phase, CHAT_TEST_DATABASE: DB_NAME, GYMVYN_CHAT_TEST_LOCAL_ONLY: 'true' },
  });
  if (result.status !== 0) process.exit(result.status || 1);
}

try {
  assertSafe();
  recreateFixture();
  applyFile(DB_NAME, 'migrations/friendships_and_user_blocks.sql');
  applyFile(DB_NAME, 'migrations/chat_security_phase1_additive.sql');
  runTests('phase1');
  applyFile(DB_NAME, 'migrations/chat_security_phase2_lockdown.sql');
  runTests('phase2');
  console.log('Local-only Phase 1 and Phase 2 chat security database tests passed.');
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
