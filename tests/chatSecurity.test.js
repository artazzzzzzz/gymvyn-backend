'use strict';

// Focused unit/static regression coverage. It deliberately has no production
// dependency; database-RLS/RPC assertions require applying the migration to a
// disposable Supabase project before they can be integration-tested.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { canMessage } = require('../src/utils/canMessage');
const { MAX_MESSAGE_LENGTH, validateMessageContent } = require('../src/services/chatService');

function relationshipSupabase(tables) {
  function query(table) {
    const state = { equals: [], notEquals: [], inFilters: [], or: null, nonNull: [] };
    const builder = {
      select() { return builder; },
      eq(column, value) { state.equals.push([column, value]); return builder; },
      neq(column, value) { state.notEquals.push([column, value]); return builder; },
      in(column, values) { state.inFilters.push([column, values]); return builder; },
      or(value) { state.or = value; return builder; },
      not(column, operator, value) { state.nonNull.push([column, operator, value]); return builder; },
      limit() { return builder; },
      maybeSingle() { state.single = true; return builder; },
      then(resolve, reject) {
        try {
          let rows = [...(tables[table] || [])];
          for (const [column, value] of state.equals) rows = rows.filter((row) => row[column] === value);
          for (const [column, value] of state.notEquals) rows = rows.filter((row) => row[column] !== value);
          for (const [column, values] of state.inFilters) rows = rows.filter((row) => values.includes(row[column]));
          for (const [column, operator, value] of state.nonNull) {
            if (operator === 'is' && value === null) rows = rows.filter((row) => row[column] != null);
          }
          if (table === 'gym_memberships' && state.or?.startsWith('end_date.')) {
            const today = new Date().toISOString().slice(0, 10);
            rows = rows.filter((row) => row.end_date == null || row.end_date >= today);
          }
          if (state.or?.includes('trainer_id.eq.')) {
            const ids = [...state.or.matchAll(/(?:trainer_id|client_id|buyer_id|seller_id|sender_id|receiver_id)\.eq\.([^,\)]+)/g)].map((match) => match[1]);
            rows = rows.filter((row) => ids.includes(row.trainer_id) || ids.includes(row.client_id) || ids.includes(row.buyer_id) || ids.includes(row.seller_id) || ids.includes(row.sender_id) || ids.includes(row.receiver_id));
          }
          resolve({ data: state.single ? rows[0] || null : rows, error: null });
        } catch (error) { if (reject) reject(error); }
      },
    };
    return builder;
  }
  return { from: query };
}

const activeGymRelationships = {
  gyms: [
    { id: 'gym-a', owner_id: 'owner', is_active: true },
    { id: 'gym-off', owner_id: 'owner-off', is_active: false },
    { id: 'gym-b', owner_id: 'owner-b', is_active: true },
  ],
  gym_staff: [
    { user_id: 'staff-a', gym_id: 'gym-a', is_active: true },
    { user_id: 'staff-b', gym_id: 'gym-a', is_active: true },
    { user_id: 'staff-inactive', gym_id: 'gym-a', is_active: false },
    { user_id: 'staff-off', gym_id: 'gym-off', is_active: true },
    { user_id: 'staff-other', gym_id: 'gym-b', is_active: true },
  ],
  gym_memberships: [
    { user_id: 'member-a', gym_id: 'gym-a', status: 'active', end_date: null },
    { user_id: 'member-expired', gym_id: 'gym-a', status: 'active', end_date: '2000-01-01' },
    { user_id: 'member-paused', gym_id: 'gym-a', status: 'paused', end_date: null },
    { user_id: 'member-off', gym_id: 'gym-off', status: 'active', end_date: null },
  ],
  trainer_profiles: [
    { user_id: 'trainer-a', gym_id: 'gym-a', is_active: true, status: 'active' },
    { user_id: 'trainer-inactive', gym_id: 'gym-a', is_active: false, status: 'active' },
    { user_id: 'trainer-paused', gym_id: 'gym-a', is_active: true, status: 'paused' },
    { user_id: 'trainer-off', gym_id: 'gym-off', is_active: true, status: 'active' },
  ],
  trainer_clients: [], marketplace_purchases: [], buddy_requests: [], friendships: [], user_blocks: [],
};

test('chat content validation rejects non-string, blank, and oversized content', () => {
  assert.match(validateMessageContent(null).error, /string/);
  assert.match(validateMessageContent('   ').error, /empty/);
  assert.match(validateMessageContent('x'.repeat(MAX_MESSAGE_LENGTH + 1)).error, /4000/);
  assert.equal(validateMessageContent('  hello  ').value, 'hello');
});

test('canMessage denies self-chat without querying the database', async () => {
  const neverUsed = { from() { throw new Error('database must not be queried for self chat'); } };
  assert.equal(await canMessage(neverUsed, 'same-user', 'same-user'), false);
});

