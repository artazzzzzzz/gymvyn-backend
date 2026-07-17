// can_message(A, B) — messaging permission gate shared by every
// conversation-creation and message read/write endpoint.
//
// Rule set (see migrations/ for the tables referenced):
//   member <-> their trainer            : trainer_clients, status='active'
//   buyer <-> seller of a marketplace    : marketplace_purchases,
//     purchase                             status != 'cancelled' (deliberately
//                                           cross-gym — the whole point of the
//                                           marketplace is trainer/member pairs
//                                           who share no other relationship)
//   member <-> gym staff at their gym   : gym_memberships + gym_staff, same gym_id
//   member <-> member, same gym         : gym_memberships (both) + buddy_requests
//                                         accepted, same gym_id (opt-in)
//   staff <-> staff, same gym           : active gym_staff rows
//   trainer <-> active gym member       : trainer_profiles + gym_memberships,
//                                         same active gym
//   trainer <-> gym owner/staff         : trainer_profiles.gym_id (gym-affiliated,
//                                         is_active) matched against gyms.owner_id
//                                         or gym_staff, same gym_id
//   gym owner <-> their staff           : gyms.owner_id + gym_staff, same gym_id
//   gym owner <-> their members         : gyms.owner_id + gym_memberships, same gym_id
//
// Every check is symmetric — canMessage(A, B) === canMessage(B, A) — because
// each rule above is tried in both directions.

async function gymIdSet(supabase, table, userId, extraFilters = {}) {
  let query = supabase.from(table).select('gym_id').eq('user_id', userId);
  for (const [col, val] of Object.entries(extraFilters)) query = query.eq(col, val);
  const { data, error } = await query;
  if (error) throw error;
  return new Set((data || []).map((r) => r.gym_id).filter(Boolean));
}

function intersects(setA, setB) {
  for (const v of setA) if (setB.has(v)) return true;
  return false;
}

async function ownedGymIds(supabase, userId) {
  const { data, error } = await supabase.from('gyms').select('id').eq('owner_id', userId).eq('is_active', true);
  if (error) throw error;
  return new Set((data || []).map((r) => r.id));
}

async function activeGymIds(supabase, gymIds) {
  if (!gymIds.size) return new Set();
  const { data, error } = await supabase
    .from('gyms')
    .select('id')
    .in('id', [...gymIds])
    .eq('is_active', true);
  if (error) throw error;
  return new Set((data || []).map((r) => r.id));
}

// A membership marked active is not messaging-active after its end date.
// Date-only database values are compared to the UTC calendar date so the
// backend has one stable rule regardless of the Node host timezone.
async function activeMembershipGymIds(supabase, userId) {
  const today = new Date().toISOString().slice(0, 10);
  const { data, error } = await supabase
    .from('gym_memberships')
    .select('gym_id')
    .eq('user_id', userId)
    .eq('status', 'active')
    .or(`end_date.is.null,end_date.gte.${today}`);
  if (error) throw error;
  return new Set((data || []).map((r) => r.gym_id).filter(Boolean));
}

async function isLinkedTrainerClient(supabase, userA, userB) {
  const { data, error } = await supabase
    .from('trainer_clients')
    .select('id')
    .eq('status', 'active')
    .or(
      `and(trainer_id.eq.${userA},client_id.eq.${userB}),and(trainer_id.eq.${userB},client_id.eq.${userA})`
    )
    .limit(1);
  if (error) throw error;
  return (data || []).length > 0;
}

async function hasMarketplacePurchaseRelationship(supabase, userA, userB) {
  const { data, error } = await supabase
    .from('marketplace_purchases')
    .select('id')
    .neq('status', 'cancelled')
    .or(
      `and(buyer_id.eq.${userA},seller_id.eq.${userB}),and(buyer_id.eq.${userB},seller_id.eq.${userA})`
    )
    .limit(1);
  if (error) throw error;
  return (data || []).length > 0;
}

async function acceptedBuddyGymId(supabase, userA, userB) {
  const { data, error } = await supabase
    .from('buddy_requests')
    .select('gym_id')
    .eq('status', 'accepted')
    .or(
      `and(sender_id.eq.${userA},receiver_id.eq.${userB}),and(sender_id.eq.${userB},receiver_id.eq.${userA})`
    )
    .not('gym_id', 'is', null)
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data?.gym_id || null;
}

/**
 * getGymContexts(supabase, userId) -> { owned, staff, member, trainer }
 * The same per-user gym-relationship sets canMessage checks intersections
 * over. Exported so other call sites (e.g. GET /api/chat/contacts) can
 * reuse the exact same relationship data canMessage's decision is based
 * on, instead of re-deriving it separately.
 */
