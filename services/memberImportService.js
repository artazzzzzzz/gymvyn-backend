'use strict';

const crypto = require('crypto');
const { normalizeEmail, normalizeIndianPhone, isUuid } = require('../utils/identityNormalization');

const RESULT_STATUS = {
  LINKED_EXISTING_USER: 'linked_existing_user',
  CREATED_UNCLAIMED_MEMBER: 'created_unclaimed_member',
  UPDATED_EXISTING_MEMBERSHIP: 'updated_existing_membership',
  DUPLICATE_SKIPPED: 'duplicate_skipped',
  VALIDATION_ERROR: 'validation_error',
  IDENTITY_CONFLICT: 'identity_conflict',
  AUTHORIZATION_ERROR: 'authorization_error',
};

const IMPORT_ALLOWED_STAFF_PERMISSIONS = ['manage_members'];
const MAX_IMPORT_ROWS = 500;

const MEMBERSHIP_DURATION_DAYS = {
  monthly: 30,
  quarterly: 90,
  half_yearly: 180,
  annual: 365,
};

function firstValue(row, keys) {
  for (const key of keys) {
    if (row[key] !== undefined && row[key] !== null && String(row[key]).trim() !== '') return row[key];
  }
  return null;
}

function cleanString(value, maxLength = 500) {
  if (value == null) return null;
  const cleaned = String(value).trim();
  return cleaned ? cleaned.slice(0, maxLength) : null;
}

function cleanDate(value) {
  if (value == null || String(value).trim() === '') return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return { error: 'Invalid date' };
  return date.toISOString().slice(0, 10);
}

function cleanNumber(value) {
  if (value == null || String(value).trim() === '') return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : { error: 'Invalid number' };
}

function normalizeTags(value) {
  if (Array.isArray(value)) {
    return value.map(v => cleanString(v, 80)).filter(Boolean).slice(0, 25);
  }
  const str = cleanString(value, 1000);
  if (!str) return [];
  return str.split(',').map(v => cleanString(v, 80)).filter(Boolean).slice(0, 25);
}

function normalizeImportRow(row) {
  const fullName = cleanString(firstValue(row, ['full_name', 'fullName', 'name']), 160);
  const rawPhone = firstValue(row, ['phone', 'phone_number', 'mobile', 'mobile_number']);
  const rawEmail = firstValue(row, ['email', 'email_address']);
  const normalizedPhone = normalizeIndianPhone(rawPhone);
  const normalizedEmail = normalizeEmail(rawEmail);

  const startDate = cleanDate(firstValue(row, ['membership_start_date', 'start_date', 'startDate']));
  const endDate = cleanDate(firstValue(row, ['membership_expiry_date', 'membership_end_date', 'end_date', 'endDate', 'expiry_date']));
  const monthlyFee = cleanNumber(firstValue(row, ['monthly_fee', 'monthlyFee', 'fee', 'amount']));
  const height = cleanNumber(firstValue(row, ['height', 'height_cm']));
  const weight = cleanNumber(firstValue(row, ['weight', 'current_weight', 'weight_kg']));

  const errors = [];
  if (!fullName && !normalizedPhone && !normalizedEmail) errors.push('Provide at least a name plus phone/email, or a phone/email.');
  if (rawPhone && !normalizedPhone) errors.push('Phone is not a valid Indian mobile number.');
  if (rawEmail && !normalizedEmail) errors.push('Email is not valid.');
  if (startDate?.error) errors.push('Membership start date is invalid.');
  if (endDate?.error) errors.push('Membership expiry date is invalid.');
  if (monthlyFee?.error) errors.push('Fee amount is invalid.');
  if (typeof monthlyFee === 'number' && monthlyFee < 0) errors.push('Fee amount must not be negative.');
  if (height?.error) errors.push('Height is invalid.');
  if (weight?.error) errors.push('Weight is invalid.');

  const assignedTrainerId = cleanString(firstValue(row, ['assigned_trainer_id', 'assignedTrainerId']), 80);
  if (assignedTrainerId && !isUuid(assignedTrainerId)) errors.push('Assigned trainer id is invalid.');

  return {
    errors,
    source: row,
    identity: {
      phone: normalizedPhone,
      email: normalizedEmail,
      raw_phone: rawPhone ? cleanString(rawPhone, 80) : null,
      raw_email: rawEmail ? cleanString(rawEmail, 160) : null,
    },
    profile: {
      full_name: fullName,
      phone: normalizedPhone,
      gender: cleanString(firstValue(row, ['gender']), 40),
      height: height?.error ? null : height,
      current_weight: weight?.error ? null : weight,
      goal: cleanString(firstValue(row, ['personal_fitness_goal', 'goal', 'fitness_goal']), 160),
      profile_photo: cleanString(firstValue(row, ['profile_photo', 'profile_photo_url', 'photo_url']), 500),
      date_of_birth: cleanString(firstValue(row, ['date_of_birth', 'dob']), 40),
    },
    membership: {
      membership_type: cleanString(firstValue(row, ['membership_type', 'membership_plan', 'plan_name', 'package']), 120),
      monthly_fee: monthlyFee?.error ? null : monthlyFee,
      start_date: startDate?.error ? null : startDate,
      end_date: endDate?.error ? null : endDate,
      payment_status: cleanString(firstValue(row, ['payment_status', 'fee_status']), 80),
      gym_member_code: cleanString(firstValue(row, ['gym_member_code', 'member_code']), 80),
      notes: cleanString(firstValue(row, ['notes', 'gym_notes', 'gym_specific_notes']), 1000),
      assigned_trainer_id: assignedTrainerId || null,
      membership_status: cleanString(firstValue(row, ['membership_status', 'status']), 40) || 'active',
      tags: normalizeTags(firstValue(row, ['tags', 'gym_tags'])),
    },
  };
}

