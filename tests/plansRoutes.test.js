'use strict';

require('dotenv').config();
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { _private } = require('../routes/plansRoutes');

test('Gymvyn Plans slug generation is stable and URL-safe', () => {
  assert.equal(_private.slugify('  Beginner: Strength & Mobility!  '), 'beginner-strength-mobility');
  assert.equal(_private.slugify('Élite Plan'), 'elite-plan');
  assert.equal(_private.slugify('---'), '');
});

test('Gymvyn Plans listing validation accepts both required non-free currency prices', () => {
  const result = _private.listingInput({
    templateType: 'workout', templateId: 'template-id', title: 'Starter Strength',
    description: 'A plan', priceInrPaise: 2000, priceUsdCents: 100,
  });
  assert.equal(result.error, undefined);
  assert.deepEqual(result.value, {
    templateType: 'workout', templateId: 'template-id', title: 'Starter Strength',
    description: 'A plan', inr: 2000, usd: 100,
  });
  assert.equal(_private.COMMISSION_BPS, 500);
});

test('Gymvyn Plans listing validation rejects free, below-minimum, and invalid prices', () => {
  const base = { templateType: 'diet', templateId: 'template-id', title: 'Meal Plan', priceInrPaise: 2000, priceUsdCents: 100 };
  assert.match(_private.listingInput({ ...base, priceInrPaise: 0 }).error, /price_inr_paise/);
  assert.match(_private.listingInput({ ...base, priceInrPaise: 1999 }).error, /price_inr_paise/);
  assert.match(_private.listingInput({ ...base, priceUsdCents: 99 }).error, /price_usd_cents/);
  assert.match(_private.listingInput({ ...base, priceUsdCents: 100.5 }).error, /price_usd_cents/);
});

test('Gymvyn Plans listing validation permits only workout or diet templates', () => {
  const result = _private.listingInput({ templateType: 'bundle', templateId: 'template-id', title: 'Bundle', priceInrPaise: 2000, priceUsdCents: 100 });
  assert.match(result.error, /workout or diet/);
});

test('Gymvyn Plans purchase validation accepts only a listing and INR or USD', () => {
  assert.deepEqual(_private.purchaseInput({ listingId: 'listing-id', currency: 'inr' }).value, { listingId: 'listing-id', currency: 'INR' });
  assert.match(_private.purchaseInput({ currency: 'INR' }).error, /listing_id/);
  assert.match(_private.purchaseInput({ listingId: 'listing-id', currency: 'EUR' }).error, /currency/);
  assert.equal(_private.commissionMinor(2000, 500), 100);
  assert.equal(_private.commissionMinor(100, 500), 5);
});

test('Gymvyn Plans exposes the required public, trainer, buyer, review, and guarded admin paths', () => {
  const router = require('../routes/plansRoutes');
  const paths = router.stack
    .filter((layer) => layer.route)
    .map((layer) => `${Object.keys(layer.route.methods).find((method) => layer.route.methods[method]).toUpperCase()} ${layer.route.path}`);
  for (const expected of [
    'GET /listings', 'GET /listings/:slug', 'GET /trainer/listings', 'GET /trainer/templates',
    'POST /trainer/listings', 'PATCH /trainer/listings/:id',
    'POST /trainer/listings/:id/publish', 'POST /trainer/listings/:id/unpublish',
    'POST /purchases', 'GET /purchases/:id', 'GET /my-purchases', 'GET /listings/:id/reviews',
    'POST /purchases/:purchaseId/review', 'POST /admin/listings/:id/suspend',
    'POST /admin/listings/:id/remove',
  ]) assert.ok(paths.includes(expected), `missing ${expected}`);
});

test('Gymvyn Plans public listing response fields exclude internal ownership and moderation data', () => {
  for (const forbidden of ['trainer_id', 'commission_bps', 'status', 'moderation_reason', 'template_id']) {
    assert.equal(_private.PUBLIC_FIELDS.includes(forbidden), false, `${forbidden} must stay private`);
  }
});
