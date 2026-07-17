const ACTIVE_RELATIONSHIP_STATUSES = ['active', 'accepted', 'approved', 'linked'];
const ACTIVE_MEMBERSHIP_STATUSES = ['active'];

function isActiveRelationshipStatus(status) {
  return ACTIVE_RELATIONSHIP_STATUSES.includes(String(status || '').toLowerCase());
}

function isActiveMembershipStatus(status) {
  return ACTIVE_MEMBERSHIP_STATUSES.includes(String(status || '').toLowerCase());
}

async function getActiveTrainerClientLink(supabase, trainerId, clientId) {
  if (!trainerId || !clientId) return null;
  const { data, error } = await supabase
    .from('trainer_clients')
    .select('id, trainer_id, client_id, status, created_at')
    .eq('trainer_id', trainerId)
    .eq('client_id', clientId)
    .in('status', ACTIVE_RELATIONSHIP_STATUSES)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data || null;
}

async function getCurrentTrainerClientLinkForClient(supabase, clientId) {
  if (!clientId) return null;
  const { data, error } = await supabase
    .from('trainer_clients')
    .select('id, trainer_id, client_id, status, created_at')
    .eq('client_id', clientId)
    .in('status', ACTIVE_RELATIONSHIP_STATUSES)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data || null;
}

async function deactivateOtherTrainerClientLinks(supabase, clientId, keepTrainerId) {
  if (!clientId || !keepTrainerId) return;
  const { error } = await supabase
    .from('trainer_clients')
    .update({ status: 'removed', updated_at: new Date().toISOString() })
    .eq('client_id', clientId)
    .neq('trainer_id', keepTrainerId)
    .in('status', ACTIVE_RELATIONSHIP_STATUSES);
  if (error) throw error;
}

async function deactivateAllTrainerClientLinks(supabase, clientId) {
  if (!clientId) return [];
  const { data: activeRows, error: selectError } = await supabase
    .from('trainer_clients')
    .select('id')
    .eq('client_id', clientId)
    .in('status', ACTIVE_RELATIONSHIP_STATUSES);
  if (selectError) throw selectError;

  const ids = (activeRows || []).map(row => row.id);
  if (ids.length === 0) return [];

  const { error } = await supabase
    .from('trainer_clients')
    .update({ status: 'removed', updated_at: new Date().toISOString() })
    .in('id', ids);
  if (error) throw error;
  return ids;
}

async function deactivateOtherGymMemberships(supabase, userId, keepGymId) {
  if (!userId || !keepGymId) return;
  const { error } = await supabase
    .from('gym_memberships')
    .update({ status: 'inactive', updated_at: new Date().toISOString() })
    .eq('user_id', userId)
    .neq('gym_id', keepGymId)
    .in('status', ACTIVE_MEMBERSHIP_STATUSES);
  if (error) throw error;
}

async function deactivateAllGymMemberships(supabase, userId) {
  if (!userId) return [];
  const { data: activeRows, error: selectError } = await supabase
    .from('gym_memberships')
    .select('id')
    .eq('user_id', userId)
    .in('status', ACTIVE_MEMBERSHIP_STATUSES);
  if (selectError) throw selectError;

  const ids = (activeRows || []).map(row => row.id);
  if (ids.length === 0) return [];

  const { error } = await supabase
    .from('gym_memberships')
    .update({ status: 'inactive', updated_at: new Date().toISOString() })
    .in('id', ids);
  if (error) throw error;
  return ids;
}

module.exports = {
  ACTIVE_RELATIONSHIP_STATUSES,
  ACTIVE_MEMBERSHIP_STATUSES,
  isActiveRelationshipStatus,
  isActiveMembershipStatus,
  getActiveTrainerClientLink,
  getCurrentTrainerClientLinkForClient,
  deactivateOtherTrainerClientLinks,
  deactivateAllTrainerClientLinks,
  deactivateOtherGymMemberships,
  deactivateAllGymMemberships,
};