function isVerifiedEmail(authUser) {
  return !!(authUser?.email && (authUser.email_confirmed_at || authUser.confirmed_at));
}

function isVerifiedPhone(authUser) {
  return !!(authUser?.phone && (authUser.phone_confirmed_at || authUser.confirmed_at));
}

function membershipMetadata(normalizedRow, extra = {}) {
  return {
    ...(extra || {}),
    source: extra.source || 'owner_member_import',
    imported_general_profile: normalizedRow.profile,
    imported_identity: normalizedRow.identity,
    payment_status: normalizedRow.membership.payment_status,
    gym_member_code: normalizedRow.membership.gym_member_code,
    tags: normalizedRow.membership.tags,
  };
}

function resolveMembershipDates(normalizedRow) {
  const startDate = normalizedRow.membership.start_date || new Date().toISOString().slice(0, 10);
  if (normalizedRow.membership.end_date) return { startDate, endDate: normalizedRow.membership.end_date };

  const duration = MEMBERSHIP_DURATION_DAYS[normalizedRow.membership.membership_type] || 30;
  const end = new Date(`${startDate}T00:00:00.000Z`);
  end.setUTCDate(end.getUTCDate() + duration);
  return { startDate, endDate: end.toISOString().slice(0, 10) };
}

function buildMembershipPayload(gymId, userId, normalizedRow, importedMemberId = null) {
  const { startDate, endDate } = resolveMembershipDates(normalizedRow);
  return {
    gym_id: gymId,
    user_id: userId,
    membership_type: normalizedRow.membership.membership_type || 'imported',
    monthly_fee: normalizedRow.membership.monthly_fee ?? 0,
    start_date: startDate,
    end_date: endDate,
    status: normalizedRow.membership.membership_status || 'active',
    assigned_trainer_id: normalizedRow.membership.assigned_trainer_id,
    notes: normalizedRow.membership.notes,
    imported_member_id: importedMemberId,
    metadata: membershipMetadata(normalizedRow),
  };
}

function safeProfileUpdates(existingUser, normalizedRow) {
  const updates = {};
  for (const key of ['full_name', 'phone', 'gender', 'height', 'current_weight', 'goal']) {
    if ((existingUser?.[key] === null || existingUser?.[key] === undefined || existingUser?.[key] === '') && normalizedRow.profile[key] !== null && normalizedRow.profile[key] !== undefined && normalizedRow.profile[key] !== '') {
      updates[key] = normalizedRow.profile[key];
    }
  }
  return updates;
}

function rowFingerprint(gymId, normalizedRow) {
  return crypto
    .createHash('sha256')
    .update(JSON.stringify({
      gym_id: gymId,
      phone: normalizedRow.identity.phone,
      email: normalizedRow.identity.email,
      name: normalizedRow.profile.full_name,
      code: normalizedRow.membership.gym_member_code,
    }))
    .digest('hex');
}

function makeSummary(totalRows) {
  return {
    total_rows: totalRows,
    successful_rows: 0,
    existing_users_linked: 0,
    unclaimed_members_created: 0,
    existing_memberships_updated: 0,
    duplicates_skipped: 0,
    conflicts: 0,
    invalid_rows: 0,
  };
}

