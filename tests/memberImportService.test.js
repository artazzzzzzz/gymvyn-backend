'use strict';

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const {
  importMembers,
  claimPendingMemberships,
  RESULT_STATUS,
  MAX_IMPORT_ROWS,
} = require('../services/memberImportService');

function makeRepo(seed = {}) {
  const state = {
    owners: new Set(seed.owners || ['owner:gym1']),
    staff: new Map(seed.staff || []),
    staffPermissions: new Map(seed.staffPermissions || []),
    users: new Map((seed.users || []).map(u => [u.id, { ...u }])),
    phoneToUser: new Map(seed.phoneToUser || []),
    emailToUser: new Map(seed.emailToUser || []),
    memberships: new Map((seed.memberships || []).map(m => [m.id, { ...m }])),
    imported: new Map((seed.imported || []).map(i => [i.id, { ...i }])),
    seq: 1,
  };

  const repo = {
    state,
    async isGymOwner(userId, gymId) {
      return state.owners.has(`${userId}:${gymId}`);
    },
    async getActiveStaff(userId, gymId) {
      const staff = state.staff.get(`${userId}:${gymId}`);
      return staff?.is_active ? staff : null;
    },
    async staffHasAnyPermission(staffId, permissionKeys) {
      const permissions = state.staffPermissions.get(staffId) || [];
      return permissions.some(p => permissionKeys.includes(p));
    },
    async findExistingUserByIdentity(identity) {
      const phoneUserId = identity.phone ? state.phoneToUser.get(identity.phone) : null;
      const emailUserId = identity.email ? state.emailToUser.get(identity.email) : null;
      if (phoneUserId && emailUserId && phoneUserId !== emailUserId) {
        return { conflict: true, phoneUserId, emailUserId };
      }
      const userId = phoneUserId || emailUserId;
      return { conflict: false, user: userId ? state.users.get(userId) : null };
    },
    async getUserProfile(userId) {
      return state.users.get(userId) || null;
    },
    async updateUserProfile(userId, updates) {
      Object.assign(state.users.get(userId), updates);
    },
    async findMembership(gymId, userId) {
      return [...state.memberships.values()].find(m => m.gym_id === gymId && m.user_id === userId) || null;
    },
    async createMembership(payload) {
      const active = [...state.memberships.values()].find(m => m.gym_id === payload.gym_id && m.user_id === payload.user_id && m.status === 'active');
      if (active) return active;
      const id = `mem${state.seq++}`;
      const row = { id, ...payload };
      state.memberships.set(id, row);
      return row;
    },
    async updateMembership(membershipId, payload) {
      const current = state.memberships.get(membershipId);
      Object.assign(current, payload);
      return current;
    },
    async reactivateMembership(membershipId, payload) {
      return this.updateMembership(membershipId, payload);
    },
    async findOpenImportedMember(gymId, identity, gymMemberCode) {
      return [...state.imported.values()].find(row =>
        row.gym_id === gymId &&
        ['unclaimed', 'claiming'].includes(row.status) &&
        ((identity.phone && row.normalized_phone === identity.phone) ||
          (identity.email && row.normalized_email === identity.email) ||
          (gymMemberCode && row.gym_member_code === gymMemberCode))
      ) || null;
    },
    async createImportedMember(payload) {
      const existing = await this.findOpenImportedMember(payload.gym_id, {
        phone: payload.normalized_phone,
        email: payload.normalized_email,
      }, payload.gym_member_code);
      if (existing) return existing;
      const id = `imp${state.seq++}`;
      const row = { id, ...payload };
      state.imported.set(id, row);
      return row;
    },
    async findClaimableImportedMembers(identity) {
      return [...state.imported.values()].filter(row =>
        row.status === 'unclaimed' &&
        ((identity.phone && row.normalized_phone === identity.phone) ||
          (identity.email && row.normalized_email === identity.email))
      );
    },
    async markImportedMemberClaimed(importedMemberId, userId, membershipId) {
      Object.assign(state.imported.get(importedMemberId), {
        status: 'claimed',
        claimed_user_id: userId,
        claimed_membership_id: membershipId,
      });
    },
  };

  return repo;
}

const ownerRequest = (repo, rows, gymId = 'gym1') => importMembers(repo, {
  actorUserId: 'owner',
  gymId,
  rows,
});

