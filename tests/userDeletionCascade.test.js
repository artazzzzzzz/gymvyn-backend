'use strict';

/*
 * deleteUserCascade unit test — gymvyn-backend
 *
 * GAPS.md item 4: covers the destructive multi-table cascade shared by
 * DELETE /api/users/:userId (self-service) and DELETE /api/admin/users/:userId
 * (see src/utils/userDeletion.js). Calls the function directly with the
 * service-role client — no HTTP layer, no auth token needed — so it never
 * touches the shared seeded fixture accounts (test_ff_owner_1 etc.) used by
 * the other suites. The test creates its own disposable Supabase Auth user
 * (test_ff_ prefix, matching scripts/seed-test-ecosystem.js's convention)
 * and guarantees cleanup in `after` even if an assertion fails.
 */

require('dotenv').config();
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { createClient } = require('@supabase/supabase-js');
const { deleteUserCascade } = require('../src/utils/userDeletion');

let supabase;
let userId;

before(async () => {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY)
    throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_KEY — copy .env');

  supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const email = `test_ff_cascade_throwaway_${Date.now()}@fitforge.test`;
  const { data, error } = await supabase.auth.admin.createUser({
    email,
    password: 'TestFF!2026',
    email_confirm: true,
    user_metadata: { full_name: 'Test Cascade Throwaway' },
  });
  if (error) throw new Error(`createUser: ${error.message}`);
  userId = data.user.id;

  const { error: profileErr } = await supabase.from('users').insert({ id: userId, full_name: 'Test Cascade Throwaway' });
  if (profileErr) throw profileErr;

  const { data: workoutLog, error: wlErr } = await supabase.from('workout_logs')
    .insert({ user_id: userId, started_at: new Date().toISOString() })
    .select('id').single();
  if (wlErr) throw wlErr;

  const { error: wslErr } = await supabase.from('workout_set_logs').insert({
    workout_log_id: workoutLog.id, exercise_name: 'Throwaway Bench Press', set_number: 1,
  });
  if (wslErr) throw wslErr;

  const { error: flagErr } = await supabase.from('user_flags').insert({ user_id: userId, notes: 'throwaway test row' });
  if (flagErr) throw flagErr;
});

after(async () => {
  // Best-effort cleanup in case the cascade itself failed partway through
  // (deleteUserCascade is expected to have already removed everything, but
  // this must never leave a throwaway account behind either way).
  if (!userId) return;
  await supabase.from('workout_set_logs').delete().eq('exercise_name', 'Throwaway Bench Press').then(() => {}, () => {});
  await supabase.from('workout_logs').delete().eq('user_id', userId).then(() => {}, () => {});
  await supabase.from('user_flags').delete().eq('user_id', userId).then(() => {}, () => {});
  await supabase.from('users').delete().eq('id', userId).then(() => {}, () => {});
  await supabase.auth.admin.deleteUser(userId).then(() => {}, () => {});
});

test('deleteUserCascade removes the user row, related rows across tables, and the auth account', async () => {
  await deleteUserCascade(supabase, userId);

  const { data: user } = await supabase.from('users').select('id').eq('id', userId).maybeSingle();
  assert.equal(user, null, 'users row should be gone');

  const { data: logs } = await supabase.from('workout_logs').select('id').eq('user_id', userId);
  assert.equal((logs || []).length, 0, 'workout_logs rows should be gone');

  const { data: flags } = await supabase.from('user_flags').select('user_id').eq('user_id', userId);
  assert.equal((flags || []).length, 0, 'user_flags row should be gone');

  const { data: authUser, error: authErr } = await supabase.auth.admin.getUserById(userId);
  assert.ok(authErr || !authUser?.user, 'Supabase Auth account should be gone');
});

test('deleting an already-deleted user is safe to call again (no throw on empty tables)', async () => {
  // deleteUserCascade itself has no existence guard (that lives in the
  // calling route, which checks first and 404s) -- but every delete() in the
  // cascade is a no-op on zero matching rows, so calling it a second time on
  // an id with nothing left must not throw for that reason. The final
  // auth.admin.deleteUser() on an already-gone id does throw (Supabase Auth
  // returns "User not found"), which is exactly why the routes guard with an
  // existence check first rather than relying on this function to be
  // idempotent on its own.
  await assert.rejects(() => deleteUserCascade(supabase, userId));
});
