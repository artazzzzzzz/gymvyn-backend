#!/usr/bin/env node
/*
 * FitForge test ecosystem seeder.
 *
 * Creates an isolated test gym + users + data inside PRODUCTION Supabase,
 * all prefixed with TEST_FF_ / test_ff_ so they can be nuked with one query.
 *
 * Idempotent: re-running checks existence by deterministic keys (email, gym
 * name, gym_id+label, gym_id+name, etc.) before inserting.
 *
 * Usage:
 *   node scripts/seed-test-ecosystem.js               # full seed
 *   node scripts/seed-test-ecosystem.js --verify-only # check what exists, no writes
 */

require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const { randomUUID } = require('crypto');
const fs = require('fs');
const path = require('path');
const { canonicalPair } = require('../src/utils/canMessage');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_KEY in .env');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const VERIFY_ONLY = process.argv.includes('--verify-only');
const TEST_GYM_NAME = 'TEST_FF_Gym_Alpha';
const PASSWORD = 'TestFF!2026';

const today = new Date();
const daysAgo = (n) => {
  const d = new Date(today);
  d.setDate(d.getDate() - n);
  return d;
};
const dateStr = (d) => d.toISOString().slice(0, 10);
const isoStr = (d) => d.toISOString();

// ---------------------------------------------------------------------------
// Auth user helpers
// ---------------------------------------------------------------------------

let _authUserCache = null;
async function listAllAuthUsers() {
  if (_authUserCache) return _authUserCache;
  const all = [];
  let page = 1;
  while (true) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw error;
    all.push(...data.users);
    if (data.users.length < 1000) break;
    page++;
  }
  _authUserCache = all;
  return all;
}

async function getOrCreateAuthUser(email, fullName) {
  const users = await listAllAuthUsers();
  const existing = users.find((u) => (u.email || '').toLowerCase() === email.toLowerCase());
  if (existing) return { id: existing.id, created: false };
  if (VERIFY_ONLY) return { id: null, created: false, missing: true };

  const { data, error } = await supabase.auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: true,
    user_metadata: { full_name: fullName },
  });
  if (error) throw new Error(`createUser(${email}): ${error.message}`);
  _authUserCache.push(data.user);
  return { id: data.user.id, created: true };
}

// ---------------------------------------------------------------------------
// Users table helpers
// ---------------------------------------------------------------------------

async function upsertUserProfile(id, { full_name, role, gym_id = null, extra = {} }) {
  if (VERIFY_ONLY || !id) return;
  const { error } = await supabase
    .from('users')
    .upsert(
      {
        id,
        full_name,
        role,
        gym_id,
        is_active: true,
        ...extra,
      },
      { onConflict: 'id' }
    );
  if (error) throw new Error(`upsertUserProfile(${id}): ${error.message}`);
}

// ---------------------------------------------------------------------------
// Existence checks
// ---------------------------------------------------------------------------

async function findTestGym() {
  const { data, error } = await supabase
    .from('gyms')
    .select('*')
    .eq('name', TEST_GYM_NAME)
    .maybeSingle();
  if (error) throw error;
  return data;
}

async function rowCount(table, filters = {}) {
  let q = supabase.from(table).select('*', { count: 'exact', head: true });
  for (const [k, v] of Object.entries(filters)) q = q.eq(k, v);
  const { count, error } = await q;
  if (error) throw new Error(`count(${table}): ${error.message}`);
  return count || 0;
}

// ---------------------------------------------------------------------------
// Roster
// ---------------------------------------------------------------------------