describe('member import identity matching', () => {
  test('existing user matched by normalized phone', async () => {
    const repo = makeRepo({
      users: [{ id: 'u1', full_name: 'Real User', phone: '9876543210' }],
      phoneToUser: [['9876543210', 'u1']],
    });
    const result = await ownerRequest(repo, [{ full_name: 'Imported Name', phone: '+91 98765 43210', membership_plan: 'monthly' }]);
    assert.equal(result.results[0].status, RESULT_STATUS.LINKED_EXISTING_USER);
    assert.equal([...repo.state.memberships.values()][0].user_id, 'u1');
  });

  test('existing user matched by normalized email', async () => {
    const repo = makeRepo({
      users: [{ id: 'u1', full_name: 'Email User' }],
      emailToUser: [['person@example.com', 'u1']],
    });
    const result = await ownerRequest(repo, [{ full_name: 'Person', email: ' PERSON@Example.COM ', membership_plan: 'annual' }]);
    assert.equal(result.results[0].status, RESULT_STATUS.LINKED_EXISTING_USER);
    assert.equal([...repo.state.memberships.values()][0].user_id, 'u1');
  });

  test('linked existing user gets safe membership defaults when dates and fee are omitted', async () => {
    const repo = makeRepo({
      users: [{ id: 'u1', full_name: 'Default User' }],
      emailToUser: [['default@example.com', 'u1']],
    });
    await ownerRequest(repo, [{ full_name: 'Default User', email: 'default@example.com', membership_plan: 'quarterly' }]);
    const membership = [...repo.state.memberships.values()][0];
    assert.equal(membership.monthly_fee, 0);
    assert.match(membership.start_date, /^\d{4}-\d{2}-\d{2}$/);
    assert.match(membership.end_date, /^\d{4}-\d{2}-\d{2}$/);
  });

  test('same name without matching credentials does not merge', async () => {
    const repo = makeRepo({ users: [{ id: 'u1', full_name: 'Same Name', phone: '9876543210' }] });
    const result = await ownerRequest(repo, [{ full_name: 'Same Name', phone: '9123456789' }]);
    assert.equal(result.results[0].status, RESULT_STATUS.CREATED_UNCLAIMED_MEMBER);
    assert.equal(repo.state.memberships.size, 0);
  });

  test('phone and email matching different users returns identity_conflict', async () => {
    const repo = makeRepo({
      users: [{ id: 'phoneUser' }, { id: 'emailUser' }],
      phoneToUser: [['9876543210', 'phoneUser']],
      emailToUser: [['person@example.com', 'emailUser']],
    });
    const result = await ownerRequest(repo, [{ full_name: 'Conflict', phone: '9876543210', email: 'person@example.com' }]);
    assert.equal(result.results[0].status, RESULT_STATUS.IDENTITY_CONFLICT);
    assert.equal(repo.state.memberships.size, 0);
  });
});

