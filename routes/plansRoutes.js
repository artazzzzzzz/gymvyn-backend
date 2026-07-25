const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const Razorpay = require('razorpay');
const { auth, requireTrainerRole } = require('../middleware/auth');
const { insertAssignedDays, fetchFullTemplate } = require('../src/utils/dietPlanHelpers');

const router = express.Router();
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
const COMMISSION_BPS = 500;
// trainer_id references users(id); embed only the public-safe full_name (no
// email/phone) since this is an unauthenticated public endpoint. No avatar
// or credibility-text column exists on users/trainer_profiles yet (Phase C1
// audit) -- that stays absent until a later phase adds it.
const PUBLIC_FIELDS = 'id, slug, title, description, template_type, price_inr_paise, price_usd_cents, published_at, trainer:users(full_name)';

// Gates Gymvyn Plans admin endpoints on a comma-separated email allowlist.
// Must run after `auth` (req.user is a verified Supabase auth user with a
// real .email -- see middleware/auth.js). Reads PLANS_ADMIN_EMAILS from the
// environment, e.g. PLANS_ADMIN_EMAILS="admin@gymvyn.com,ops@gymvyn.com" --
// comparison is case-insensitive. Fails closed: if the env var is unset or
// empty, every request is rejected (401/403 territory, never a silent
// allow-all), since an empty allowlist almost certainly means
// misconfiguration rather than "nobody is an admin on purpose".
function requireAdminPlans(req, res, next) {
  const raw = String(process.env.PLANS_ADMIN_EMAILS || '').trim();
  if (!raw) {
    console.warn('PLANS_ADMIN_EMAILS is not configured -- rejecting all Gymvyn Plans admin requests');
    return res.status(403).json({ error: 'Gymvyn Plans admin access is not configured' });
  }
  const allowlist = raw.split(',').map((email) => email.trim().toLowerCase()).filter(Boolean);
  const callerEmail = String(req.user?.email || '').toLowerCase();
  if (!callerEmail || !allowlist.includes(callerEmail)) return res.status(403).json({ error: 'Admin access required' });
  next();
}

function slugify(value) {
  return String(value || '').toLowerCase().trim().normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 110);
}

function listingInput(body) {
  const templateType = body?.templateType || body?.template_type;
  const templateId = body?.templateId || body?.template_id;
  const title = String(body?.title || '').trim();
  const description = String(body?.description || '').trim();
  const inr = Number(body?.priceInrPaise ?? body?.price_inr_paise);
  const usd = Number(body?.priceUsdCents ?? body?.price_usd_cents);
  if (!['workout', 'diet'].includes(templateType)) return { error: 'template_type must be workout or diet' };
  if (!templateId) return { error: 'template_id is required' };
  if (!title || title.length > 160) return { error: 'title must be 1 to 160 characters' };
  if (!Number.isInteger(inr) || inr < 2000) return { error: 'price_inr_paise must be an integer of at least 2000' };
  if (!Number.isInteger(usd) || usd < 100) return { error: 'price_usd_cents must be an integer of at least 100' };
  return { value: { templateType, templateId, title, description, inr, usd } };
}

function purchaseInput(body) {
  const listingId = String(body?.listingId ?? body?.listing_id ?? '').trim();
  const currency = String(body?.currency ?? body?.display_currency ?? '').trim().toUpperCase();
  if (!listingId) return { error: 'listing_id is required' };
  if (!['INR', 'USD'].includes(currency)) return { error: 'currency must be INR or USD' };
  return { value: { listingId, currency } };
}

function commissionMinor(amountMinor, commissionBps) {
  return Math.round((amountMinor * commissionBps) / 10000);
}

function plansPaymentsEnabled(env = process.env) {
  return env.PLANS_PAYMENTS_ENABLED === 'true';
}