function addSummary(summary, status) {
  if ([RESULT_STATUS.LINKED_EXISTING_USER, RESULT_STATUS.CREATED_UNCLAIMED_MEMBER, RESULT_STATUS.UPDATED_EXISTING_MEMBERSHIP, RESULT_STATUS.DUPLICATE_SKIPPED].includes(status)) {
    summary.successful_rows += 1;
  }
  if (status === RESULT_STATUS.LINKED_EXISTING_USER) summary.existing_users_linked += 1;
  if (status === RESULT_STATUS.CREATED_UNCLAIMED_MEMBER) summary.unclaimed_members_created += 1;
  if (status === RESULT_STATUS.UPDATED_EXISTING_MEMBERSHIP) summary.existing_memberships_updated += 1;
  if (status === RESULT_STATUS.DUPLICATE_SKIPPED) summary.duplicates_skipped += 1;
  if (status === RESULT_STATUS.IDENTITY_CONFLICT) summary.conflicts += 1;
  if (status === RESULT_STATUS.VALIDATION_ERROR) summary.invalid_rows += 1;
}

async function requireImportAccess(repo, actorUserId, gymId) {
  const isOwner = await repo.isGymOwner(actorUserId, gymId);
  if (isOwner) return { ok: true, role: 'owner' };

  const staff = await repo.getActiveStaff(actorUserId, gymId);
  if (!staff) return { ok: false };

  const hasPermission = await repo.staffHasAnyPermission(staff.id, IMPORT_ALLOWED_STAFF_PERMISSIONS);
  return hasPermission ? { ok: true, role: 'staff' } : { ok: false };
}

async function importMembers(repo, { actorUserId, gymId, rows }) {
  const summary = makeSummary(Array.isArray(rows) ? rows.length : 0);
  if (!Array.isArray(rows) || rows.length === 0) {
    return { summary, results: [{ row: 0, status: RESULT_STATUS.VALIDATION_ERROR, message: 'members must be a non-empty array' }] };
  }
  if (rows.length > MAX_IMPORT_ROWS) {
    return {
      summary,
      error: `Cannot import more than ${MAX_IMPORT_ROWS} rows in a single request (received ${rows.length}).`,
      results: [],
    };
  }

  const access = await requireImportAccess(repo, actorUserId, gymId);
  if (!access.ok) {
    return {
      summary,
      results: rows.map((_, index) => ({
        row: index + 1,
        status: RESULT_STATUS.AUTHORIZATION_ERROR,
        message: 'You are not allowed to import members for this gym.',
      })),
    };
  }

  const results = [];
  for (let index = 0; index < rows.length; index++) {
    const rowNumber = index + 1;
    const normalizedRow = normalizeImportRow(rows[index] || {});
    if (normalizedRow.errors.length > 0) {
      const status = RESULT_STATUS.VALIDATION_ERROR;
      addSummary(summary, status);
      results.push({ row: rowNumber, status, message: normalizedRow.errors.join(' ') });
      continue;
    }

    const match = await repo.findExistingUserByIdentity(normalizedRow.identity);
    if (match.conflict) {
      const status = RESULT_STATUS.IDENTITY_CONFLICT;
      addSummary(summary, status);
      results.push({
        row: rowNumber,
        status,
        message: 'Phone and email match different Gymvyn users. Review manually.',
        conflict: { phone_user_id: match.phoneUserId, email_user_id: match.emailUserId },
      });
      continue;
    }

    if (match.user) {
      const existingMembership = await repo.findMembership(gymId, match.user.id);
      if (existingMembership?.status === 'active') {
        const status = RESULT_STATUS.UPDATED_EXISTING_MEMBERSHIP;
        await repo.updateMembership(existingMembership.id, buildMembershipPayload(gymId, match.user.id, normalizedRow, existingMembership.imported_member_id || null));
        const updates = safeProfileUpdates(match.user, normalizedRow);
        if (Object.keys(updates).length > 0) await repo.updateUserProfile(match.user.id, updates);
        addSummary(summary, status);
        results.push({ row: rowNumber, status, message: 'Existing active membership updated.', user_id: match.user.id, membership_id: existingMembership.id });
        continue;
      }

      const membership = existingMembership
        ? await repo.reactivateMembership(existingMembership.id, buildMembershipPayload(gymId, match.user.id, normalizedRow, existingMembership.imported_member_id || null))
        : await repo.createMembership(buildMembershipPayload(gymId, match.user.id, normalizedRow));
      const updates = safeProfileUpdates(match.user, normalizedRow);
      if (Object.keys(updates).length > 0) await repo.updateUserProfile(match.user.id, updates);
      const status = RESULT_STATUS.LINKED_EXISTING_USER;
      addSummary(summary, status);
      results.push({ row: rowNumber, status, message: 'Existing Gymvyn user linked to this gym.', user_id: match.user.id, membership_id: membership.id });
      continue;
    }

    const existingImport = await repo.findOpenImportedMember(gymId, normalizedRow.identity, normalizedRow.membership.gym_member_code);
    if (existingImport) {
      const status = RESULT_STATUS.DUPLICATE_SKIPPED;
      addSummary(summary, status);
      results.push({ row: rowNumber, status, message: 'Matching unclaimed imported member already exists.', imported_member_id: existingImport.id });
      continue;
    }

    const imported = await repo.createImportedMember({
      gym_id: gymId,
      normalized_phone: normalizedRow.identity.phone,
      normalized_email: normalizedRow.identity.email,
      raw_phone: normalizedRow.identity.raw_phone,
      raw_email: normalizedRow.identity.raw_email,
      imported_full_name: normalizedRow.profile.full_name,
      imported_profile: normalizedRow.profile,
      membership_type: normalizedRow.membership.membership_type,
      monthly_fee: normalizedRow.membership.monthly_fee,
      start_date: normalizedRow.membership.start_date,
      end_date: normalizedRow.membership.end_date,
      payment_status: normalizedRow.membership.payment_status,
      gym_member_code: normalizedRow.membership.gym_member_code,
      notes: normalizedRow.membership.notes,
      assigned_trainer_id: normalizedRow.membership.assigned_trainer_id,
      membership_status: normalizedRow.membership.membership_status || 'active',
      tags: normalizedRow.membership.tags,
      row_fingerprint: rowFingerprint(gymId, normalizedRow),
      source_payload: normalizedRow.source,
      status: 'unclaimed',
    });
    const status = RESULT_STATUS.CREATED_UNCLAIMED_MEMBER;
    addSummary(summary, status);
    results.push({ row: rowNumber, status, message: 'Unclaimed imported member created.', imported_member_id: imported.id });
  }

  return { summary, results };
}