describe('member import profile and membership handling', () => {
  test('user profile data is not overwritten by owner data', async () => {
    const repo = makeRepo({
      users: [{ id: 'u1', full_name: 'Real Name', phone: '9876543210', gender: 'female', goal: 'fat_loss' }],
      phoneToUser: [['9876543210', 'u1']],
    });
    await ownerRequest(repo, [{ full_name: 'Owner Name', phone: '9876543210', gender: 'male', goal: 'bulk' }]);
    assert.equal(repo.state.users.get('u1').full_name, 'Real Name');
    assert.equal(repo.state.users.get('u1').gender, 'female');
    assert.equal(repo.state.users.get('u1').goal, 'fat_loss');
  });

  test('empty safe profile field may be filled where permitted', async () => {
    const repo = makeRepo({
      users: [{ id: 'u1', full_name: 'Real Name', phone: '9876543210', gender: null }],
      phoneToUser: [['9876543210', 'u1']],
    });
    await ownerRequest(repo, [{ full_name: 'Owner Name', phone: '9876543210', gender: 'male' }]);
    assert.equal(repo.state.users.get('u1').gender, 'male');
  });

  test('verified phone/email is never overwritten', async () => {
    const repo = makeRepo({
      users: [{ id: 'u1', full_name: 'Real Name', phone: '9876543210' }],
      phoneToUser: [['9876543210', 'u1']],
      emailToUser: [['real@example.com', 'u1']],
    });
    await ownerRequest(repo, [{ full_name: 'Owner Name', phone: '9876543210', email: 'real@example.com' }]);
    assert.equal(repo.state.users.get('u1').phone, '9876543210');
    assert.equal(Object.hasOwn(repo.state.users.get('u1'), 'email'), false);
  });

  test('unknown person becomes an unclaimed imported member', async () => {
    const repo = makeRepo();
    const result = await ownerRequest(repo, [{ full_name: 'New Person', phone: '09876543210', membership_plan: 'quarterly' }]);
    assert.equal(result.results[0].status, RESULT_STATUS.CREATED_UNCLAIMED_MEMBER);
    assert.equal(repo.state.imported.size, 1);
    assert.equal([...repo.state.imported.values()][0].normalized_phone, '9876543210');
  });

  test('existing active gym member is not duplicated', async () => {
    const repo = makeRepo({
      users: [{ id: 'u1', full_name: 'Real User', phone: '9876543210' }],
      phoneToUser: [['9876543210', 'u1']],
      memberships: [{ id: 'existingMem', gym_id: 'gym1', user_id: 'u1', status: 'active', membership_type: 'monthly' }],
    });
    const result = await ownerRequest(repo, [{ full_name: 'Real User', phone: '9876543210', membership_plan: 'annual' }]);
    assert.equal(result.results[0].status, RESULT_STATUS.UPDATED_EXISTING_MEMBERSHIP);
    assert.equal(repo.state.memberships.size, 1);
    assert.equal(repo.state.memberships.get('existingMem').membership_type, 'annual');
  });

  test('repeating the same import is idempotent', async () => {
    const repo = makeRepo();
    await ownerRequest(repo, [{ full_name: 'New Person', phone: '9876543210', gym_member_code: 'A1' }]);
    const second = await ownerRequest(repo, [{ full_name: 'New Person', phone: '+919876543210', gym_member_code: 'A1' }]);
    assert.equal(second.results[0].status, RESULT_STATUS.DUPLICATE_SKIPPED);
    assert.equal(repo.state.imported.size, 1);
  });

  test('invalid phone/email rows return validation_error without stopping batch', async () => {
    const repo = makeRepo();
    const result = await ownerRequest(repo, [
      { full_name: 'Bad', phone: '12345', email: 'not-email' },
      { full_name: 'Good', phone: '9876543210' },
    ]);
    assert.equal(result.results[0].status, RESULT_STATUS.VALIDATION_ERROR);
    assert.equal(result.results[1].status, RESULT_STATUS.CREATED_UNCLAIMED_MEMBER);
  });
});

describe('member import row limit', () => {
  test('rejects a batch larger than MAX_IMPORT_ROWS without processing any row', async () => {
    const repo = makeRepo();
    const rows = Array.from({ length: MAX_IMPORT_ROWS + 1 }, (_, i) => ({ full_name: `Person ${i}`, phone: '9876543210' }));
    const result = await ownerRequest(repo, rows);
    assert.match(result.error, new RegExp(`${MAX_IMPORT_ROWS}`));
    assert.equal(result.results.length, 0);
    assert.equal(repo.state.imported.size, 0);
  });

  test('accepts a batch exactly at MAX_IMPORT_ROWS', async () => {
    const repo = makeRepo();
    const rows = Array.from({ length: MAX_IMPORT_ROWS }, (_, i) => ({ full_name: `Person ${i}`, phone: `9${String(i).padStart(9, '0')}` }));
    const result = await ownerRequest(repo, rows);
    assert.equal(result.error, undefined);
    assert.equal(result.results.length, MAX_IMPORT_ROWS);
  });
});