async function getGymContexts(supabase, userId) {
  const [owned, rawStaff, rawMember, rawTrainer] = await Promise.all([
    ownedGymIds(supabase, userId),
    gymIdSet(supabase, 'gym_staff', userId, { is_active: true }),
    activeMembershipGymIds(supabase, userId),
    gymIdSet(supabase, 'trainer_profiles', userId, { is_active: true, status: 'active' }),
  ]);
  // Staff, membership, and trainer-profile rows can outlive a gym being
  // deactivated. Every gym-based permission requires the gym itself to remain
  // active, including staff↔staff and trainer↔member.
  const active = await activeGymIds(
    supabase,
    new Set([...rawStaff, ...rawMember, ...rawTrainer])
  );
  const onlyActiveGyms = (gymIds) => new Set([...gymIds].filter((id) => active.has(id)));
  const staff = onlyActiveGyms(rawStaff);
  const member = onlyActiveGyms(rawMember);
  const trainer = onlyActiveGyms(rawTrainer);
  return { owned, staff, member, trainer };
}

function firstShared(setA, setB) {
  for (const v of setA) if (setB.has(v)) return v;
  return null;
}

/**
 * sharedGymId(gymsA, gymsB) -> gym id string | null
 * Given two getGymContexts() results, returns the gym id responsible for
 * a gym-based canMessage allow (same precedence order canMessage checks).
 * Returns null for relationships not based on a shared gym (trainer_clients).
 */
function sharedGymId(gymsA, gymsB) {
  const pairs = [
    [gymsA.owned, gymsB.staff], [gymsB.owned, gymsA.staff],
    [gymsA.owned, gymsB.member], [gymsB.owned, gymsA.member],
    [gymsA.owned, gymsB.trainer], [gymsB.owned, gymsA.trainer],
    [gymsA.staff, gymsB.member], [gymsB.staff, gymsA.member],
    [gymsA.staff, gymsB.trainer], [gymsB.staff, gymsA.trainer],
    [gymsA.staff, gymsB.staff],
    [gymsA.trainer, gymsB.member], [gymsB.trainer, gymsA.member],
    [gymsA.member, gymsB.member],
  ];
  for (const [a, b] of pairs) {
    const v = firstShared(a, b);
    if (v) return v;
  }
  return null;
}

/**
 * canMessage(supabase, userA, userB) -> Promise<boolean>
 * supabase must be a service-role client (this bypasses RLS by design —
 * it IS the authorization check RLS defers to for writes).
 */
async function canMessage(supabase, userA, userB) {
  if (!userA || !userB || userA === userB) return false;

  // trainer <-> their client
  if (await isLinkedTrainerClient(supabase, userA, userB)) return true;

  // buyer <-> seller of a marketplace purchase — deliberately bypasses every
  // gym-based check below, since the marketplace is explicitly cross-gym.
  if (await hasMarketplacePurchaseRelationship(supabase, userA, userB)) return true;

  // Gather each user's gym contexts in parallel.
  const [a, b] = await Promise.all([
    getGymContexts(supabase, userA),
    getGymContexts(supabase, userB),
  ]);

  // gym owner <-> their staff
  if (intersects(a.owned, b.staff) || intersects(b.owned, a.staff)) return true;

  // gym owner <-> their members
  if (intersects(a.owned, b.member) || intersects(b.owned, a.member)) return true;

  // gym owner <-> gym-affiliated trainer
  if (intersects(a.owned, b.trainer) || intersects(b.owned, a.trainer)) return true;

  // staff <-> member, same gym
  if (intersects(a.staff, b.member) || intersects(b.staff, a.member)) return true;

  // staff <-> gym-affiliated trainer, same gym
  if (intersects(a.staff, b.trainer) || intersects(b.staff, a.trainer)) return true;

  // active staff <-> active staff, same active gym
  if (intersects(a.staff, b.staff)) return true;

  // active gym-affiliated trainer <-> active gym member, same active gym
  if (intersects(a.trainer, b.member) || intersects(b.trainer, a.member)) return true;

  // member <-> member, same gym, opt-in accepted buddy request scoped to that gym
  if (intersects(a.member, b.member)) {
    const buddyGymId = await acceptedBuddyGymId(supabase, userA, userB);
    if (buddyGymId && a.member.has(buddyGymId) && b.member.has(buddyGymId)) return true;
  }

  return false;
}

/**
 * getOrCreateConversationIfAllowed(supabase, userA, userB)
 * Gates the hardened chat_get_or_create_conversation RPC behind canMessage so every
 * conversation-creation call site (not just POST /api/chat/start) shares
 * the same permission check. Returns the conversation id, or null if not
 * allowed.
 */
async function getOrCreateConversationIfAllowed(supabase, userA, userB) {
  if (!(await canMessage(supabase, userA, userB))) return null;
  const { data, error } = await supabase.rpc('chat_get_or_create_conversation', {
    user_a: userA,
    user_b: userB,
  });
  if (error) throw error;
  return data;
}

module.exports = { canMessage, getOrCreateConversationIfAllowed, getGymContexts, sharedGymId, activeMembershipGymIds };
