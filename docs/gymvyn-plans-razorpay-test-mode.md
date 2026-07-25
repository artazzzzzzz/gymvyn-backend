# Gymvyn Plans Razorpay test mode

Gymvyn Plans payment orders are disabled unless this exact environment value is set:

```env
PLANS_PAYMENTS_ENABLED=true
```

For Razorpay **test mode only**, configure these server-only values:

```env
RAZORPAY_KEY_ID=rzp_test_your_key_id
RAZORPAY_KEY_SECRET=your_test_key_secret
```

`RAZORPAY_KEY_SECRET` must remain backend-only. It is never returned by the API.

Reserve this value for the future webhook phase; it is not used yet:

```env
RAZORPAY_WEBHOOK_SECRET=your_future_webhook_secret
```

When payments are disabled or unset, `POST /api/plans/purchases` only creates a
`payment_pending` record. When enabled, it also creates a Razorpay test-mode
order and stores the returned order ID. This phase does not open checkout,
verify payments, mark purchases paid or delivered, or assign plans.
