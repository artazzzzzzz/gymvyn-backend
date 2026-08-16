const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const { auth: authenticateToken, requireGymOwner, requireStaffRole } = require('../middleware/auth');

const router = express.Router();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const PERMISSION_KEYS = [
  'checkin',
  'view_members',
  'manage_members',
  'view_payments',
  'collect_payment',
  'view_schedule',
  'manage_lockers',
  'view_supplements',
  'view_announcements',
  'manage_feed',
  'chat',
];

// ── Helpers ────────────────────────────────────────────────────────────────────

function buildPermissionsMap(permRows) {
  const map = {};
  for (const key of PERMISSION_KEYS) map[key] = false;
  for (const row of permRows) map[row.permission_key] = row.enabled;
  return map;
}

async function getStaffWithPermissions(gymId) {
  const { data: staffRows, error: staffErr } = await supabase
    .from('gym_staff')
    .select('id, user_id, role_label, is_active, created_at, users!gym_staff_user_id_fkey(full_name)')
    .eq('gym_id', gymId)
    .order('created_at', { ascending: true });

  if (staffErr) throw staffErr;
  if (!staffRows.length) return [];

  const staffIds = staffRows.map(s => s.id);
  const { data: permRows, error: permErr } = await supabase
    .from('staff_permissions')
    .select('staff_id, permission_key, enabled')
    .in('staff_id', staffIds);

  if (permErr) throw permErr;

  const permsByStaff = {};
  for (const p of permRows || []) {
    if (!permsByStaff[p.staff_id]) permsByStaff[p.staff_id] = [];
    permsByStaff[p.staff_id].push(p);
  }

  return staffRows.map(s => ({
    id: s.id,
    userId: s.user_id,
    fullName: s.users?.full_name || '',
    roleLabel: s.role_label,
    isActive: s.is_active,
    createdAt: s.created_at,
    permissions: buildPermissionsMap(permsByStaff[s.id] || []),
  }));
}

async function insertDefaultPermissions(staffId) {
  const rows = PERMISSION_KEYS.map(key => ({
    staff_id: staffId,
    permission_key: key,
    enabled: false,
  }));
  const { error } = await supabase.from('staff_permissions').insert(rows);
  if (error) throw error;
}

async function verifyStaffOwnership(staffId, ownerId) {
  const { data, error } = await supabase
    .from('gym_staff')
    .select('id, gyms!gym_staff_gym_id_fkey(owner_id)')
    .eq('id', staffId)
    .maybeSingle();

  if (error) throw error;
  if (!data) return false;
  return data.gyms?.owner_id === ownerId;
}

// ── Gym owner routes ───────────────────────────────────────────────────────────

