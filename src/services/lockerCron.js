const cron = require('node-cron');
const { createClient } = require('@supabase/supabase-js');

function getSupabase() {
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
}

// ── Locker expiry check — 19:30 UTC daily (01:00 IST) ────────────────────────

async function runLockerExpiryCheck() {
  const supabase = getSupabase();
  console.log('[Locker Cron] Expiry check started at', new Date().toISOString());

  try {
    const now = new Date().toISOString();

    // Find all active assignments that have passed their expires_at
    const { data: expired, error: fetchErr } = await supabase
      .from('locker_assignments')
      .select('id, locker_id')
      .eq('status', 'active')
      .lt('expires_at', now);

    if (fetchErr) throw fetchErr;

    if (!expired || expired.length === 0) {
      console.log('[Locker Cron] No expired assignments found');
      return;
    }

    const assignmentIds = expired.map(r => r.id);
    const lockerIds     = [...new Set(expired.map(r => r.locker_id))];

    // Mark assignments as expired
    const { error: assignUpdateErr } = await supabase
      .from('locker_assignments')
      .update({ status: 'expired' })
      .in('id', assignmentIds);

    if (assignUpdateErr) {
      console.error('[Locker Cron] Failed to expire assignments:', assignUpdateErr.message);
      return;
    }

    // Return lockers to available
    const { error: lockerUpdateErr } = await supabase
      .from('gym_lockers')
      .update({ status: 'available' })
      .in('id', lockerIds)
      .eq('status', 'occupied'); // only flip occupied ones, leave maintenance alone

    if (lockerUpdateErr) {
      console.error('[Locker Cron] Failed to release lockers:', lockerUpdateErr.message);
      return;
    }

    console.log(`[Locker Cron] Expired ${assignmentIds.length} assignment(s), released ${lockerIds.length} locker(s)`);
  } catch (err) {
    console.error('[Locker Cron] Expiry check crashed:', err.message);
  }
}

// ── Initializer ───────────────────────────────────────────────────────────────

function initLockerCrons() {
  // Daily locker expiry — 19:30 UTC = 01:00 IST
  cron.schedule('30 19 * * *', runLockerExpiryCheck, { timezone: 'UTC' });
  console.log('[Locker Cron] Scheduled: daily locker expiry check at 19:30 UTC (01:00 IST)');
}

module.exports = { initLockerCrons, runLockerExpiryCheck };
