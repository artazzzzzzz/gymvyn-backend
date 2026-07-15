'use strict';

const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const { auth } = require('../middleware/auth');
const { importMembers, claimPendingMemberships, MAX_IMPORT_ROWS } = require('../services/memberImportService');
const { normalizeEmail, normalizeIndianPhone } = require('../utils/identityNormalization');
const { createAuthUserCache } = require('../services/authUserCache');

const router = express.Router();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

async function listAllAuthUsers() {
  const users = [];
  for (let page = 1; page <= 100; page++) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw error;
    users.push(...(data?.users || []));
    if (!data?.users || data.users.length < 1000) break;
  }
  return users;
}

function authEmailVerified(user) {
  return !!(user?.email && (user.email_confirmed_at || user.confirmed_at));
}

function authPhoneVerified(user) {
  return !!(user?.phone && (user.phone_confirmed_at || user.confirmed_at));
}

function normalizeSupabaseError(error) {
  if (!error) return null;
  const message = error.message || 'Database error';
  const duplicate = error.code === '23505' || /duplicate key/i.test(message);
  return { message, duplicate };
}

function buildRepo() {
  // One import request can validate identity for hundreds of rows; without
  // this, findExistingUserByIdentity below would re-run a full paginated
  // scan of every Supabase auth user for every single row. Memoizing here
  // (scoped to this buildRepo() instance, i.e. one per HTTP request) fetches
  // the auth-user list once and reuses it for the whole import.
  const getAuthUsers = createAuthUserCache(listAllAuthUsers);

  return {
    async isGymOwner(userId, gymId) {
      const { data, error } = await supabase
        .from('gyms')
        .select('id')
        .eq('id', gymId)
        .eq('owner_id', userId)
        .eq('is_active', true)
        .maybeSingle();
      if (error) throw error;
      return !!data;
    },

    async getActiveStaff(userId, gymId) {
      const { data, error } = await supabase
        .from('gym_staff')
        .select('id')
        .eq('gym_id', gymId)
        .eq('user_id', userId)
        .eq('is_active', true)
        .maybeSingle();
      if (error) throw error;
      return data || null;
    },

    async staffHasAnyPermission(staffId, permissionKeys) {
      const { data, error } = await supabase
        .from('staff_permissions')
        .select('permission_key')
        .eq('staff_id', staffId)
        .in('permission_key', permissionKeys)
        .eq('enabled', true);
      if (error) throw error;
      return (data || []).length > 0;
    },

    async findExistingUserByIdentity(identity) {
      const [authUsers, publicPhoneUser] = await Promise.all([
        getAuthUsers(),
        identity.phone
          ? supabase.from('users').select('*').eq('phone', identity.phone).limit(10)
          : Promise.resolve({ data: null, error: null }),
      ]);

      if (publicPhoneUser.error) throw publicPhoneUser.error;

      const authUserIds = new Set(authUsers.map(user => user.id));
      const publicPhoneRows = Array.isArray(publicPhoneUser.data) ? publicPhoneUser.data : [];
      let phoneUserId = publicPhoneRows.find(row => authUserIds.has(row.id))?.id || null;
      let emailUserId = null;

      for (const authUser of authUsers) {
        const verifiedPhone = authPhoneVerified(authUser) ? normalizeIndianPhone(authUser.phone) : null;
        const verifiedEmail = authEmailVerified(authUser) ? normalizeEmail(authUser.email) : null;

        if (identity.phone && verifiedPhone === identity.phone) phoneUserId = authUser.id;
        if (identity.email && verifiedEmail === identity.email) emailUserId = authUser.id;
      }

      if (phoneUserId && emailUserId && phoneUserId !== emailUserId) {
        return { conflict: true, phoneUserId, emailUserId };
      }

      const userId = phoneUserId || emailUserId;
      if (!userId) return { conflict: false, user: null };

      const { data: user, error } = await supabase
        .from('users')
        .select('*')
        .eq('id', userId)
        .maybeSingle();
      if (error) throw error;
      if (!user) return { conflict: false, user: null };
      return { conflict: false, user };
    },

    async getUserProfile(userId) {
      const { data, error } = await supabase
        .from('users')
        .select('*')
        .eq('id', userId)
        .maybeSingle();
      if (error) throw error;
      return data || null;
    },

    async updateUserProfile(userId, updates) {
      const { error } = await supabase.from('users').update(updates).eq('id', userId);
      if (error) throw error;
    },

    async findMembership(gymId, userId) {
      const { data, error } = await supabase
        .from('gym_memberships')
        .select('*')
        .eq('gym_id', gymId)
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data || null;
    },

    async createMembership(payload) {
      const { data, error } = await supabase
        .from('gym_memberships')
        .insert(payload)
        .select('id')
        .single();
      if (error) {
        const normalized = normalizeSupabaseError(error);
        if (normalized.duplicate) {
          const existing = await this.findMembership(payload.gym_id, payload.user_id);
          if (existing) return existing;
        }
        throw error;
      }
      await supabase.from('users').update({ gym_id: payload.gym_id, role: 'gym_member' }).eq('id', payload.user_id);
      return data;
    },

    async updateMembership(membershipId, payload) {
      const updates = {
        membership_type: payload.membership_type,
        monthly_fee: payload.monthly_fee,
        start_date: payload.start_date,
        end_date: payload.end_date,
        status: payload.status,
        assigned_trainer_id: payload.assigned_trainer_id,
        notes: payload.notes,
        metadata: payload.metadata,
        updated_at: new Date().toISOString(),
      };
      if (payload.imported_member_id) updates.imported_member_id = payload.imported_member_id;
      const { data, error } = await supabase
        .from('gym_memberships')
        .update(updates)
        .eq('id', membershipId)
        .select('id')
        .single();
      if (error) throw error;
      return data;
    },

    async reactivateMembership(membershipId, payload) {
      return this.updateMembership(membershipId, payload);
    },

    async findOpenImportedMember(gymId, identity, gymMemberCode) {
      let candidates = [];
      if (identity.phone) {
        const { data, error } = await supabase
          .from('imported_gym_members')
          .select('*')
          .eq('gym_id', gymId)
          .eq('normalized_phone', identity.phone)
          .in('status', ['unclaimed', 'claiming'])
          .limit(1);
        if (error) throw error;
        candidates = candidates.concat(data || []);
      }
      if (identity.email) {
        const { data, error } = await supabase
          .from('imported_gym_members')
          .select('*')
          .eq('gym_id', gymId)
          .eq('normalized_email', identity.email)
          .in('status', ['unclaimed', 'claiming'])
          .limit(1);
        if (error) throw error;
        candidates = candidates.concat(data || []);
      }
      if (gymMemberCode) {
        const { data, error } = await supabase
          .from('imported_gym_members')
          .select('*')
          .eq('gym_id', gymId)
          .eq('gym_member_code', gymMemberCode)
          .in('status', ['unclaimed', 'claiming'])
          .limit(1);
        if (error) throw error;
        candidates = candidates.concat(data || []);
      }
      return candidates[0] || null;
    },

    async createImportedMember(payload) {
      const { data, error } = await supabase
        .from('imported_gym_members')
        .insert(payload)
        .select('id')
        .single();
      if (error) {
        const normalized = normalizeSupabaseError(error);
        if (normalized.duplicate) {
          const existing = await this.findOpenImportedMember(payload.gym_id, {
            phone: payload.normalized_phone,
            email: payload.normalized_email,
          }, payload.gym_member_code);
          if (existing) return existing;
        }
        throw error;
      }
      return data;
    },

    async findClaimableImportedMembers(identity) {
      const byId = new Map();
      if (identity.phone) {
        const { data, error } = await supabase
          .from('imported_gym_members')
          .select('*')
          .eq('normalized_phone', identity.phone)
          .eq('status', 'unclaimed');
        if (error) throw error;
        for (const row of data || []) byId.set(row.id, row);
      }
      if (identity.email) {
        const { data, error } = await supabase
          .from('imported_gym_members')
          .select('*')
          .eq('normalized_email', identity.email)
          .eq('status', 'unclaimed');
        if (error) throw error;
        for (const row of data || []) byId.set(row.id, row);
      }
      return [...byId.values()];
    },

    async markImportedMemberClaimed(importedMemberId, userId, membershipId) {
      const { error } = await supabase
        .from('imported_gym_members')
        .update({
          status: 'claimed',
          claimed_user_id: userId,
          claimed_membership_id: membershipId,
          claimed_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq('id', importedMemberId)
        .in('status', ['unclaimed', 'claiming', 'claimed']);
      if (error) throw error;
    },
  };
}

router.post('/:gymId/import', auth, async (req, res) => {
  try {
    const rows = req.body?.members || req.body?.rows;
    if (Array.isArray(rows) && rows.length > MAX_IMPORT_ROWS) {
      return res.status(400).json({
        error: `Cannot import more than ${MAX_IMPORT_ROWS} rows in a single request (received ${rows.length}).`,
      });
    }
    const result = await importMembers(buildRepo(), {
      actorUserId: req.user.id,
      gymId: req.params.gymId,
      rows,
    });
    if (result.error) {
      return res.status(400).json({ error: result.error });
    }

    const unauthorized = result.results.length > 0 && result.results.every(r => r.status === 'authorization_error');
    res.status(unauthorized ? 403 : 200).json(result);
  } catch (err) {
    console.error('POST /api/member-imports/:gymId/import error:', err);
    res.status(500).json({ error: 'Failed to import members' });
  }
});

router.post('/claim-pending', auth, async (req, res) => {
  try {
    const result = await claimPendingMemberships(buildRepo(), { authUser: req.user });
    res.json(result);
  } catch (err) {
    console.error('POST /api/member-imports/claim-pending error:', err);
    res.status(500).json({ error: 'Failed to claim pending memberships' });
  }
});

module.exports = router;
