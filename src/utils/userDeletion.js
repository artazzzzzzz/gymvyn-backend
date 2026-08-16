// Shared cascade-delete for a user account, used by both the self-service
// DELETE /api/users/:userId route and the admin DELETE /api/admin/users/:userId
// route. Kept in one place because this is a destructive, multi-table
// operation -- two independent copies would risk drifting out of sync as new
// user-owned tables are added.
async function deleteUserCascade(supabase, userId) {
  const { data: workoutLogs, error: wlSelectErr } = await supabase
    .from('workout_logs')
    .select('id')
    .eq('user_id', userId);
  if (wlSelectErr) throw wlSelectErr;

  const logIds = (workoutLogs || []).map(r => r.id);
  if (logIds.length) {
    const { error: e } = await supabase.from('workout_set_logs').delete().in('workout_log_id', logIds);
    if (e) throw e;
  }

  const deletes = [
    supabase.from('workout_logs').delete().eq('user_id', userId),
    supabase.from('food_logs').delete().eq('user_id', userId),
    supabase.from('progress_entries').delete().eq('user_id', userId),
    supabase.from('xp_events').delete().eq('user_id', userId),
    supabase.from('user_xp').delete().eq('user_id', userId),
    supabase.from('ai_requests').delete().eq('user_id', userId),
    supabase.from('assigned_plans').delete().eq('client_id', userId),
    supabase.from('user_workout_plans').delete().eq('user_id', userId),
    supabase.from('exercise_bookmarks').delete().eq('user_id', userId),
    supabase.from('personal_records').delete().eq('user_id', userId),
    supabase.from('user_macros').delete().eq('user_id', userId),
    supabase.from('messages').delete().eq('sender_id', userId),
    supabase.from('user_flags').delete().eq('user_id', userId),
  ];
  const results = await Promise.all(deletes);
  for (const { error: e } of results) { if (e) throw e; }

  const { error: convErr } = await supabase
    .from('conversations')
    .delete()
    .or(`participant_1_id.eq.${userId},participant_2_id.eq.${userId}`);
  if (convErr) throw convErr;

  const { error: tcErr } = await supabase
    .from('trainer_clients')
    .delete()
    .or(`client_id.eq.${userId},trainer_id.eq.${userId}`);
  if (tcErr) throw tcErr;

  // A trainer deleting their own account (Bug 8, trainer Delete Account)
  // would otherwise leave an orphaned trainer_profiles row behind.
  const { error: tpErr } = await supabase
    .from('trainer_profiles')
    .delete()
    .eq('user_id', userId);
  if (tpErr) throw tpErr;

  const { error: userErr } = await supabase.from('users').delete().eq('id', userId);
  if (userErr) throw userErr;

  const { error: authDeleteErr } = await supabase.auth.admin.deleteUser(userId);
  if (authDeleteErr) throw authDeleteErr;
}

module.exports = { deleteUserCascade };