function verifiedCurrentIdentity(authUser) {
  return {
    phone: isVerifiedPhone(authUser) ? normalizeIndianPhone(authUser.phone) : null,
    email: isVerifiedEmail(authUser) ? normalizeEmail(authUser.email) : null,
  };
}

async function claimPendingMemberships(repo, { authUser }) {
  const userId = authUser?.id;
  const identity = verifiedCurrentIdentity(authUser);
  if (!userId) throw new Error('Authenticated user is required.');
  if (!identity.phone && !identity.email) {
    return { claimed: 0, skipped: 0, results: [], message: 'No verified phone or email is available for claiming.' };
  }

  const pending = await repo.findClaimableImportedMembers(identity);
  const results = [];
  let claimed = 0;
  let skipped = 0;

  for (const imported of pending) {
    const normalizedRow = {
      profile: imported.imported_profile || { full_name: imported.imported_full_name },
      identity: {
        phone: imported.normalized_phone,
        email: imported.normalized_email,
        raw_phone: imported.raw_phone,
        raw_email: imported.raw_email,
      },
      membership: {
        membership_type: imported.membership_type,
        monthly_fee: imported.monthly_fee,
        start_date: imported.start_date,
        end_date: imported.end_date,
        payment_status: imported.payment_status,
        gym_member_code: imported.gym_member_code,
        notes: imported.notes,
        assigned_trainer_id: imported.assigned_trainer_id,
        membership_status: imported.membership_status || 'active',
        tags: imported.tags || [],
      },
    };

    const existingMembership = await repo.findMembership(imported.gym_id, userId);
    let membership;
    if (existingMembership?.status === 'active') {
      await repo.markImportedMemberClaimed(imported.id, userId, existingMembership.id);
      skipped += 1;
      results.push({
        imported_member_id: imported.id,
        status: RESULT_STATUS.DUPLICATE_SKIPPED,
        message: 'User already has an active membership for this gym.',
        membership_id: existingMembership.id,
      });
      continue;
    }

    if (existingMembership) {
      membership = await repo.reactivateMembership(existingMembership.id, buildMembershipPayload(imported.gym_id, userId, normalizedRow, imported.id));
    } else {
      membership = await repo.createMembership(buildMembershipPayload(imported.gym_id, userId, normalizedRow, imported.id));
    }

    await repo.markImportedMemberClaimed(imported.id, userId, membership.id);

    const user = await repo.getUserProfile(userId);
    const updates = safeProfileUpdates(user, normalizedRow);
    if (Object.keys(updates).length > 0) await repo.updateUserProfile(userId, updates);

    claimed += 1;
    results.push({
      imported_member_id: imported.id,
      status: RESULT_STATUS.LINKED_EXISTING_USER,
      message: 'Imported membership claimed.',
      membership_id: membership.id,
    });
  }

  return { claimed, skipped, results };
}

module.exports = {
  RESULT_STATUS,
  IMPORT_ALLOWED_STAFF_PERMISSIONS,
  MAX_IMPORT_ROWS,
  normalizeImportRow,
  importMembers,
  claimPendingMemberships,
  verifiedCurrentIdentity,
  safeProfileUpdates,
};