const ROSTER = [
  { key: 'owner_1',    email: 'test_ff_owner_1@fitforge.test',    full_name: 'TEST_FF Owner One',    role: 'gym_owner' },
  { key: 'trainer_1',  email: 'test_ff_trainer_1@fitforge.test',  full_name: 'TEST_FF Trainer Indep', role: 'trainer',   indep: true },
  { key: 'trainer_2',  email: 'test_ff_trainer_2@fitforge.test',  full_name: 'TEST_FF Trainer Gym A', role: 'trainer',   gymAffiliated: true },
  { key: 'trainer_3',  email: 'test_ff_trainer_3@fitforge.test',  full_name: 'TEST_FF Trainer Gym B', role: 'trainer',   gymAffiliated: true },
  ...Array.from({ length: 10 }, (_, i) => ({
    key: `member_${i + 1}`,
    email: `test_ff_member_${i + 1}@fitforge.test`,
    full_name: `TEST_FF Member ${i + 1}`,
    role: 'gym_member',
  })),
  { key: 'solo_1',     email: 'test_ff_solo_1@fitforge.test',     full_name: 'TEST_FF Solo One',     role: 'consumer' },
  { key: 'solo_2',     email: 'test_ff_solo_2@fitforge.test',     full_name: 'TEST_FF Solo Two',     role: 'consumer' },
  { key: 'client_1',   email: 'test_ff_client_1@fitforge.test',   full_name: 'TEST_FF Client One',   role: 'consumer' },
  { key: 'client_2',   email: 'test_ff_client_2@fitforge.test',   full_name: 'TEST_FF Client Two',   role: 'consumer' },
  { key: 'client_3',   email: 'test_ff_client_3@fitforge.test',   full_name: 'TEST_FF Client Three', role: 'consumer' },
];

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log(`\n=== FitForge test ecosystem seeder ===`);
  console.log(`Mode: ${VERIFY_ONLY ? 'VERIFY-ONLY (no writes)' : 'SEED'}`);
  console.log(`Supabase: ${SUPABASE_URL}\n`);

  // 1. Auth users + users table profiles
  console.log('[1/10] Auth users + profiles');
  const ids = {};
  for (const r of ROSTER) {
    const { id, created, missing } = await getOrCreateAuthUser(r.email, r.full_name);
    ids[r.key] = id;
    console.log(`  ${missing ? '✗ missing' : created ? '+ created' : '· exists '}  ${r.email}`);
  }

  // 1b. Upsert minimal user profiles FIRST (gym FK needs owner_id in users)
  console.log('\n[1b/10] Pre-create user profiles (no gym_id yet)');
  for (const r of ROSTER) {
    if (!ids[r.key]) continue;
    await upsertUserProfile(ids[r.key], { full_name: r.full_name, role: r.role, gym_id: null });
  }

  // 2. Gym
  console.log('\n[2/10] Gym');
  let gym = await findTestGym();
  if (!gym && !VERIFY_ONLY) {
    const { data, error } = await supabase
      .from('gyms')
      .insert({
        name: TEST_GYM_NAME,
        city: 'TEST_FF_City',
        owner_id: ids.owner_1,
        gym_type: 'commercial',
        address: 'TEST_FF Address 123',
        phone: '+910000000000',
        description: 'Test gym for end-to-end QA. Safe to delete.',
        is_active: true,
        join_code: 'TFFAL1',
        lockers_enabled: true,
        membership_plans: [
          { id: randomUUID(), name: 'Monthly',    duration_days: 30,  price: 1500, features: ['Gym access'],          is_active: true },
          { id: randomUUID(), name: 'Quarterly',  duration_days: 90,  price: 4000, features: ['Gym access'],          is_active: true },
          { id: randomUUID(), name: 'Annual',     duration_days: 365, price: 14000, features: ['Gym + group classes'], is_active: true },
        ],
      })
      .select()
      .single();
    if (error) throw new Error(`gym insert: ${error.message}`);
    gym = data;
    console.log(`  + created gym ${gym.id}`);
  } else if (gym) {
    console.log(`  · exists  gym ${gym.id}`);
  } else {
    console.log('  ✗ missing gym (verify-only)');
  }
  const gymId = gym?.id || null;

  // Patch owner with gym_id
  if (ids.owner_1 && gymId) {
    await upsertUserProfile(ids.owner_1, { full_name: 'TEST_FF Owner One', role: 'gym_owner', gym_id: gymId });
  }
  // Members
  for (let i = 0; i < 10; i++) {
    const k = `member_${i + 1}`;
    await upsertUserProfile(ids[k], {
      full_name: ROSTER.find((r) => r.key === k).full_name,
      role: 'gym_member',
      gym_id: gymId,
      extra: { age: 22 + i, height: 165 + i, current_weight: 60 + i * 2, gender: i % 2 ? 'female' : 'male', activity_level: 'moderate', goal: 'muscle_gain' },
    });
  }
  // Solo + clients (no gym)
  for (const k of ['solo_1', 'solo_2', 'client_1', 'client_2', 'client_3']) {
    const r = ROSTER.find((x) => x.key === k);
    await upsertUserProfile(ids[k], {
      full_name: r.full_name,
      role: 'consumer',
      gym_id: null,
      extra: { age: 28, height: 175, current_weight: 72, gender: 'male', activity_level: 'moderate', goal: 'fat_loss' },
    });
  }
  // Trainers (users table)
  for (const k of ['trainer_1', 'trainer_2', 'trainer_3']) {
    const r = ROSTER.find((x) => x.key === k);
    await upsertUserProfile(ids[k], {
      full_name: r.full_name,
      role: 'trainer',
      gym_id: r.gymAffiliated ? gymId : null,
    });
  }

  // 3. trainer_profiles
  console.log('\n[3/10] Trainer profiles');
  for (const k of ['trainer_1', 'trainer_2', 'trainer_3']) {
    const trainerUserId = ids[k];
    if (!trainerUserId) { console.log(`  ✗ skip ${k}`); continue; }
    const { data: existing } = await supabase
      .from('trainer_profiles')
      .select('id, trainer_code')
      .eq('user_id', trainerUserId)
      .maybeSingle();
    if (existing) { console.log(`  · exists  ${k} (${existing.trainer_code})`); continue; }
    if (VERIFY_ONLY) { console.log(`  ✗ missing ${k}`); continue; }
    const isIndep = ROSTER.find((r) => r.key === k).indep === true;
    const r = ROSTER.find((x) => x.key === k);
    const { error } = await supabase.from('trainer_profiles').insert({
      user_id: trainerUserId,
      gym_id: isIndep ? null : gymId,
      bio: 'TEST_FF trainer bio',
      specializations: ['strength', 'hypertrophy'],
      specialties: ['strength', 'hypertrophy'],
      experience_years: 5,
      hourly_rate: isIndep ? 1500 : null,
      is_independent: isIndep,
      is_accepting_clients: true,
      trainer_code: 'TF' + k.slice(-1).padStart(4, '0'),
      status: 'active',
      is_active: true,
    });
    if (error) throw new Error(`trainer_profiles ${k}: ${error.message}`);
    console.log(`  + created ${k}`);
  }

  // 4. gym_memberships
  console.log('\n[4/10] Gym memberships');
  if (gymId) {
    const existingCount = await rowCount('gym_memberships', { gym_id: gymId });
    if (existingCount >= 10) {
      console.log(`  · exists  ${existingCount} memberships`);
    } else if (!VERIFY_ONLY) {
      const types = ['monthly', 'quarterly', 'annual'];
      const fees =  [1500,      4000,        14000];
      const rows = Array.from({ length: 10 }, (_, i) => {
        const idx = i % 3;
        const start = daysAgo(180 - i * 15);
        const dur = idx === 0 ? 30 : idx === 1 ? 90 : 365;
        const end = new Date(start); end.setDate(end.getDate() + dur);
        return {
          user_id: ids[`member_${i + 1}`],
          gym_id: gymId,
          membership_type: types[idx],
          monthly_fee: fees[idx] / (idx === 0 ? 1 : idx === 1 ? 3 : 12),
          start_date: dateStr(start),
          end_date: dateStr(end),
          status: 'active',
        };
      });
      const { error } = await supabase.from('gym_memberships').insert(rows);
      if (error) throw new Error(`gym_memberships: ${error.message}`);
      console.log(`  + created 10 memberships`);
    } else {
      console.log(`  ✗ missing memberships (have ${existingCount})`);
    }
  }

  // 5. Supplement products
  console.log('\n[5/10] Supplement products');
  if (gymId) {
    const products = [
      { name: 'TEST_FF Whey Protein 1kg', category: 'protein',     price: 2500, stock_count: 25, is_active: true },
      { name: 'TEST_FF Creatine 300g',    category: 'creatine',    price: 1200, stock_count: 18, is_active: true },
      { name: 'TEST_FF Pre-workout',      category: 'preworkout',  price: 1800, stock_count: 3,  is_active: true }, // low stock
      { name: 'TEST_FF Multivitamin',     category: 'vitamins',    price: 800,  stock_count: 0,  is_active: true }, // out of stock
      { name: 'TEST_FF Discontinued Bar', category: 'snacks',      price: 100,  stock_count: 50, is_active: false }, // inactive
    ];
    const existing = await rowCount('supplement_products', { gym_id: gymId });
    if (existing >= 5) {
      console.log(`  · exists  ${existing} products`);
    } else if (!VERIFY_ONLY) {
      const rows = products.map((p) => ({ ...p, gym_id: gymId, low_stock_threshold: 5 }));
      const { error } = await supabase.from('supplement_products').insert(rows);
      if (error) throw new Error(`supplement_products: ${error.message}`);
      console.log(`  + created 5 products`);
    } else {
      console.log(`  ✗ missing products (have ${existing})`);
    }
  }

  // 6. Gym expenses
  console.log('\n[6/10] Gym expenses');
  if (gymId) {
    const cats = ['rent', 'equipment', 'salaries', 'utilities', 'marketing', 'maintenance', 'other', 'rent'];
    const amounts = [50000, 15000, 30000, 8000, 5000, 3000, 2000, 50000];
    const existing = await rowCount('gym_expenses', { gym_id: gymId });
    if (existing >= 8) {
      console.log(`  · exists  ${existing} expenses`);
    } else if (!VERIFY_ONLY) {
      const rows = cats.map((c, i) => ({
        gym_id: gymId,
        category: c,
        description: `TEST_FF ${c} expense ${i + 1}`,
        amount: amounts[i],
        expense_date: dateStr(daysAgo(30 * (i % 6))),
      }));
      const { error } = await supabase.from('gym_expenses').insert(rows);
      if (error) throw new Error(`gym_expenses: ${error.message}`);
      console.log(`  + created 8 expenses`);
    } else {
      console.log(`  ✗ missing expenses (have ${existing})`);
    }
  }

  // 7. Lockers + assignments
  console.log('\n[7/10] Lockers');
  let lockerIds = [];
  if (gymId) {
    const { data: existingLockers } = await supabase
      .from('gym_lockers')
      .select('id, label')
      .eq('gym_id', gymId);
    lockerIds = existingLockers || [];
    if (lockerIds.length >= 6) {
      console.log(`  · exists  ${lockerIds.length} lockers`);
    } else if (!VERIFY_ONLY) {
      const lockerRows = [
        { label: 'A1',   is_paid: false, price: null, status: 'available' },
        { label: 'A2',   is_paid: false, price: null, status: 'occupied' },
        { label: 'VIP-1',is_paid: true,  price: 500,  status: 'occupied' },
        { label: 'VIP-2',is_paid: true,  price: 500,  status: 'available' },
        { label: 'B1',   is_paid: false, price: null, status: 'maintenance' },
        { label: 'B2',   is_paid: true,  price: 300,  status: 'available' },
      ].map((l) => ({ ...l, gym_id: gymId }));
      const { data, error } = await supabase.from('gym_lockers').insert(lockerRows).select('id, label');
      if (error) throw new Error(`gym_lockers: ${error.message}`);
      lockerIds = data;
      console.log(`  + created 6 lockers`);
    }

    // Assignments: A2 (long-term), VIP-1 (expires in 2 days)
    const assignmentsCount = await rowCount('locker_assignments', { gym_id: gymId });
    if (assignmentsCount >= 2) {
      console.log(`  · exists  ${assignmentsCount} locker assignments`);
    } else if (!VERIFY_ONLY && lockerIds.length) {
      const a2 = lockerIds.find((l) => l.label === 'A2');
      const vip1 = lockerIds.find((l) => l.label === 'VIP-1');
      const expiresLong = new Date(today); expiresLong.setDate(expiresLong.getDate() + 30);
      const expiresSoon = new Date(today); expiresSoon.setDate(expiresSoon.getDate() + 2);
      const rows = [
        { locker_id: a2.id,   gym_id: gymId, member_id: ids.member_1, duration_days: 30, expires_at: isoStr(expiresLong), status: 'active' },
        { locker_id: vip1.id, gym_id: gymId, member_id: ids.member_2, duration_days: 30, expires_at: isoStr(expiresSoon), status: 'active' },
      ];
      const { data: ins, error } = await supabase.from('locker_assignments').insert(rows).select('id');
      if (error) throw new Error(`locker_assignments: ${error.message}`);
      // Locker payment for the VIP one
      await supabase.from('locker_payments').insert({
        assignment_id: ins[1].id, gym_id: gymId, amount: 500, payment_status: 'paid', payment_method: 'cash', paid_at: isoStr(today),
      });
      console.log(`  + created 2 assignments + 1 payment`);
    }
  }

  // 8. Check-ins, workout plans, workout logs, food logs
  console.log('\n[8/10] Activity (check-ins, workouts, foods)');
  if (gymId) {
    const ciCount = await rowCount('check_ins', { gym_id: gymId });
    if (ciCount >= 20) {
      console.log(`  · exists  ${ciCount} check-ins`);
    } else if (!VERIFY_ONLY) {
      // map user_id -> membership_id (check_ins requires it)
      const { data: memberships } = await supabase
        .from('gym_memberships').select('id, user_id').eq('gym_id', gymId);
      const midByUser = new Map((memberships || []).map((m) => [m.user_id, m.id]));
      const rows = Array.from({ length: 20 }, (_, i) => {
        const uid = ids[`member_${(i % 10) + 1}`];
        return {
          user_id: uid,
          gym_id: gymId,
          membership_id: midByUser.get(uid),
          checked_in_at: isoStr(daysAgo(i)),
          method: 'manual',
        };
      });
      const { error } = await supabase.from('check_ins').insert(rows);
      if (error) throw new Error(`check_ins: ${error.message}`);
      console.log(`  + created 20 check-ins`);
    }
  }

  // Workout plans + logs for 3 members
  const workoutMembers = ['member_1', 'member_2', 'member_3'];
  for (const k of workoutMembers) {
    const uid = ids[k];
    if (!uid) continue;
    const { count: planCount } = await supabase
      .from('workout_plans').select('*', { count: 'exact', head: true }).eq('user_id', uid);
    if ((planCount || 0) >= 1) {
      console.log(`  · exists  workout_plan for ${k}`);
    } else if (!VERIFY_ONLY) {
      await supabase.from('workout_plans').insert({
        user_id: uid,
        goal: 'muscle_gain',
        days_per_week: 4,
        plan_data: { days: [{ name: 'Push', exercises: [{ name: 'Bench Press', sets: 4, reps: 8 }, { name: 'Overhead Press', sets: 3, reps: 8 }] }, { name: 'Pull', exercises: [{ name: 'Deadlift', sets: 3, reps: 5 }, { name: 'Pull-ups', sets: 3, reps: 8 }] }] },
        is_active: true,
      });
    }
    const { count: logCount } = await supabase
      .from('workout_logs').select('*', { count: 'exact', head: true }).eq('user_id', uid);
    if ((logCount || 0) >= 5) {
      console.log(`  · exists  ${logCount} workout_logs for ${k}`);
    } else if (!VERIFY_ONLY) {
      const logs = Array.from({ length: 5 }, (_, i) => ({
        user_id: uid,
        started_at: isoStr(daysAgo(i * 2)),
        completed_at: isoStr(daysAgo(i * 2)),
        duration_minutes: 45,
        exercises: [
          { name: 'Bench Press',  sets: [{ weight_kg: 60 + i * 2.5, reps_completed: 8 }, { weight_kg: 60 + i * 2.5, reps_completed: 8 }, { weight_kg: 60 + i * 2.5, reps_completed: 7 }] },
          { name: 'Overhead Press', sets: [{ weight_kg: 40 + i, reps_completed: 8 }, { weight_kg: 40 + i, reps_completed: 8 }] },
        ],
      }));
      const { error } = await supabase.from('workout_logs').insert(logs);
      if (error) throw new Error(`workout_logs ${k}: ${error.message}`);
      console.log(`  + created 5 workout_logs for ${k}`);
    }
  }

  // Food logs (last 7 days for 3 members)
  for (const k of workoutMembers) {
    const uid = ids[k];
    if (!uid) continue;
    const { count } = await supabase
      .from('food_logs').select('*', { count: 'exact', head: true }).eq('user_id', uid);
    if ((count || 0) >= 7) {
      console.log(`  · exists  ${count} food_logs for ${k}`);
    } else if (!VERIFY_ONLY) {
      const meals = ['breakfast', 'lunch', 'snack', 'dinner'];
      const rows = [];
      for (let d = 0; d < 7; d++) {
        for (const m of meals) {
          rows.push({
            user_id: uid,
            log_date: dateStr(daysAgo(d)),
            meal_type: m,
            food_name: `TEST_FF ${m} food`,
            quantity: 1,
            serving_unit: 'serving',
            calories: m === 'breakfast' ? 400 : m === 'lunch' ? 650 : m === 'snack' ? 200 : 700,
            protein_g: 30,
            carbs_g: 60,
            fat_g: 18,
            logged_via: 'manual',
          });
        }
      }
      const { error } = await supabase.from('food_logs').insert(rows);
      if (error) throw new Error(`food_logs ${k}: ${error.message}`);
      console.log(`  + created ${rows.length} food_logs for ${k}`);
    }
  }

  // 9. Trainer template, assigned plan, conversations, progress photos, announcements
  console.log('\n[9/10] Trainer template, assigned plan, chat, progress, announcements');

  if (ids.trainer_1) {
    const { count } = await supabase
      .from('trainer_templates').select('*', { count: 'exact', head: true }).eq('trainer_id', ids.trainer_1);
    if ((count || 0) >= 1) {
      console.log(`  · exists  trainer_template`);
    } else if (!VERIFY_ONLY) {
      await supabase.from('trainer_templates').insert({
        trainer_id: ids.trainer_1,
        name: 'TEST_FF PPL 4-day',
        type: 'workout',
        template_data: { days: [{ name: 'Push', exercises: ['Bench', 'OHP'] }, { name: 'Pull', exercises: ['Deadlift', 'Row'] }] },
      });
      console.log(`  + created trainer_template`);
    }
  }

  if (ids.trainer_1 && ids.client_1) {
    const { count } = await supabase
      .from('assigned_plans').select('*', { count: 'exact', head: true })
      .eq('trainer_id', ids.trainer_1).eq('client_id', ids.client_1);
    if ((count || 0) >= 1) {
      console.log(`  · exists  assigned_plan trainer_1→client_1`);
    } else if (!VERIFY_ONLY) {
      await supabase.from('assigned_plans').insert({
        trainer_id: ids.trainer_1, client_id: ids.client_1,
        type: 'workout', name: 'TEST_FF Assigned Plan',
        notes: 'TEST_FF assigned',
        starts_at: isoStr(today),
        plan_data: { days: [{ name: 'Day 1', exercises: ['Squat', 'Bench'] }] },
        status: 'active',
      });
      console.log(`  + created assigned_plan`);
    }
  }

  // trainer_clients links
  for (const ck of ['client_1', 'client_2', 'client_3']) {
    if (!ids.trainer_1 || !ids[ck]) continue;
    const { count } = await supabase
      .from('trainer_clients').select('*', { count: 'exact', head: true })
      .eq('trainer_id', ids.trainer_1).eq('client_id', ids[ck]);
    if ((count || 0) >= 1) { console.log(`  · exists  trainer_clients trainer_1→${ck}`); continue; }
    if (VERIFY_ONLY) continue;
    await supabase.from('trainer_clients').insert({
      trainer_id: ids.trainer_1, client_id: ids[ck], status: 'active', started_at: isoStr(today),
    });
    console.log(`  + linked trainer_1 → ${ck}`);
  }

  // 5 conversations: 3 with clients + 2 with members
  //
  // conversations is keyed by a canonical (participant_1_id, participant_2_id)
  // pair, not trainer_id/client_id -- it was generalized to a two-participant
  // model for the friends/chat rework (see src/utils/canMessage.js). Creation
  // and message insertion both go through the same SECURITY DEFINER RPCs the
  // app itself uses (chat_get_or_create_conversation, chat_send_message,
  // migrations/chat_security_phase1_additive.sql) instead of hand-writing
  // participant ordering and last_message_* bookkeeping here, so seeded rows
  // can't drift out of sync with those triggers' behavior again.
  const chatPartners = ['client_1', 'client_2', 'client_3', 'member_1', 'member_2'];
  for (const ck of chatPartners) {
    if (!ids.trainer_1 || !ids[ck]) continue;
    const [p1, p2] = canonicalPair(ids.trainer_1, ids[ck]);
    const { data: existing } = await supabase
      .from('conversations').select('id')
      .eq('participant_1_id', p1).eq('participant_2_id', p2).maybeSingle();
    let convId = existing?.id;
    if (!convId) {
      if (VERIFY_ONLY) { console.log(`  ✗ missing conversation trainer_1↔${ck}`); continue; }
      const { data: newConvId, error } = await supabase.rpc('chat_get_or_create_conversation', {
        user_a: ids.trainer_1, user_b: ids[ck],
      });
      if (error) throw new Error(`conversations: ${error.message}`);
      convId = newConvId;
      console.log(`  + created conversation trainer_1↔${ck}`);
    } else {
      console.log(`  · exists  conversation trainer_1↔${ck}`);
    }
    if (convId && !VERIFY_ONLY) {
      const { count } = await supabase
        .from('messages').select('*', { count: 'exact', head: true }).eq('conversation_id', convId);
      if ((count || 0) < 2) {
        const { error: m1Err } = await supabase.rpc('chat_send_message', {
          p_conversation_id: convId, p_sender_id: ids.trainer_1, p_content: 'TEST_FF hi from trainer',
        });
        if (m1Err) throw new Error(`chat_send_message: ${m1Err.message}`);
        const { error: m2Err } = await supabase.rpc('chat_send_message', {
          p_conversation_id: convId, p_sender_id: ids[ck], p_content: 'TEST_FF hi back',
        });
        if (m2Err) throw new Error(`chat_send_message: ${m2Err.message}`);
      }
    }
  }

  // progress_photos: 4 weekly entries for member_1 and member_2
  for (const k of ['member_1', 'member_2']) {
    const uid = ids[k];
    if (!uid) continue;
    const { count } = await supabase
      .from('progress_photos').select('*', { count: 'exact', head: true }).eq('user_id', uid);
    if ((count || 0) >= 4) { console.log(`  · exists  ${count} progress_photos for ${k}`); continue; }
    if (VERIFY_ONLY) continue;
    const rows = Array.from({ length: 4 }, (_, i) => ({
      user_id: uid,
      photo_url: `https://placeholder.test/TEST_FF/${k}/${i}.jpg`,
      cloudinary_id: `TEST_FF_${k}_${i}`,
      angle: ['front', 'side', 'back', 'front'][i],
      notes: `TEST_FF progress week ${i + 1}`,
    }));
    const { error: ppErr } = await supabase.from('progress_photos').insert(rows);
    if (ppErr) { console.log(`  ! progress_photos for ${k}: ${ppErr.message}`); continue; }
    console.log(`  + created 4 progress_photos for ${k}`);
  }

  // Announcements
  if (gymId && ids.owner_1) {
    const { count } = await supabase
      .from('announcements').select('*', { count: 'exact', head: true }).eq('gym_id', gymId);
    if ((count || 0) >= 2) {
      console.log(`  · exists  ${count} announcements`);
    } else if (!VERIFY_ONLY) {
      await supabase.from('announcements').insert([
        { gym_id: gymId, posted_by: ids.owner_1, title: 'TEST_FF Welcome', body: 'TEST_FF body 1', priority: 'normal', is_active: true },
        { gym_id: gymId, posted_by: ids.owner_1, title: 'TEST_FF Urgent', body: 'TEST_FF body 2', priority: 'high',   is_active: true },
      ]);
      console.log(`  + created 2 announcements`);
    }
  }

  // 10. XP — varied levels: Rookie (member_3 ~50 XP), Iron (member_2 ~1500 XP), Titan (member_1 ~9000 XP)
  console.log('\n[10/10] XP events + user_xp');
  const xpTargets = [
    { key: 'member_1', total: 9000 }, // Titan
    { key: 'member_2', total: 1500 }, // Iron
    { key: 'member_3', total: 50 },   // Rookie
  ];
  for (const { key, total } of xpTargets) {
    const uid = ids[key];
    if (!uid) continue;
    const { data: existing } = await supabase
      .from('user_xp').select('total_xp').eq('user_id', uid).maybeSingle();
    if (existing) {
      console.log(`  · exists  user_xp for ${key} (${existing.total_xp} XP)`);
      continue;
    }
    if (VERIFY_ONLY) { console.log(`  ✗ missing user_xp for ${key}`); continue; }

    const firstOfMonth = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-01`;
    // calculate level inline
    const thresholds = { 1: 0, 2: 100, 3: 250, 4: 501, 5: 900, 6: 1300, 7: 2000, 8: 2800, 9: 3600, 10: 5000, 11: 6500, 12: 8000, 13: 9500, 14: 10000, 15: 11500, 16: 13000, 17: 14500, 18: 16000, 19: 18000, 20: 18001 };
    let lvl = 1;
    for (const [l, t] of Object.entries(thresholds)) if (total >= t) lvl = Number(l);

    await supabase.from('user_xp').insert({
      user_id: uid, total_xp: total, level: lvl,
      current_streak: total >= 5000 ? 12 : total >= 1000 ? 5 : 1,
      longest_streak: total >= 5000 ? 30 : total >= 1000 ? 10 : 2,
      streak_multiplier: 1.0, last_active_date: dateStr(today),
      freezes_remaining: 9, freezes_reset_at: firstOfMonth,
    });
    // backing xp_events
    const events = [
      { user_id: uid, source: 'workout',  action: 'session_complete', base_xp: Math.round(total * 0.6), multiplier: 1, final_xp: Math.round(total * 0.6), metadata: { test: true } },
      { user_id: uid, source: 'streak',   action: 'daily_active',     base_xp: Math.round(total * 0.3), multiplier: 1, final_xp: Math.round(total * 0.3), metadata: { test: true } },
      { user_id: uid, source: 'diet',     action: 'macro_fuel',       base_xp: Math.round(total * 0.1), multiplier: 1, final_xp: Math.round(total * 0.1), metadata: { test: true } },
    ];
    await supabase.from('xp_events').insert(events);
    console.log(`  + created user_xp + 3 xp_events for ${key} (level ${lvl}, ${total} XP)`);
  }

  // ---------------------------------------------------------------------------
  // Summary & credentials table
  // ---------------------------------------------------------------------------
  console.log('\n=== Summary ===');
  const tables = ['gyms', 'gym_memberships', 'supplement_products', 'gym_expenses', 'gym_lockers', 'locker_assignments', 'check_ins', 'workout_logs', 'food_logs', 'announcements'];
  for (const t of tables) {
    if (!gymId) break;
    const filter = ['workout_logs', 'food_logs'].includes(t) ? {} : { gym_id: gymId };
    if (t === 'gyms') {
      const { count } = await supabase.from('gyms').select('*', { count: 'exact', head: true }).eq('name', TEST_GYM_NAME);
      console.log(`  ${t.padEnd(22)} ${count}`);
    } else {
      const c = await rowCount(t, filter);
      console.log(`  ${t.padEnd(22)} ${c}`);
    }
  }

  // Credentials file
  const credPath = path.join(__dirname, 'test-ecosystem-credentials.md');
  const lines = [
    `# FitForge Test Ecosystem Credentials`,
    ``,
    `Generated: ${new Date().toISOString()}`,
    `Password (all users): \`${PASSWORD}\``,
    `Test gym name: \`${TEST_GYM_NAME}\``,
    `Gym ID: \`${gymId || '(not created)'}\``,
    ``,
    `| Role | Email | User ID |`,
    `| --- | --- | --- |`,
    ...ROSTER.map((r) => `| ${r.key} | ${r.email} | ${ids[r.key] || '(missing)'} |`),
    ``,
    `## Cleanup`,
    ``,
    `\`\`\`sql`,
    `-- Run in Supabase SQL editor to nuke all test data.`,
    `DELETE FROM xp_events     WHERE user_id IN (SELECT id FROM users WHERE full_name LIKE 'TEST_FF%');`,
    `DELETE FROM user_xp       WHERE user_id IN (SELECT id FROM users WHERE full_name LIKE 'TEST_FF%');`,
    `DELETE FROM messages      WHERE conversation_id IN (SELECT id FROM conversations WHERE trainer_id IN (SELECT id FROM users WHERE full_name LIKE 'TEST_FF%'));`,
    `DELETE FROM conversations WHERE trainer_id IN (SELECT id FROM users WHERE full_name LIKE 'TEST_FF%');`,
    `DELETE FROM trainer_clients   WHERE trainer_id IN (SELECT id FROM users WHERE full_name LIKE 'TEST_FF%');`,
    `DELETE FROM assigned_plans    WHERE trainer_id IN (SELECT id FROM users WHERE full_name LIKE 'TEST_FF%');`,
    `DELETE FROM trainer_templates WHERE trainer_id IN (SELECT id FROM users WHERE full_name LIKE 'TEST_FF%');`,
    `DELETE FROM trainer_profiles  WHERE user_id    IN (SELECT id FROM users WHERE full_name LIKE 'TEST_FF%');`,
    `DELETE FROM food_logs         WHERE user_id    IN (SELECT id FROM users WHERE full_name LIKE 'TEST_FF%');`,
    `DELETE FROM workout_logs      WHERE user_id    IN (SELECT id FROM users WHERE full_name LIKE 'TEST_FF%');`,
    `DELETE FROM workout_plans     WHERE user_id    IN (SELECT id FROM users WHERE full_name LIKE 'TEST_FF%');`,
    `DELETE FROM progress_photos   WHERE user_id    IN (SELECT id FROM users WHERE full_name LIKE 'TEST_FF%');`,
    `DELETE FROM locker_payments    WHERE gym_id IN (SELECT id FROM gyms WHERE name LIKE 'TEST_FF%');`,
    `DELETE FROM locker_assignments WHERE gym_id IN (SELECT id FROM gyms WHERE name LIKE 'TEST_FF%');`,
    `DELETE FROM gym_lockers        WHERE gym_id IN (SELECT id FROM gyms WHERE name LIKE 'TEST_FF%');`,
    `DELETE FROM check_ins          WHERE gym_id IN (SELECT id FROM gyms WHERE name LIKE 'TEST_FF%');`,
    `DELETE FROM gym_expenses       WHERE gym_id IN (SELECT id FROM gyms WHERE name LIKE 'TEST_FF%');`,
    `DELETE FROM supplement_order_items WHERE order_id IN (SELECT id FROM supplement_orders WHERE gym_id IN (SELECT id FROM gyms WHERE name LIKE 'TEST_FF%'));`,
    `DELETE FROM supplement_orders   WHERE gym_id IN (SELECT id FROM gyms WHERE name LIKE 'TEST_FF%');`,
    `DELETE FROM supplement_products WHERE gym_id IN (SELECT id FROM gyms WHERE name LIKE 'TEST_FF%');`,
    `DELETE FROM announcements      WHERE gym_id IN (SELECT id FROM gyms WHERE name LIKE 'TEST_FF%');`,
    `DELETE FROM gym_memberships    WHERE gym_id IN (SELECT id FROM gyms WHERE name LIKE 'TEST_FF%');`,
    `DELETE FROM gyms               WHERE name LIKE 'TEST_FF%';`,
    `DELETE FROM users              WHERE full_name LIKE 'TEST_FF%';`,
    `-- Then in Supabase Auth dashboard: filter "test_ff_" and delete those auth users.`,
    `\`\`\``,
  ];
  if (!VERIFY_ONLY) {
    fs.writeFileSync(credPath, lines.join('\n'));
    console.log(`\nCredentials written to ${credPath}`);
  }

  console.log('\nDone.\n');
}

main().catch((err) => {
  console.error('\nFATAL:', err.message);
  console.error(err.stack);
  process.exit(1);
});
