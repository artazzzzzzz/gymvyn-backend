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

test('Gymvyn Plans Razorpay order helpers use minor units and expose no secret', async () => {
  const received = [];
  const order = await _private.createRazorpayOrder({
    purchaseId: '12345678-1234-1234-1234-123456789012', amountMinor: 2000, currency: 'INR',
    razorpay: { orders: { create: async (payload) => { received.push(payload); return { id: 'order_test_123' }; } } },
  });
  assert.equal(order.id, 'order_test_123');
  assert.deepEqual(received[0], {
    amount: 2000, currency: 'INR', receipt: 'plans_12345678123412341234123456789012',
    notes: { plans_purchase_id: '12345678-1234-1234-1234-123456789012' },
  });
  await _private.createRazorpayOrder({
    purchaseId: '87654321-4321-4321-4321-210987654321', amountMinor: 100, currency: 'USD',
    razorpay: { orders: { create: async (payload) => { received.push(payload); return { id: 'order_test_456' }; } } },
  });
  assert.equal(received[1].amount, 100);
  assert.equal(received[1].currency, 'USD');
  assert.equal(_private.plansPaymentsEnabled({}), false);
  assert.equal(_private.plansPaymentsEnabled({ PLANS_PAYMENTS_ENABLED: 'true' }), true);
  assert.throws(() => _private.razorpaySettings({ RAZORPAY_KEY_ID: 'rzp_test_key' }), /incomplete/);
  const response = _private.paymentOrderResponse({ id: 'purchase-id', status: 'payment_pending', final_price_minor: 2000, currency: 'INR', provider_order_id: 'order_test_123' }, 'rzp_test_public');
  assert.deepEqual(response, { purchase_id: 'purchase-id', status: 'payment_pending', amount: 2000, currency: 'INR', provider: 'razorpay', provider_order_id: 'order_test_123', razorpay_key_id: 'rzp_test_public' });
  assert.doesNotMatch(JSON.stringify(response), /secret/i);
});

test('Gymvyn Plans Razorpay persistence stores an order or marks only the purchase failed', async () => {
  const calls = [];
  const successfulDatabase = {
    from: () => ({ update: (values) => ({ eq: (_column, id) => ({ select: () => ({ single: async () => {
      calls.push({ values, id });
      return { data: { id, status: 'payment_pending', currency: 'USD', final_price_minor: 100, provider_order_id: values.provider_order_id }, error: null };
    } }) }) }) }),
  };
  const stored = await _private.storeProviderOrder(successfulDatabase, 'purchase-id', 'order_test_123');
  assert.equal(stored.provider_order_id, 'order_test_123');
  assert.equal(calls[0].id, 'purchase-id');
  assert.equal(calls[0].values.provider_order_id, 'order_test_123');
  assert.ok(calls[0].values.updated_at);

  const failedCalls = [];
  const failingDatabase = {
    from: () => ({ update: (values) => ({ eq: (_column, id) => { failedCalls.push({ values, id }); return { error: null }; } }) }),
  };
  await _private.failPendingPurchase(failingDatabase, 'purchase-id');
  assert.deepEqual(failedCalls[0].values.status, 'failed');
  assert.equal(failedCalls[0].id, 'purchase-id');
  assert.equal(failedCalls[0].values.workout_assigned_plan_id, undefined);
  assert.equal(failedCalls[0].values.diet_assigned_plan_id, undefined);
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
