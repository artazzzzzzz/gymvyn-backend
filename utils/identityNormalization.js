'use strict';

function normalizeEmail(value) {
  if (value == null) return null;
  const email = String(value).trim().toLowerCase();
  if (!email) return null;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null;
  return email;
}

function normalizeIndianPhone(value) {
  if (value == null) return null;
  let digits = String(value).replace(/\D/g, '');
  if (!digits) return null;

  if (digits.length === 11 && digits.startsWith('0')) {
    digits = digits.slice(1);
  } else if (digits.length === 12 && digits.startsWith('91')) {
    digits = digits.slice(2);
  }

  if (!/^[6-9]\d{9}$/.test(digits)) return null;
  return digits;
}

function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || ''));
}

module.exports = {
  normalizeEmail,
  normalizeIndianPhone,
  isUuid,
};
