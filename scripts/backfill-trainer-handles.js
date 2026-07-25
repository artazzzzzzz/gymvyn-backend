'use strict';

// LOCAL-ONLY. Backfills a storefront handle for any active trainer_profiles
// row that doesn't have one yet, using the same generateHandle() collision
// scheme as the live PATCH /api/plans/trainer/handle endpoint (plansRoutes.js).
// Idempotent: trainers that already have a handle are left untouched.
//
// Refuses to run unless the local Supabase Docker stack is explicitly
// selected (never touches a hosted/production project).

const { spawnSync } = require('node:child_process');
const path = require('node:path');
const { createClient } = require('@supabase/supabase-js');
const { _private } = require('../routes/plansRoutes');

const ROOT = path.resolve(__dirname, '..');

function run(command, args) {
  const result = spawnSync(command, args, { cwd: ROOT, encoding: 'utf8' });
  if (result.error || result.status !== 0) throw new Error(`${command} ${args.join(' ')} failed: ${(result.stderr || '').trim()}`);
  return result.stdout;
}
function isLocal(url) {
  try { return ['localhost', '127.0.0.1', '::1'].includes(new URL(url).hostname); } catch { return false; }
}
function status() {
  const value = JSON.parse(run('supabase', ['status', '--output', 'json']));
  if (!isLocal(value.API_URL)) throw new Error('Supabase API must be localhost -- refusing to backfill handles for a non-local project.');
  return value;
}

async function main() {
  const local = status();
  const service = createClient(local.API_URL, local.SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });

  const { data: trainers, error } = await service
    .from('trainer_profiles')
    .select('user_id, handle, trainer:users(full_name)')
    .is('handle', null);
  if (error) throw error;

  if (!trainers || trainers.length === 0) {
    console.log('No trainer_profiles rows need a handle backfill.');
    return;
  }

  const results = [];
  for (const trainer of trainers) {
    const fullName = trainer.trainer?.full_name || 'trainer';
    const handle = await _private.generateHandle(fullName, trainer.user_id);
    const { error: updateError } = await service.from('trainer_profiles').update({ handle }).eq('user_id', trainer.user_id);
    if (updateError) throw updateError;
    results.push({ user_id: trainer.user_id, full_name: fullName, handle });
  }

  console.log('Backfilled trainer handles:');
  console.log(JSON.stringify(results, null, 2));
}

main().catch((error) => { console.error(error.message); process.exitCode = 1; });