// GET /api/staff/gym/:gymId
router.get('/gym/:gymId', authenticateToken, requireGymOwner, async (req, res) => {
  try {
    const staff = await getStaffWithPermissions(req.params.gymId);
    res.json(staff);
  } catch (err) {
    console.error('GET /api/staff/gym/:gymId error:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/staff/gym/:gymId/invite
router.post('/gym/:gymId/invite', authenticateToken, requireGymOwner, async (req, res) => {
  try {
    const { gymId } = req.params;
    const { userId, roleLabel } = req.body;

    if (!userId) return res.status(400).json({ error: 'userId is required' });

    const { data: userRow, error: userErr } = await supabase
      .from('users')
      .select('id, role, full_name')
      .eq('id', userId)
      .maybeSingle();

    if (userErr) throw userErr;
    if (!userRow) return res.status(404).json({ error: 'User not found' });
    if (userRow.role !== 'staff') {
      return res.status(400).json({ error: 'User role must be "staff" to be added as staff' });
    }

    const { data: staffRow, error: insertErr } = await supabase
      .from('gym_staff')
      .insert({
        gym_id: gymId,
        user_id: userId,
        role_label: roleLabel || 'Front Desk',
        invited_by: req.user.id,
      })
      .select('id, user_id, role_label, is_active, created_at')
      .single();

    if (insertErr) {
      if (insertErr.code === '23505') {
        return res.status(409).json({ error: 'This user is already a staff member of this gym' });
      }
      throw insertErr;
    }

    await insertDefaultPermissions(staffRow.id);

    res.status(201).json({
      id: staffRow.id,
      userId: staffRow.user_id,
      fullName: userRow.full_name || '',
      roleLabel: staffRow.role_label,
      isActive: staffRow.is_active,
      createdAt: staffRow.created_at,
      permissions: buildPermissionsMap([]),
    });
  } catch (err) {
    console.error('POST /api/staff/gym/:gymId/invite error:', err);
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/staff/:staffId/permissions
router.patch('/:staffId/permissions', authenticateToken, async (req, res) => {
  try {
    const { staffId } = req.params;
    const { permissions } = req.body;

    if (!permissions || typeof permissions !== 'object') {
      return res.status(400).json({ error: 'permissions object is required' });
    }

    const isOwner = await verifyStaffOwnership(staffId, req.user.id);
    if (!isOwner) return res.status(403).json({ error: 'You do not manage this staff member' });

    const upserts = Object.entries(permissions)
      .filter(([key]) => PERMISSION_KEYS.includes(key))
      .map(([key, enabled]) => ({
        staff_id: staffId,
        permission_key: key,
        enabled: Boolean(enabled),
        updated_at: new Date().toISOString(),
      }));

    if (!upserts.length) return res.status(400).json({ error: 'No valid permission keys provided' });

    const { error } = await supabase
      .from('staff_permissions')
      .upsert(upserts, { onConflict: 'staff_id,permission_key' });

    if (error) throw error;

    const { data: allPerms, error: fetchErr } = await supabase
      .from('staff_permissions')
      .select('permission_key, enabled')
      .eq('staff_id', staffId);

    if (fetchErr) throw fetchErr;

    res.json(buildPermissionsMap(allPerms || []));
  } catch (err) {
    console.error('PATCH /api/staff/:staffId/permissions error:', err);
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/staff/:staffId
router.patch('/:staffId', authenticateToken, async (req, res) => {
  try {
    const { staffId } = req.params;
    const { roleLabel, isActive } = req.body;

    const isOwner = await verifyStaffOwnership(staffId, req.user.id);
    if (!isOwner) return res.status(403).json({ error: 'You do not manage this staff member' });

    const updates = {};
    if (roleLabel !== undefined) updates.role_label = roleLabel;
    if (isActive !== undefined) updates.is_active = Boolean(isActive);

    if (!Object.keys(updates).length) {
      return res.status(400).json({ error: 'No valid fields to update' });
    }

    const { data, error } = await supabase
      .from('gym_staff')
      .update(updates)
      .eq('id', staffId)
      .select()
      .single();

    if (error) throw error;

    res.json(data);
  } catch (err) {
    console.error('PATCH /api/staff/:staffId error:', err);
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/staff/:staffId
router.delete('/:staffId', authenticateToken, async (req, res) => {
  try {
    const { staffId } = req.params;

    const isOwner = await verifyStaffOwnership(staffId, req.user.id);
    if (!isOwner) return res.status(403).json({ error: 'You do not manage this staff member' });

    const { error } = await supabase
      .from('gym_staff')
      .update({ is_active: false })
      .eq('id', staffId);

    if (error) throw error;

    res.json({ success: true });
  } catch (err) {
    console.error('DELETE /api/staff/:staffId error:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/staff/gym/:gymId/code
router.get('/gym/:gymId/code', authenticateToken, requireGymOwner, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('gyms')
      .select('staff_code')
      .eq('id', req.params.gymId)
      .single();

    if (error) throw error;

    let staffCode = data.staff_code;
    if (!staffCode) {
      staffCode = Math.random().toString(36).substring(2, 8).toUpperCase();
      await supabase.from('gyms').update({ staff_code: staffCode }).eq('id', req.params.gymId);
    }

    res.json({ staffCode });
  } catch (err) {
    console.error('GET /api/staff/gym/:gymId/code error:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/staff/gym/:gymId/regenerate-code
router.post('/gym/:gymId/regenerate-code', authenticateToken, requireGymOwner, async (req, res) => {
  try {
    const newCode = Math.random().toString(36).substring(2, 8).toUpperCase();

    const { error } = await supabase
      .from('gyms')
      .update({ staff_code: newCode })
      .eq('id', req.params.gymId);

    if (error) throw error;

    res.json({ staffCode: newCode });
  } catch (err) {
    console.error('POST /api/staff/gym/:gymId/regenerate-code error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ── Staff routes ───────────────────────────────────────────────────────────────

// GET /api/staff/me
router.get('/me', authenticateToken, requireStaffRole, async (req, res) => {
  try {
    const { data: staffRow, error: staffErr } = await supabase
      .from('gym_staff')
      .select('id, gym_id, role_label, is_active, gyms!gym_staff_gym_id_fkey(name)')
      .eq('user_id', req.user.id)
      .eq('is_active', true)
      .maybeSingle();

    if (staffErr) throw staffErr;
    if (!staffRow) return res.status(404).json({ error: 'No active staff record found' });

    const { data: perms, error: permErr } = await supabase
      .from('staff_permissions')
      .select('permission_key, enabled')
      .eq('staff_id', staffRow.id);

    if (permErr) throw permErr;

    res.json({
      staffId: staffRow.id,
      gymId: staffRow.gym_id,
      gymName: staffRow.gyms?.name || '',
      roleLabel: staffRow.role_label,
      isActive: staffRow.is_active,
      permissions: buildPermissionsMap(perms || []),
    });
  } catch (err) {
    console.error('GET /api/staff/me error:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/staff/me/gym
router.get('/me/gym', authenticateToken, requireStaffRole, async (req, res) => {
  try {
    const { data: staffRow, error: staffErr } = await supabase
      .from('gym_staff')
      .select('gym_id')
      .eq('user_id', req.user.id)
      .eq('is_active', true)
      .maybeSingle();

    if (staffErr) throw staffErr;
    if (!staffRow) return res.status(404).json({ error: 'No active staff record found' });

    const { data: gym, error: gymErr } = await supabase
      .from('gyms')
      .select('*')
      .eq('id', staffRow.gym_id)
      .single();

    if (gymErr) throw gymErr;

    res.json(gym);
  } catch (err) {
    console.error('GET /api/staff/me/gym error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ── Join flow ──────────────────────────────────────────────────────────────────

// POST /api/staff/join
router.post('/join', authenticateToken, async (req, res) => {
  try {
    const { staffCode } = req.body;
    if (!staffCode) return res.status(400).json({ error: 'staffCode is required' });

    const { data: userRow, error: userErr } = await supabase
      .from('users')
      .select('role')
      .eq('id', req.user.id)
      .maybeSingle();

    if (userErr) throw userErr;
    if (!userRow || userRow.role !== 'staff') {
      return res.status(400).json({
        error: 'Your account role is not set to staff. Please select the Staff role during onboarding.',
      });
    }

    const { data: gym, error: gymErr } = await supabase
      .from('gyms')
      .select('id, name')
      .eq('staff_code', staffCode.toUpperCase())
      .maybeSingle();

    if (gymErr) throw gymErr;
    if (!gym) return res.status(404).json({ error: 'Invalid staff code — no gym found' });

    const { data: existing, error: existingErr } = await supabase
      .from('gym_staff')
      .select('id')
      .eq('user_id', req.user.id)
      .maybeSingle();

    if (existingErr) throw existingErr;
    if (existing) {
      return res.status(409).json({ error: 'You are already a staff member at a gym' });
    }

    const { data: staffRow, error: insertErr } = await supabase
      .from('gym_staff')
      .insert({
        gym_id: gym.id,
        user_id: req.user.id,
        role_label: 'Front Desk',
      })
      .select('id')
      .single();

    if (insertErr) throw insertErr;

    await insertDefaultPermissions(staffRow.id);

    res.status(201).json({
      gymId: gym.id,
      gymName: gym.name,
      staffId: staffRow.id,
    });
  } catch (err) {
    console.error('POST /api/staff/join error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ── Staff permission middleware factory ────────────────────────────────────────

function staffPerm(permKey) {
  return async (req, res, next) => {
    try {
      const { data: staffRow, error: se } = await supabase
        .from('gym_staff')
        .select('id, gym_id')
        .eq('user_id', req.user.id)
        .eq('is_active', true)
        .maybeSingle();

      if (se) return res.status(500).json({ error: se.message });
      if (!staffRow) return res.status(403).json({ error: 'No active staff record' });

      const { data: perm, error: pe } = await supabase
        .from('staff_permissions')
        .select('enabled')
        .eq('staff_id', staffRow.id)
        .eq('permission_key', permKey)
        .maybeSingle();

      if (pe) return res.status(500).json({ error: pe.message });
      if (!perm || !perm.enabled) {
        return res.status(403).json({ error: `Permission "${permKey}" not granted` });
      }

      req.gymId = staffRow.gym_id;
      req.staffRowId = staffRow.id;
      next();
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  };
}

// ── Staff locker routes ────────────────────────────────────────────────────────

// GET /api/staff/lockers
router.get('/lockers', authenticateToken, requireStaffRole, staffPerm('manage_lockers'), async (req, res) => {
  try {
    const { data: lockers, error } = await supabase
      .from('gym_lockers')
      .select('*')
      .eq('gym_id', req.gymId)
      .order('label', { ascending: true });

    if (error) throw error;

    const occupiedIds = (lockers || []).filter(l => l.status === 'occupied').map(l => l.id);
    const assignmentMap = {};
    if (occupiedIds.length > 0) {
      const { data: assignments } = await supabase
        .from('locker_assignments')
        .select('id, locker_id, member_id, expires_at, duration_days')
        .in('locker_id', occupiedIds)
        .eq('status', 'active');

      const memberIds = [...new Set((assignments || []).map(a => a.member_id))];
      const memberMap = {};
      if (memberIds.length > 0) {
        const { data: members } = await supabase
          .from('users').select('id, full_name, phone').in('id', memberIds);
        for (const m of members || []) memberMap[m.id] = m;
      }

      const assignmentIds = (assignments || []).map(a => a.id);
      const paymentMap = {};
      if (assignmentIds.length > 0) {
        const { data: payments } = await supabase
          .from('locker_payments')
          .select('assignment_id, payment_status, payment_method, paid_at')
          .in('assignment_id', assignmentIds);
        for (const p of payments || []) paymentMap[p.assignment_id] = p;
      }

      for (const a of assignments || []) {
        const member = memberMap[a.member_id] || {};
        const pay = paymentMap[a.id];
        assignmentMap[a.locker_id] = {
          id: a.id,
          member_id: a.member_id,
          member_name: member.full_name || null,
          member_phone: member.phone || null,
          expires_at: a.expires_at,
          duration_days: a.duration_days,
          payment_status: pay?.payment_status || null,
          payment_method: pay?.payment_method || null,
          paid_at: pay?.paid_at || null,
        };
      }
    }

    res.json((lockers || []).map(l => ({ ...l, assignment: assignmentMap[l.id] || null })));
  } catch (err) {
    console.error('GET /api/staff/lockers error:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/staff/lockers/:lockerId/assign
router.post('/lockers/:lockerId/assign', authenticateToken, requireStaffRole, staffPerm('manage_lockers'), async (req, res) => {
  try {
    const { lockerId } = req.params;
    const { member_id, duration_days } = req.body;

    if (!member_id) return res.status(400).json({ error: 'member_id is required' });
    const days = parseInt(duration_days, 10);
    if (!Number.isInteger(days) || days < 1) return res.status(400).json({ error: 'duration_days must be a positive integer' });

    const { data: locker, error: le } = await supabase
      .from('gym_lockers').select('id, label, status, is_paid, price')
      .eq('id', lockerId).eq('gym_id', req.gymId).maybeSingle();

    if (le) throw le;
    if (!locker) return res.status(404).json({ error: 'Locker not found' });
    if (locker.status !== 'available') return res.status(409).json({ error: `Locker "${locker.label}" is ${locker.status}` });

    const { data: membership, error: me } = await supabase
      .from('gym_memberships').select('id, start_date, end_date')
      .eq('gym_id', req.gymId).eq('user_id', member_id).eq('status', 'active').maybeSingle();
    if (me) throw me;
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
    const membershipIsCurrent = membership
      && (!membership.start_date || membership.start_date <= today)
      && (!membership.end_date || membership.end_date >= today);
    if (!membershipIsCurrent) return res.status(400).json({ error: 'Member is not active in this gym' });

    const expiresAt = new Date(Date.now() + days * 86400000).toISOString();
    const { data: assignment, error: ae } = await supabase
      .from('locker_assignments')
      .insert({ locker_id: lockerId, gym_id: req.gymId, member_id, duration_days: days, expires_at: expiresAt, status: 'active' })
      .select().single();
    if (ae) throw ae;

    await supabase.from('gym_lockers').update({ status: 'occupied' }).eq('id', lockerId);

    let payment = null;
    if (locker.is_paid) {
      const { data: pr, error: pe } = await supabase
        .from('locker_payments')
        .insert({ assignment_id: assignment.id, gym_id: req.gymId, amount: locker.price, payment_status: 'unpaid' })
        .select().single();
      if (pe) throw pe;
      payment = pr;
    }

    res.status(201).json({ assignment, payment });
  } catch (err) {
    console.error('POST /api/staff/lockers/:lockerId/assign error:', err);
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/staff/lockers/:lockerId/release
router.patch('/lockers/:lockerId/release', authenticateToken, requireStaffRole, staffPerm('manage_lockers'), async (req, res) => {
  try {
    const { lockerId } = req.params;
    const { data: locker, error: le } = await supabase
      .from('gym_lockers').select('id, label, status')
      .eq('id', lockerId).eq('gym_id', req.gymId).maybeSingle();

    if (le) throw le;
    if (!locker) return res.status(404).json({ error: 'Locker not found' });
    if (locker.status !== 'occupied') return res.status(409).json({ error: 'Locker has no active assignment' });

    const { data: assignment, error: ae } = await supabase
      .from('locker_assignments').select('id')
      .eq('locker_id', lockerId).eq('gym_id', req.gymId).eq('status', 'active').maybeSingle();
    if (ae) throw ae;
    if (!assignment) return res.status(404).json({ error: 'No active assignment found' });

    const now = new Date().toISOString();
    await supabase.from('locker_assignments').update({ status: 'ended_early', ended_at: now }).eq('id', assignment.id);
    await supabase.from('gym_lockers').update({ status: 'available' }).eq('id', lockerId);

    res.json({ success: true });
  } catch (err) {
    console.error('PATCH /api/staff/lockers/:lockerId/release error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ── Staff supplement order routes ──────────────────────────────────────────────

// GET /api/staff/supplements/orders
router.get('/supplements/orders', authenticateToken, requireStaffRole, staffPerm('view_supplements'), async (req, res) => {
  try {
    const { status } = req.query;
    let query = supabase
      .from('supplement_orders')
      .select(`
        id, status, payment_status, payment_method, total_amount, notes, created_at, updated_at,
        users!supplement_orders_user_id_fkey(full_name),
        supplement_order_items(id, quantity, unit_price_snapshot, product_name_snapshot)
      `)
      .eq('gym_id', req.gymId)
      .order('created_at', { ascending: false });

    if (status && status !== 'all') query = query.eq('status', status);

    const { data, error } = await query;
    if (error) throw error;

    const result = (data || []).map(o => ({
      ...o,
      member_name: o.users?.full_name || null,
      users: undefined,
    }));

    res.json(result);
  } catch (err) {
    console.error('GET /api/staff/supplements/orders error:', err);
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/staff/supplements/orders/:orderId/status
router.patch('/supplements/orders/:orderId/status', authenticateToken, requireStaffRole, staffPerm('view_supplements'), async (req, res) => {
  try {
    const { orderId } = req.params;
    const { status } = req.body;

    const VALID = {
      pending: ['ready_for_pickup', 'cancelled'],
      ready_for_pickup: ['completed', 'cancelled'],
    };

    const { data: order, error: oe } = await supabase
      .from('supplement_orders').select('id, status')
      .eq('id', orderId).eq('gym_id', req.gymId).maybeSingle();
    if (oe) throw oe;
    if (!order) return res.status(404).json({ error: 'Order not found' });

    const allowed = VALID[order.status] || [];
    if (!allowed.includes(status)) {
      return res.status(400).json({ error: `Cannot move from "${order.status}" to "${status}"` });
    }

    const { data, error } = await supabase
      .from('supplement_orders')
      .update({ status, updated_at: new Date().toISOString() })
      .eq('id', orderId).eq('gym_id', req.gymId)
      .select().single();
    if (error) throw error;

    res.json(data);
  } catch (err) {
    console.error('PATCH /api/staff/supplements/orders/:orderId/status error:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