function razorpaySettings(env = process.env) {
  const keyId = String(env.RAZORPAY_KEY_ID || '').trim();
  const keySecret = String(env.RAZORPAY_KEY_SECRET || '').trim();
  if (!keyId || !keySecret) throw new Error('Gymvyn Plans payment configuration is incomplete');
  return { keyId, keySecret };
}

function razorpayReceipt(purchaseId) {
  return `plans_${String(purchaseId).replace(/-/g, '')}`;
}

async function createRazorpayOrder({ purchaseId, amountMinor, currency, razorpay }) {
  return razorpay.orders.create({
    amount: amountMinor,
    currency,
    receipt: razorpayReceipt(purchaseId),
    notes: { plans_purchase_id: purchaseId },
  });
}

function paymentOrderResponse(purchase, keyId) {
  return {
    purchase_id: purchase.id,
    status: purchase.status,
    amount: purchase.final_price_minor,
    currency: purchase.currency,
    provider: 'razorpay',
    provider_order_id: purchase.provider_order_id,
    razorpay_key_id: keyId,
  };
}

async function storeProviderOrder(database, purchaseId, providerOrderId) {
  const { data, error } = await database.from('plans_purchases')
    .update({ provider_order_id: providerOrderId, updated_at: new Date().toISOString() })
    .eq('id', purchaseId)
    .select('id, status, currency, final_price_minor, provider_order_id')
    .single();
  if (error) throw error;
  return data;
}

async function failPendingPurchase(database, purchaseId) {
  const { error } = await database.from('plans_purchases')
    .update({ status: 'failed', updated_at: new Date().toISOString() })
    .eq('id', purchaseId);
  if (error) throw error;
}

async function requireActiveTrainer(userId) {
  const { data, error } = await supabase.from('trainer_profiles').select('user_id').eq('user_id', userId).eq('is_active', true).eq('status', 'active').maybeSingle();
  if (error) throw error;
  return !!data;
}

async function ownTemplate(userId, type, id) {
  const table = type === 'workout' ? 'trainer_templates' : 'diet_plan_templates';
  let query = supabase.from(table).select('*').eq('id', id).eq('trainer_id', userId);
  if (type === 'workout') query = query.eq('type', 'workout');
  const { data, error } = await query.maybeSingle();
  if (error) throw error;
  return data || null;
}

async function uniqueSlug(title, excludeId = null) {
  const base = slugify(title) || 'gymvyn-plan';
  for (let n = 1; n <= 100; n += 1) {
    const slug = n === 1 ? base : `${base}-${n}`;
    let query = supabase.from('plans_listings').select('id').eq('slug', slug).maybeSingle();
    const { data, error } = await query;
    if (error) throw error;
    if (!data || data.id === excludeId) return slug;
  }
  throw new Error('Unable to generate a unique listing slug');
}

function validHandleFormat(handle) {
  return typeof handle === 'string' && handle.length >= 3 && handle.length <= 60 && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(handle);
}

// Same numeric-suffix collision scheme as uniqueSlug, for consistency:
// "jordan-ellis" -> "jordan-ellis-2" -> "jordan-ellis-3" ... A slugified
// name under the 3-char minimum (e.g. "Al") falls back to the literal
// "trainer" base rather than a name-derived handle too short to be
// readable, and the same numeric suffix logic disambiguates from there.
async function generateHandle(fullName, excludeUserId = null) {
  const slug = slugify(fullName);
  const base = slug.length >= 3 ? slug : 'trainer';
  for (let n = 1; n <= 100; n += 1) {
    const handle = n === 1 ? base : `${base}-${n}`;
    const { data, error } = await supabase.from('trainer_profiles').select('user_id').eq('handle', handle).maybeSingle();
    if (error) throw error;
    if (!data || data.user_id === excludeUserId) return handle;
  }
  // Effectively unreachable (100 real collisions on one base), but keeps
  // this provably terminating rather than looping forever.
  return `${base}-${Math.random().toString(36).slice(2, 8)}`;
}

