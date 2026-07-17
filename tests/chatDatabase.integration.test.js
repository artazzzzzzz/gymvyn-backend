'use strict';

// These tests run only via `npm run test:chat-db`, after its loader has created
// the isolated local database. They use SET ROLE so anon, authenticated, and
// service_role privileges are exercised as distinct PostgreSQL roles.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');

const DB = process.env.CHAT_TEST_DATABASE;
const PHASE = process.env.CHAT_TEST_FIXTURE_PHASE;
const CONTAINER = 'supabase_db_gymvyn-backend';
const OWNER = '00000000-0000-0000-0000-000000000001';
const STAFF = '00000000-0000-0000-0000-000000000002';
const MEMBER = '00000000-0000-0000-0000-000000000003';
const TRAINER = '00000000-0000-0000-0000-000000000004';
const CLIENT = '00000000-0000-0000-0000-000000000005';
const OUTSIDER = '00000000-0000-0000-0000-000000000006';
const STAFF_TWO = '00000000-0000-0000-0000-000000000007';

function psql(statement, expectFailure = false) {
  const result = spawnSync('docker', ['exec', '-i', CONTAINER, 'psql', '-X', '-A', '-t', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres', '-d', DB], { input: statement, encoding: 'utf8' });
  if (expectFailure) { assert.notEqual(result.status, 0, `expected SQL to fail: ${statement}`); return result.stderr; }
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}
function role(roleName, userId, statement, expectFailure = false) {
  return psql(`BEGIN; SET LOCAL ROLE ${roleName}; ${userId ? `SELECT set_config('request.jwt.claim.sub','${userId}',true);` : ''} ${statement}; COMMIT;`, expectFailure);
}
function value(statement) { return psql(statement).split(/\r?\n/).filter(Boolean).at(-1); }

test('test harness is explicitly local and isolated', { skip: !DB || !PHASE }, () => {
  assert.equal(DB, 'gymvyn_chat_security_test');
  assert.ok(['phase1', 'phase2'].includes(PHASE));
  assert.equal(value('SELECT current_database()'), DB);
  assert.equal(value("SELECT to_regclass('public.conversations') IS NOT NULL"), 't');
});

if (PHASE === 'phase1') {
  test('Phase 1 preserves legacy RPC access but denies hardened RPCs to anon/authenticated', () => {
    assert.equal(value("SELECT has_function_privilege('anon','public.get_or_create_conversation(uuid,uuid)','EXECUTE')"), 't');
    assert.equal(value("SELECT has_function_privilege('authenticated','public.chat_send_message(uuid,uuid,text)','EXECUTE')"), 'f');
    assert.equal(value("SELECT has_function_privilege('anon','public.chat_get_or_create_conversation(uuid,uuid)','EXECUTE')"), 'f');
    assert.equal(value("SELECT has_function_privilege('service_role','public.chat_send_message(uuid,uuid,text)','EXECUTE')"), 't');
    // The intentionally unsafe legacy definer function can create an unrelated pair.
    role('authenticated', OWNER, `SELECT public.get_or_create_conversation('${MEMBER}','${OUTSIDER}')`);
    assert.equal(value(`SELECT count(*) FROM public.conversations WHERE participant_1_id='${MEMBER}' AND participant_2_id='${OUTSIDER}'`), '1');
  });

  test('Phase 1 hardened RPCs are atomic and maintain unread metadata', async () => {
    const sql = `SET ROLE service_role; SELECT public.chat_get_or_create_conversation('${STAFF}','${TRAINER}')`;
    await Promise.all([Promise.resolve().then(() => psql(sql)), Promise.resolve().then(() => psql(sql))]);
    assert.equal(value(`SELECT count(*) FROM public.conversations WHERE participant_1_id='${STAFF}' AND participant_2_id='${TRAINER}'`), '1');
    const id = value(`SELECT id FROM public.conversations WHERE participant_1_id='${STAFF}' AND participant_2_id='${TRAINER}'`);
    role('service_role', null, `SELECT (public.chat_send_message('${id}','${STAFF}',' hello local fixture ')).id`);
    assert.equal(value(`SELECT count(*) FROM public.messages WHERE conversation_id='${id}' AND sender_id='${STAFF}' AND content='hello local fixture'`), '1');
    assert.equal(value(`SELECT p2_unread FROM public.conversations WHERE id='${id}'`), '1');
    role('service_role', null, `SELECT public.chat_mark_read('${id}','${TRAINER}')`);
    assert.equal(value(`SELECT p2_unread FROM public.conversations WHERE id='${id}'`), '0');
  });

  test('fixture relationship states distinguish active and stale rows', () => {
    assert.equal(value(`SELECT count(*) FROM public.gym_staff WHERE gym_id='10000000-0000-0000-0000-000000000001' AND user_id IN ('${STAFF}','${STAFF_TWO}') AND is_active`), '2');
    assert.equal(value(`SELECT count(*) FROM public.trainer_profiles WHERE user_id='${TRAINER}' AND gym_id='10000000-0000-0000-0000-000000000001' AND is_active AND status='active'`), '1');
    assert.equal(value(`SELECT count(*) FROM public.gym_memberships WHERE user_id='${MEMBER}' AND gym_id='10000000-0000-0000-0000-000000000001' AND status='active' AND end_date IS NULL`), '1');
    assert.equal(value(`SELECT count(*) FROM public.trainer_clients WHERE trainer_id='${TRAINER}' AND client_id='${CLIENT}' AND status='active'`), '1');
    assert.equal(value(`SELECT count(*) FROM public.gym_memberships WHERE user_id='${CLIENT}' AND status='active' AND (end_date IS NULL OR end_date >= current_date)`), '0');
    assert.equal(value(`SELECT count(*) FROM public.buddy_requests WHERE sender_id='${MEMBER}' AND receiver_id='${CLIENT}' AND status='accepted'`), '1');
  });
}

if (PHASE === 'phase2') {
  test('Phase 2 revokes old RPCs and removes direct browser write policies', () => {
    assert.equal(value("SELECT has_function_privilege('authenticated','public.get_or_create_conversation(uuid,uuid)','EXECUTE')"), 'f');
    assert.equal(value("SELECT has_function_privilege('anon','public.increment_unread(uuid,text)','EXECUTE')"), 'f');
    const direct = `BEGIN; SET LOCAL ROLE authenticated; SELECT set_config('request.jwt.claim.sub','${OWNER}',true); INSERT INTO public.conversations(participant_1_id,participant_2_id) VALUES('${OWNER}','${CLIENT}'); COMMIT;`;
    psql(direct, true);
    const conversation = value(`SELECT id FROM public.conversations WHERE participant_1_id='${STAFF}' AND participant_2_id='${TRAINER}'`);
    psql(`BEGIN; SET LOCAL ROLE authenticated; SELECT set_config('request.jwt.claim.sub','${STAFF}',true); INSERT INTO public.messages(conversation_id,sender_id,content) VALUES('${conversation}','${STAFF}','bypass'); COMMIT;`, true);
  });

  test('Phase 2 constraints and service-only RPC reject invalid inputs', () => {
    psql(`INSERT INTO public.conversations(participant_1_id,participant_2_id) VALUES('${OWNER}','${OWNER}')`, true);
    psql(`INSERT INTO public.conversations(participant_1_id,participant_2_id) VALUES('${TRAINER}','${STAFF}')`, true);
    const conversation = value(`SELECT id FROM public.conversations WHERE participant_1_id='${STAFF}' AND participant_2_id='${TRAINER}'`);
    psql(`INSERT INTO public.messages(conversation_id,sender_id,content) VALUES('${conversation}','${STAFF}','   ')`, true);
    role('service_role', null, `SELECT public.chat_get_or_create_conversation('${OWNER}','${OWNER}')`, true);
    role('authenticated', STAFF, `SELECT public.chat_send_message('${conversation}','${STAFF}','nope')`, true);
  });
}
