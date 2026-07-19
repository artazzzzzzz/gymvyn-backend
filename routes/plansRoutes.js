const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const { auth, requireTrainerRole } = require('../middleware/auth');

const router = express.Router();
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
const COMMISSION_BPS = 500;
const PUBLIC_FIELDS = 'id, slug, title, description, template_type, price_inr_paise, price_usd_cents, published_at';

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

// TODO: There is no reusable, verified platform-admin guard in this codebase.
// These endpoints are deliberately authenticated but disabled rather than insecure.
function adminGuardUnavailable(req, res) { res.status(501).json({ error: 'Gymvyn Plans admin authorization is not configured yet' }); }
router.post('/admin/listings/:id/suspend', auth, adminGuardUnavailable);
router.post('/admin/listings/:id/remove', auth, adminGuardUnavailable);

module.exports = router;
module.exports._private = { slugify, listingInput, COMMISSION_BPS, PUBLIC_FIELDS };