describe('member import authorization', () => {
  test('unauthorized owner cannot import into another gym', async () => {
    const repo = makeRepo({ owners: [] });
    const result = await ownerRequest(repo, [{ full_name: 'Person', phone: '9876543210' }]);
    assert.equal(result.results[0].status, RESULT_STATUS.AUTHORIZATION_ERROR);
  });

  test('inactive/stale relationship does not grant access', async () => {
    const repo = makeRepo({
      owners: [],
      staff: [['owner:gym1', { id: 'staff1', is_active: false }]],
      staffPermissions: [['staff1', ['view_members']]],
    });
    const result = await ownerRequest(repo, [{ full_name: 'Person', phone: '9876543210' }]);
    assert.equal(result.results[0].status, RESULT_STATUS.AUTHORIZATION_ERROR);
  });

  test('active staff with read-only view_members cannot import', async () => {
    const repo = makeRepo({
      owners: [],
      staff: [['staffUser:gym1', { id: 'staff1', is_active: true }]],
      staffPermissions: [['staff1', ['view_members']]],
    });
    const result = await importMembers(repo, {
      actorUserId: 'staffUser',
      gymId: 'gym1',
      rows: [{ full_name: 'Person', phone: '9876543210' }],
    });
    assert.equal(result.results[0].status, RESULT_STATUS.AUTHORIZATION_ERROR);
  });

  test('active staff with manage_members can import', async () => {
    const repo = makeRepo({
      owners: [],
      staff: [['staffUser:gym1', { id: 'staff1', is_active: true }]],
      staffPermissions: [['staff1', ['manage_members']]],
    });
    const result = await importMembers(repo, {
      actorUserId: 'staffUser',
      gymId: 'gym1',
      rows: [{ full_name: 'Person', phone: '9876543210' }],
    });
    assert.equal(result.results[0].status, RESULT_STATUS.CREATED_UNCLAIMED_MEMBER);
  });
});

describe('member import claiming', () => {
  test('later authenticated matching user claims that membership', async () => {
    const repo = makeRepo({
      users: [{ id: 'u1', full_name: 'Real User', phone: '9876543210' }],
      imported: [{
        id: 'imp1',
        gym_id: 'gym1',
        normalized_phone: '9876543210',
        status: 'unclaimed',
        imported_profile: { full_name: 'Imported Name', phone: '9876543210' },
        membership_type: 'monthly',
        membership_status: 'active',
      }],
    });
    const result = await claimPendingMemberships(repo, {
      authUser: { id: 'u1', phone: '+919876543210', phone_confirmed_at: '2026-01-01T00:00:00Z' },
    });
    assert.equal(result.claimed, 1);
    assert.equal(repo.state.imported.get('imp1').status, 'claimed');
    assert.equal([...repo.state.memberships.values()][0].user_id, 'u1');
  });

  test('claim preserves gym membership dates and plan', async () => {
    const repo = makeRepo({
      users: [{ id: 'u1', full_name: 'Real User' }],
      imported: [{
        id: 'imp1',
        gym_id: 'gym1',
        normalized_email: 'real@example.com',
        status: 'unclaimed',
        imported_profile: { full_name: 'Imported Name' },
        membership_type: 'annual',
        start_date: '2026-07-01',
        end_date: '2027-07-01',
        membership_status: 'active',
      }],
    });
    await claimPendingMemberships(repo, {
      authUser: { id: 'u1', email: 'real@example.com', email_confirmed_at: '2026-01-01T00:00:00Z' },
    });
    const membership = [...repo.state.memberships.values()][0];
    assert.equal(membership.membership_type, 'annual');
    assert.equal(membership.start_date, '2026-07-01');
    assert.equal(membership.end_date, '2027-07-01');
  });

  test('repeating the claim is idempotent', async () => {
    const repo = makeRepo({
      users: [{ id: 'u1', full_name: 'Real User' }],
      imported: [{
        id: 'imp1',
        gym_id: 'gym1',
        normalized_email: 'real@example.com',
        status: 'unclaimed',
        imported_profile: { full_name: 'Imported Name' },
        membership_type: 'monthly',
        membership_status: 'active',
      }],
    });
    await claimPendingMemberships(repo, {
      authUser: { id: 'u1', email: 'real@example.com', email_confirmed_at: '2026-01-01T00:00:00Z' },
    });
    const second = await claimPendingMemberships(repo, {
      authUser: { id: 'u1', email: 'real@example.com', email_confirmed_at: '2026-01-01T00:00:00Z' },
    });
    assert.equal(second.claimed, 0);
    assert.equal(repo.state.memberships.size, 1);
  });

  test('claim only uses verified current user credentials', async () => {
    const repo = makeRepo({
      users: [{ id: 'u1', full_name: 'Real User' }],
      imported: [{
        id: 'imp1',
        gym_id: 'gym1',
        normalized_email: 'real@example.com',
        status: 'unclaimed',
        imported_profile: { full_name: 'Imported Name' },
        membership_type: 'monthly',
        membership_status: 'active',
      }],
    });
    const result = await claimPendingMemberships(repo, {
      authUser: { id: 'u1', email: 'real@example.com' },
    });
    assert.equal(result.claimed, 0);
    assert.equal(repo.state.memberships.size, 0);
  });
});