async function listingForTrainer(id, trainerId) {
  const { data, error } = await supabase.from('plans_listings').select('*').eq('id', id).eq('trainer_id', trainerId).maybeSingle();
  if (error) throw error;
  return data;
}

async function createVersion(listing, template) {
  const { error } = await supabase.from('plans_listing_versions').insert({
    listing_id: listing.id, template_type: listing.template_type, template_id: listing.template_id,
    template_snapshot_json: template, title_snapshot: listing.title, description_snapshot: listing.description,
    price_inr_paise: listing.price_inr_paise, price_usd_cents: listing.price_usd_cents,
    commission_bps: listing.commission_bps,
  });
  if (error) throw error;
}

// Public browse. No private trainer, moderation, or payment fields are selected.
router.get('/listings', async (req, res) => {
  try {
    const { data, error } = await supabase.from('plans_listings').select(PUBLIC_FIELDS).eq('status', 'published').order('published_at', { ascending: false });
    if (error) throw error;
    res.json(data || []);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/listings/:slug', async (req, res) => {
  try {
    const { data, error } = await supabase.from('plans_listings').select(PUBLIC_FIELDS).eq('slug', req.params.slug).eq('status', 'published').maybeSingle();
    if (error) throw error;
    if (!data) return res.status(404).json({ error: 'Listing not found' });
    res.json(data);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Public storefront: one trainer's identity + all their currently published
// listings, for the /t/[handle] page reserved back in Phase A. A handle
// that resolves to a real trainer with zero published listings 404s the
// same as an unknown handle -- there is nothing public-safe to show yet,
// and treating "no live storefront" the same as "no such handle" avoids
// confirming a seller account exists before it has anything published.
router.get('/trainers/:handle', async (req, res) => {
  try {
    const { data: profile, error: profileError } = await supabase.from('trainer_profiles')
      .select('user_id, handle, trainer:users(full_name)')
      .eq('handle', req.params.handle).eq('is_active', true).eq('status', 'active').maybeSingle();
    if (profileError) throw profileError;
    if (!profile) return res.status(404).json({ error: 'Trainer not found' });
    const { data: listings, error: listingsError } = await supabase.from('plans_listings')
      .select(PUBLIC_FIELDS).eq('trainer_id', profile.user_id).eq('status', 'published').order('published_at', { ascending: false });
    if (listingsError) throw listingsError;
    if (!listings || listings.length === 0) return res.status(404).json({ error: 'Trainer not found' });
    res.json({ handle: profile.handle, full_name: profile.trainer?.full_name || null, listings });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/trainer/handle', auth, requireTrainerRole, async (req, res) => {
  try {
    if (!(await requireActiveTrainer(req.user.id))) return res.status(403).json({ error: 'Active trainer profile required' });
    const { data, error } = await supabase.from('trainer_profiles').select('handle').eq('user_id', req.user.id).maybeSingle();
    if (error) throw error;
    res.json({ handle: data?.handle || null });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.patch('/trainer/handle', auth, requireTrainerRole, async (req, res) => {
  try {
    if (!(await requireActiveTrainer(req.user.id))) return res.status(403).json({ error: 'Active trainer profile required' });
    const handle = String(req.body?.handle || '').trim().toLowerCase();
    if (!validHandleFormat(handle)) return res.status(400).json({ error: 'handle must be 3-60 characters: lowercase letters, numbers, and single hyphens only' });
    const { data: existing, error: existingError } = await supabase.from('trainer_profiles').select('user_id').eq('handle', handle).maybeSingle();
    if (existingError) throw existingError;
    if (existing && existing.user_id !== req.user.id) return res.status(409).json({ error: 'That handle is already taken' });
    // .eq('user_id', req.user.id) is the entire ownership scope here -- there
    // is no :id param, so this can never target another trainer's row.
    const { data, error } = await supabase.from('trainer_profiles').update({ handle }).eq('user_id', req.user.id).select('handle').single();
    if (error) throw error;
    res.json(data);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/trainer/listings', auth, requireTrainerRole, async (req, res) => {
  try {
    if (!(await requireActiveTrainer(req.user.id))) return res.status(403).json({ error: 'Active trainer profile required' });
    const { data, error } = await supabase.from('plans_listings').select('*').eq('trainer_id', req.user.id).order('updated_at', { ascending: false });
    if (error) throw error;
    res.json(data || []);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Trainer-owned source templates for Gymvyn Plans seller tooling. Keep this
// deliberately small: it is only used to select a listing source template.
router.get('/trainer/templates', auth, requireTrainerRole, async (req, res) => {
  try {
    if (!(await requireActiveTrainer(req.user.id))) return res.status(403).json({ error: 'Active trainer profile required' });
    const [workoutResult, dietResult] = await Promise.all([
      supabase.from('trainer_templates').select('id, name').eq('trainer_id', req.user.id).eq('type', 'workout').order('updated_at', { ascending: false }),
      supabase.from('diet_plan_templates').select('id, name').eq('trainer_id', req.user.id).order('updated_at', { ascending: false }),
    ]);
    if (workoutResult.error) throw workoutResult.error;
    if (dietResult.error) throw dietResult.error;
    res.json({ workout: workoutResult.data || [], diet: dietResult.data || [] });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/trainer/listings', auth, requireTrainerRole, async (req, res) => {
  try {
    if (!(await requireActiveTrainer(req.user.id))) return res.status(403).json({ error: 'Active trainer profile required' });
    const parsed = listingInput(req.body);
    if (parsed.error) return res.status(400).json({ error: parsed.error });
    const input = parsed.value;
    if (!(await ownTemplate(req.user.id, input.templateType, input.templateId))) return res.status(403).json({ error: 'Referenced template is not yours or does not match template_type' });
    const slug = await uniqueSlug(input.title);
    const { data, error } = await supabase.from('plans_listings').insert({
      trainer_id: req.user.id, template_type: input.templateType, template_id: input.templateId, slug,
      title: input.title, description: input.description, price_inr_paise: input.inr, price_usd_cents: input.usd,
      commission_bps: COMMISSION_BPS,
    }).select('*').single();
    if (error) throw error;
    res.status(201).json(data);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.patch('/trainer/listings/:id', auth, requireTrainerRole, async (req, res) => {
  try {
    if (!(await requireActiveTrainer(req.user.id))) return res.status(403).json({ error: 'Active trainer profile required' });
    const current = await listingForTrainer(req.params.id, req.user.id);
    if (!current) return res.status(404).json({ error: 'Listing not found' });
    if (['suspended', 'removed'].includes(current.status)) return res.status(409).json({ error: 'Moderated listings cannot be edited' });
    const merged = { ...current, ...req.body, templateType: req.body.templateType || req.body.template_type || current.template_type, templateId: req.body.templateId || req.body.template_id || current.template_id, priceInrPaise: req.body.priceInrPaise ?? req.body.price_inr_paise ?? current.price_inr_paise, priceUsdCents: req.body.priceUsdCents ?? req.body.price_usd_cents ?? current.price_usd_cents };
    const parsed = listingInput(merged);
    if (parsed.error) return res.status(400).json({ error: parsed.error });
    const input = parsed.value;
    if (!(await ownTemplate(req.user.id, input.templateType, input.templateId))) return res.status(403).json({ error: 'Referenced template is not yours or does not match template_type' });
    const slug = await uniqueSlug(input.title, current.id);
    const { data, error } = await supabase.from('plans_listings').update({ template_type: input.templateType, template_id: input.templateId, slug, title: input.title, description: input.description, price_inr_paise: input.inr, price_usd_cents: input.usd, updated_at: new Date().toISOString() }).eq('id', current.id).select('*').single();
    if (error) throw error;
    res.json(data);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/trainer/listings/:id/publish', auth, requireTrainerRole, async (req, res) => {
  try {
    if (!(await requireActiveTrainer(req.user.id))) return res.status(403).json({ error: 'Active trainer profile required' });
    const listing = await listingForTrainer(req.params.id, req.user.id);
    if (!listing) return res.status(404).json({ error: 'Listing not found' });
    if (['suspended', 'removed'].includes(listing.status)) return res.status(409).json({ error: 'Moderated listings cannot be published' });
    const template = await ownTemplate(req.user.id, listing.template_type, listing.template_id);
    if (!template) return res.status(409).json({ error: 'Referenced template is unavailable' });
    await createVersion(listing, template);
    const { data, error } = await supabase.from('plans_listings').update({ status: 'published', published_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq('id', listing.id).select('*').single();
    if (error) throw error;
    res.json(data);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/trainer/listings/:id/unpublish', auth, requireTrainerRole, async (req, res) => {
  try {
    if (!(await requireActiveTrainer(req.user.id))) return res.status(403).json({ error: 'Active trainer profile required' });
    const listing = await listingForTrainer(req.params.id, req.user.id);
    if (!listing) return res.status(404).json({ error: 'Listing not found' });
    if (['suspended', 'removed'].includes(listing.status)) return res.status(409).json({ error: 'Moderated listings cannot be changed' });
    const { data, error } = await supabase.from('plans_listings').update({ status: 'unpublished', updated_at: new Date().toISOString() }).eq('id', listing.id).select('*').single();
    if (error) throw error;
    res.json(data);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Purchase creation intentionally stops before provider-order creation, payment
// verification, or delivery. Those happen in later phases only.
router.post('/purchases', auth, async (req, res) => {
  try {
    const parsed = purchaseInput(req.body);
    if (parsed.error) return res.status(400).json({ error: parsed.error });
    const input = parsed.value;
    const { data: listing, error: listingError } = await supabase.from('plans_listings').select('*').eq('id', input.listingId).eq('status', 'published').maybeSingle();
    if (listingError) throw listingError;
    if (!listing) return res.status(404).json({ error: 'Published listing not found' });
    if (listing.trainer_id === req.user.id) return res.status(409).json({ error: 'You cannot purchase your own listing' });
    const amountMinor = input.currency === 'INR' ? listing.price_inr_paise : listing.price_usd_cents;
    if (!Number.isInteger(amountMinor) || amountMinor <= 0) return res.status(409).json({ error: 'Published listing has no valid price for this currency' });
    const commissionBps = Number(listing.commission_bps);
    if (!Number.isInteger(commissionBps) || commissionBps < 0) throw new Error('Listing commission is invalid');
    const paymentsEnabled = plansPaymentsEnabled();
    const paymentSettings = paymentsEnabled ? razorpaySettings() : null;

    // Idempotent create: a buyer with any non-terminal purchase for this
    // listing (payment_pending/paid/delivered) gets that same purchase back
    // instead of a second row -- covers both the disabled-payments path and
    // resuming an unfinished Razorpay checkout.
    const { data: existing, error: existingError } = await supabase.from('plans_purchases')
      .select('id, listing_id, listing_version_id, template_type, currency, final_price_minor, commission_bps, commission_minor, status, provider_order_id, created_at')
      .eq('buyer_id', req.user.id).eq('listing_id', listing.id)
      .in('status', ['payment_pending', 'paid', 'delivered'])
      .order('created_at', { ascending: false }).limit(1).maybeSingle();
    if (existingError) throw existingError;
    if (existing) {
      if (paymentsEnabled && existing.provider_order_id) return res.json(paymentOrderResponse(existing, paymentSettings.keyId));
      const { provider_order_id, ...publicExisting } = existing;
      return res.status(200).json(publicExisting);
    }

    const { data: version, error: versionError } = await supabase.from('plans_listing_versions').select('id').eq('listing_id', listing.id).order('created_at', { ascending: false }).limit(1).maybeSingle();
    if (versionError) throw versionError;
    const { data, error } = await supabase.from('plans_purchases').insert({
      listing_id: listing.id,
      listing_version_id: version?.id || null,
      buyer_id: req.user.id,
      trainer_id: listing.trainer_id,
      template_type: listing.template_type,
      template_id: listing.template_id,
      currency: input.currency,
      final_price_minor: amountMinor,
      commission_bps: commissionBps,
      commission_minor: commissionMinor(amountMinor, commissionBps),
      status: 'payment_pending',
    }).select('id, listing_id, listing_version_id, template_type, currency, final_price_minor, commission_bps, commission_minor, status, created_at').single();
    if (error) throw error;
    if (!paymentsEnabled) return res.status(201).json(data);
    try {
      const razorpay = new Razorpay({ key_id: paymentSettings.keyId, key_secret: paymentSettings.keySecret });
      const order = await createRazorpayOrder({ purchaseId: data.id, amountMinor, currency: input.currency, razorpay });
      if (!order?.id) throw new Error('Razorpay returned no order id');
      const updated = await storeProviderOrder(supabase, data.id, order.id);
      return res.status(201).json(paymentOrderResponse(updated, paymentSettings.keyId));
    } catch {
      await failPendingPurchase(supabase, data.id);
      return res.status(502).json({ error: 'Unable to create a payment order. Please try again later.' });
    }
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/purchases/:id', auth, async (req, res) => {
  try {
    const { data, error } = await supabase.from('plans_purchases').select('id, listing_id, listing_version_id, template_type, currency, final_price_minor, commission_bps, commission_minor, status, delivered_at, created_at').eq('id', req.params.id).eq('buyer_id', req.user.id).maybeSingle();
    if (error) throw error;
    if (!data) return res.status(404).json({ error: 'Purchase not found' });
    res.json(data);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/my-purchases', auth, async (req, res) => {
  try {
    const { data, error } = await supabase.from('plans_purchases').select('id, listing_id, template_type, currency, final_price_minor, status, delivered_at, created_at').eq('buyer_id', req.user.id).order('created_at', { ascending: false });
    if (error) throw error;
    res.json(data || []);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/listings/:id/reviews', async (req, res) => {
  try {
    const { data, error } = await supabase.from('plans_reviews').select('id, rating, review_text, created_at').eq('listing_id', req.params.id).eq('status', 'visible').order('created_at', { ascending: false });
    if (error) throw error;
    res.json(data || []);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/purchases/:purchaseId/review', auth, async (req, res) => {
  try {
    const rating = Number(req.body?.rating);
    const reviewText = String(req.body?.reviewText ?? req.body?.review_text ?? '').trim();
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) return res.status(400).json({ error: 'rating must be an integer from 1 to 5' });
    if (!reviewText || reviewText.length > 2000) return res.status(400).json({ error: 'review_text must be 1 to 2000 characters' });
    const { data: purchase, error: purchaseError } = await supabase.from('plans_purchases').select('id, listing_id, buyer_id, status').eq('id', req.params.purchaseId).eq('buyer_id', req.user.id).eq('status', 'delivered').maybeSingle();
    if (purchaseError) throw purchaseError;
    if (!purchase) return res.status(403).json({ error: 'A delivered purchase you own is required to review' });
    const { data, error } = await supabase.from('plans_reviews').insert({ listing_id: purchase.listing_id, purchase_id: purchase.id, buyer_id: req.user.id, rating, review_text: reviewText }).select('id, listing_id, purchase_id, rating, review_text, status, created_at').single();
    if (error?.code === '23505') return res.status(409).json({ error: 'You have already reviewed this purchase' });
    if (error) throw error;
    res.status(201).json(data);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Moderation: suspend (recoverable -- e.g. a listing under review) and remove
// (terminal) both write the matching plans_listings.*_at timestamp plus an
// optional moderation_reason, columns the Phase 1 schema already reserved for
// this. A suspended/removed listing already drops out of every public query
// in this file (all public reads filter status = 'published'), so no
// additional unpublish step is needed.
async function moderateListing(id, { status, timestampColumn, reason }) {
  const { data, error } = await supabase.from('plans_listings')
    .update({ status, [timestampColumn]: new Date().toISOString(), moderation_reason: reason, updated_at: new Date().toISOString() })
    .eq('id', id).select('*').maybeSingle();
  if (error) throw error;
  return data;
}

router.post('/admin/listings/:id/suspend', auth, requireAdminPlans, async (req, res) => {
  try {
    const reason = req.body?.reason ? String(req.body.reason).trim().slice(0, 500) : null;
    const { data: listing, error: listingError } = await supabase.from('plans_listings').select('id, status').eq('id', req.params.id).maybeSingle();
    if (listingError) throw listingError;
    if (!listing) return res.status(404).json({ error: 'Listing not found' });
    if (listing.status === 'removed') return res.status(409).json({ error: 'Listing has already been removed' });
    res.json(await moderateListing(listing.id, { status: 'suspended', timestampColumn: 'suspended_at', reason }));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/admin/listings/:id/remove', auth, requireAdminPlans, async (req, res) => {
  try {
    const reason = req.body?.reason ? String(req.body.reason).trim().slice(0, 500) : null;
    const { data: listing, error: listingError } = await supabase.from('plans_listings').select('id, status').eq('id', req.params.id).maybeSingle();
    if (listingError) throw listingError;
    if (!listing) return res.status(404).json({ error: 'Listing not found' });
    res.json(await moderateListing(listing.id, { status: 'removed', timestampColumn: 'removed_at', reason }));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/admin/purchases', auth, requireAdminPlans, async (req, res) => {
  try {
    let query = supabase.from('plans_purchases')
      .select('id, status, currency, final_price_minor, created_at, buyer:users!plans_purchases_buyer_id_fkey(full_name, email), trainer:users!plans_purchases_trainer_id_fkey(full_name), listing:plans_listings(title)')
      .order('created_at', { ascending: false });
    if (req.query.status) query = query.eq('status', req.query.status);
    const { data, error } = await query;
    if (error) throw error;
    res.json(data || []);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/admin/purchases/:id/approve', auth, requireAdminPlans, async (req, res) => {
  try {
    const { data: purchase, error: purchaseError } = await supabase.from('plans_purchases').select('id, status').eq('id', req.params.id).maybeSingle();
    if (purchaseError) throw purchaseError;
    if (!purchase) return res.status(404).json({ error: 'Purchase not found' });
    const wasAlreadyDelivered = purchase.status === 'delivered';
    const delivered = await deliverPurchase(purchase.id);
    // Recorded separately from deliverPurchase's own 'delivered' event so the
    // audit trail names *who* approved it and *how* (manual admin action, as
    // opposed to a future Razorpay webhook's own distinct provider/event_type)
    // -- but only on the call that actually delivers, not on a re-approve of
    // an already-delivered purchase.
    if (!wasAlreadyDelivered) {
      await supabase.from('plans_payment_events').insert({
        purchase_id: purchase.id, provider: 'manual', provider_payment_id: null,
        event_type: 'admin_manual_approval', event_payload: { approved_by: req.user.email },
      });
    }
    res.json(delivered);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Delivers a payment-confirmed purchase into the buyer's real Plan Library --
// the same assigned_plans/assigned_diet_plans tables and shapes a trainer's
// own assign flow uses (trainerRoutes.js /assign-plan, dietPlanRoutes.js
// /assign), so the buyer's existing "my plan" screens render it identically
// to a trainer-assigned plan with no client-side changes. Called by the
// admin-approve route above; also safe for a future Razorpay webhook to
// call directly since it isn't coupled to anything admin-specific.
//
// Idempotent: already-delivered purchases return unchanged rather than
// re-delivering, since a webhook retry or an admin double-click must never
// create a second assignment for the same purchase.
async function deliverPurchase(purchaseId) {
  const { data: purchase, error: purchaseError } = await supabase.from('plans_purchases').select('*').eq('id', purchaseId).maybeSingle();
  if (purchaseError) throw purchaseError;
  if (!purchase) throw new Error('Purchase not found');
  if (purchase.status === 'delivered') return purchase;

  const startsAt = new Date().toISOString().split('T')[0];
  let assignedId;
  let assignedColumn;

  if (purchase.template_type === 'workout') {
    const { data: template, error: templateError } = await supabase.from('trainer_templates').select('*').eq('id', purchase.template_id).maybeSingle();
    if (templateError) throw templateError;
    if (!template) throw new Error('Source workout template is unavailable');
    await supabase.from('assigned_plans')
      .update({ status: 'replaced', updated_at: new Date().toISOString() })
      .eq('trainer_id', purchase.trainer_id).eq('client_id', purchase.buyer_id).eq('type', 'workout').eq('status', 'active');
    const { data: assigned, error: assignError } = await supabase.from('assigned_plans').insert({
      trainer_id: purchase.trainer_id,
      client_id: purchase.buyer_id,
      template_id: purchase.template_id,
      type: 'workout',
      name: template.name,
      plan_data: template.template_data || {},
      starts_at: startsAt,
    }).select('id').single();
    if (assignError) throw assignError;
    assignedId = assigned.id;
    assignedColumn = 'workout_assigned_plan_id';
  } else {
    const template = await fetchFullTemplate(supabase, purchase.template_id);
    if (!template) throw new Error('Source diet template is unavailable');
    await supabase.from('assigned_diet_plans')
      .update({ is_active: false })
      .eq('trainer_id', purchase.trainer_id).eq('client_id', purchase.buyer_id).eq('is_active', true);
    const { data: assigned, error: assignError } = await supabase.from('assigned_diet_plans').insert({
      template_id: purchase.template_id,
      trainer_id: purchase.trainer_id,
      client_id: purchase.buyer_id,
      detail_level: template.detail_level || null,
      name: template.name,
      calories_target: template.calories_target,
      protein_g: template.protein_g,
      carbs_g: template.carbs_g,
      fat_g: template.fat_g,
      is_active: true,
    }).select('id').single();
    if (assignError) throw assignError;
    await insertAssignedDays(supabase, assigned.id, template.days);
    assignedId = assigned.id;
    assignedColumn = 'diet_assigned_plan_id';
  }

  // Guard the transition on the status we just read: if a concurrent caller
  // already delivered this purchase, this update matches zero rows and we
  // surface that instead of silently double-delivering.
  const { data: delivered, error: deliverError } = await supabase.from('plans_purchases')
    .update({ status: 'delivered', delivered_at: new Date().toISOString(), updated_at: new Date().toISOString(), [assignedColumn]: assignedId })
    .eq('id', purchase.id).eq('status', purchase.status)
    .select('*').maybeSingle();
  if (deliverError) throw deliverError;
  if (!delivered) throw new Error('Purchase was delivered concurrently by another request');

  await supabase.from('plans_payment_events').insert({
    purchase_id: purchase.id,
    provider: 'manual',
    event_type: 'delivered',
    event_payload: { assigned_table: assignedColumn === 'workout_assigned_plan_id' ? 'assigned_plans' : 'assigned_diet_plans', assigned_id: assignedId },
  });

  return delivered;
}

module.exports = router;
module.exports._private = { slugify, listingInput, purchaseInput, commissionMinor, plansPaymentsEnabled, razorpaySettings, razorpayReceipt, createRazorpayOrder, paymentOrderResponse, storeProviderOrder, failPendingPurchase, deliverPurchase, generateHandle, validHandleFormat, COMMISSION_BPS, PUBLIC_FIELDS };