test('canMessage permits active staff peers in the same active gym in both directions', async () => {
  const db = relationshipSupabase(activeGymRelationships);
  assert.equal(await canMessage(db, 'staff-a', 'staff-b'), true);
  assert.equal(await canMessage(db, 'staff-b', 'staff-a'), true);
});

test('canMessage permits active gym trainer and active member in both directions', async () => {
  const db = relationshipSupabase(activeGymRelationships);
  assert.equal(await canMessage(db, 'trainer-a', 'member-a'), true);
  assert.equal(await canMessage(db, 'member-a', 'trainer-a'), true);
});

test('canMessage permits accepted friends cross-gym but rejects pending friends', async () => {
  const accepted = relationshipSupabase({ ...activeGymRelationships, friendships: [{ participant_1_id: 'friend-a', participant_2_id: 'friend-b', status: 'accepted' }] });
  const pending = relationshipSupabase({ ...activeGymRelationships, friendships: [{ participant_1_id: 'friend-a', participant_2_id: 'friend-b', status: 'pending' }] });
  assert.equal(await canMessage(accepted, 'friend-a', 'friend-b'), true);
  assert.equal(await canMessage(accepted, 'friend-b', 'friend-a'), true);
  assert.equal(await canMessage(pending, 'friend-a', 'friend-b'), false);
});

test('canMessage block override denies otherwise valid trainer, gym, and friend relationships', async () => {
  const db = relationshipSupabase({ ...activeGymRelationships, friendships: [{ participant_1_id: 'friend-a', participant_2_id: 'friend-b', status: 'accepted' }], user_blocks: [
    { participant_1_id: 'friend-a', participant_2_id: 'friend-b', blocker_id: 'friend-a' },
    { participant_1_id: 'member-a', participant_2_id: 'trainer-a', blocker_id: 'member-a' },
    { participant_1_id: 'staff-a', participant_2_id: 'staff-b', blocker_id: 'staff-a' },
  ] });
  for (const [a, b] of [['friend-a','friend-b'], ['trainer-a','member-a'], ['staff-a','staff-b']]) {
    assert.equal(await canMessage(db, a, b), false);
    assert.equal(await canMessage(db, b, a), false);
  }
});

test('canMessage denies inactive, expired, paused, inactive-gym, different-gym, and unrelated users', async () => {
  const db = relationshipSupabase(activeGymRelationships);
  for (const [left, right] of [
    ['staff-a', 'staff-inactive'],
    ['trainer-inactive', 'member-a'],
    ['trainer-paused', 'member-a'],
    ['trainer-a', 'member-expired'],
    ['trainer-a', 'member-paused'],
    ['trainer-off', 'member-off'],
    ['staff-a', 'staff-other'],
    ['trainer-a', 'unrelated'],
  ]) {
    assert.equal(await canMessage(db, left, right), false, `${left} -> ${right} must be denied`);
    assert.equal(await canMessage(db, right, left), false, `${right} -> ${left} must be denied`);
  }
});

test('phase migrations keep old paths in phase 1 and lock them down only in phase 2', () => {
  const phase1 = fs.readFileSync(path.join(__dirname, '..', 'migrations', 'chat_security_phase1_additive.sql'), 'utf8');
  const sql = fs.readFileSync(path.join(__dirname, '..', 'migrations', 'chat_security_phase2_lockdown.sql'), 'utf8');
  assert.doesNotMatch(phase1, /REVOKE EXECUTE ON FUNCTION public\.get_or_create_conversation/);
  for (const name of ['get_or_create_conversation(uuid, uuid)', 'increment_unread(uuid, text)']) {
    assert.match(sql, new RegExp(`REVOKE EXECUTE ON FUNCTION public\\.${name.replace(/[()]/g, '\\$&').replace(/ /g, '\\s*')} FROM PUBLIC, anon, authenticated`));
  }
  assert.match(sql, /DROP POLICY IF EXISTS "participants can insert conversations"/);
  assert.match(sql, /DROP POLICY IF EXISTS "participants can update conversations"/);
  assert.match(sql, /DROP POLICY IF EXISTS "sender can insert messages"/);
  assert.match(phase1, /CREATE OR REPLACE FUNCTION public\.chat_send_message/);
  assert.match(phase1, /SET search_path = pg_catalog, public/);
  assert.match(phase1, /GRANT EXECUTE ON FUNCTION public\.chat_send_message[\s\S]*TO service_role/);
});

test('local chat baseline is isolated from production migrations and fails closed without its marker', () => {
  const baseline = fs.readFileSync(path.join(__dirname, '..', 'supabase', 'tests', 'chat_security_baseline.sql'), 'utf8');
  assert.match(baseline, /TEST ONLY — NOT A PRODUCTION MIGRATION/);
  assert.match(baseline, /Refusing fixture outside gymvyn_chat_security_test/);
  assert.doesNotMatch(baseline, /db reset/);
});
