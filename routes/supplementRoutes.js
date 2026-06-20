const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const cloudinary = require('cloudinary').v2;
const multer = require('multer');

const router = express.Router();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key:    process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

const imgUpload = multer({ storage: multer.memoryStorage() });

// ── Auth + profile middleware ──────────────────────────────────────────────────

async function auth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Missing auth token' });

  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data?.user) return res.status(401).json({ error: 'Invalid auth token' });

  req.user = data.user;
  next();
}

async function withProfile(req, res, next) {
  const { data, error } = await supabase
    .from('users')
    .select('role, gym_id')
    .eq('id', req.user.id)
    .maybeSingle();

  if (error) return res.status(500).json({ error: 'Failed to load user profile' });
  if (!data)  return res.status(401).json({ error: 'User profile not found' });

  req.profile = data;
  next();
}

// ── Gym-owner guard ───────────────────────────────────────────────────────────
// Resolves the owner's gym_id and attaches it to req.gymId.

async function ownerOnly(req, res, next) {
  if (req.profile.role !== 'gym_owner') {
    return res.status(403).json({ error: 'Gym owner access required' });
  }

  const { data, error } = await supabase
    .from('gyms')
    .select('id')
    .eq('owner_id', req.user.id)
    .eq('is_active', true)
    .maybeSingle();

  if (error) return res.status(500).json({ error: 'Failed to resolve gym' });
  if (!data)  return res.status(404).json({ error: 'No active gym found for this owner' });

  req.gymId = data.id;
  next();
}

// ── Member guard ──────────────────────────────────────────────────────────────
// Derives gym_id server-side: first from gym_memberships (active row),
// then falls back to users.gym_id (set when joining via gym code).

async function memberOnly(req, res, next) {
  const { data: mem } = await supabase
    .from('gym_memberships')
    .select('gym_id')
    .eq('user_id', req.user.id)
    .eq('status', 'active')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  const gymId = mem?.gym_id || req.profile.gym_id;

  if (!gymId) {
    return res.status(403).json({ error: 'You are not linked to any gym' });
  }

  req.gymId = gymId;
  next();
}

// ── OWNER — Products ──────────────────────────────────────────────────────────

// GET /api/supplements/products/low-stock
// MUST be registered before /products/:id to avoid Express treating
// "low-stock" as an :id param (even though there's no GET /:id route here,
// this ordering is correct practice for future-proofing).
router.get(
  '/products/low-stock',
  auth, withProfile, ownerOnly,
  async (req, res) => {
    try {
      const { data, error } = await supabase
        .from('supplement_products')
        .select('*')
        .eq('gym_id', req.gymId)
        .eq('is_active', true)
        .order('stock_count', { ascending: true });

      if (error) throw error;

      // PostgREST can't compare two columns in a filter, so we apply it in JS.
      const lowStock = data.filter(p => p.stock_count <= p.low_stock_threshold);
      res.json(lowStock);
    } catch (err) {
      console.error('GET /api/supplements/products/low-stock error:', err);
      res.status(500).json({ error: err.message });
    }
  }
);

// GET /api/supplements/products — all products for owner's gym (active + inactive)
router.get(
  '/products',
  auth, withProfile, ownerOnly,
  async (req, res) => {
    try {
      const { data, error } = await supabase
        .from('supplement_products')
        .select('*')
        .eq('gym_id', req.gymId)
        .order('created_at', { ascending: false });

      if (error) throw error;
      res.json(data);
    } catch (err) {
      console.error('GET /api/supplements/products error:', err);
      res.status(500).json({ error: err.message });
    }
  }
);

// POST /api/supplements/products — create a product
router.post(
  '/products',
  auth, withProfile, ownerOnly,
  async (req, res) => {
    try {
      const {
        name, description, category, price,
        image_url, stock_count, low_stock_threshold, is_active,
      } = req.body;

      if (!name?.trim())                       return res.status(400).json({ error: 'name is required' });
      if (price == null || Number(price) < 0)  return res.status(400).json({ error: 'price must be a non-negative number' });

      const { data, error } = await supabase
        .from('supplement_products')
        .insert({
          gym_id:              req.gymId,
          name:                name.trim(),
          description:         description?.trim() || null,
          category:            category?.trim()    || null,
          price:               Number(price),
          image_url:           image_url           || null,
          stock_count:         Number(stock_count  ?? 0),
          low_stock_threshold: Number(low_stock_threshold ?? 5),
          is_active:           is_active !== false,
        })
        .select()
        .single();

      if (error) throw error;
      res.status(201).json(data);
    } catch (err) {
      console.error('POST /api/supplements/products error:', err);
      res.status(500).json({ error: err.message });
    }
  }
);

// PATCH /api/supplements/products/:id — update product
router.patch(
  '/products/:id',
  auth, withProfile, ownerOnly,
  async (req, res) => {
    try {
      const { id } = req.params;

      // Confirm the product belongs to the owner's gym before touching it
      const { data: existing, error: fetchErr } = await supabase
        .from('supplement_products')
        .select('id')
        .eq('id', id)
        .eq('gym_id', req.gymId)
        .maybeSingle();

      if (fetchErr) throw fetchErr;
      if (!existing) return res.status(404).json({ error: 'Product not found in your gym' });

      const ALLOWED = [
        'name', 'description', 'category', 'price',
        'image_url', 'stock_count', 'low_stock_threshold', 'is_active',
      ];
      const updates = {};
      ALLOWED.forEach(field => {
        if (req.body[field] !== undefined) updates[field] = req.body[field];
      });

      if (Object.keys(updates).length === 0) {
        return res.status(400).json({ error: 'No valid fields to update' });
      }

      updates.updated_at = new Date().toISOString();

      const { data, error } = await supabase
        .from('supplement_products')
        .update(updates)
        .eq('id', id)
        .eq('gym_id', req.gymId)
        .select()
        .single();

      if (error) throw error;
      res.json(data);
    } catch (err) {
      console.error('PATCH /api/supplements/products/:id error:', err);
      res.status(500).json({ error: err.message });
    }
  }
);

// DELETE /api/supplements/products/:id
// Only allowed if the product has zero order history; otherwise owner must
// set is_active=false to delist it (preserves snapshot integrity in orders).
router.delete(
  '/products/:id',
  auth, withProfile, ownerOnly,
  async (req, res) => {
    try {
      const { id } = req.params;

      const { data: existing, error: fetchErr } = await supabase
        .from('supplement_products')
        .select('id, name')
        .eq('id', id)
        .eq('gym_id', req.gymId)
        .maybeSingle();

      if (fetchErr) throw fetchErr;
      if (!existing) return res.status(404).json({ error: 'Product not found in your gym' });

      // Check for any order history referencing this product
      const { count, error: countErr } = await supabase
        .from('supplement_order_items')
        .select('id', { count: 'exact', head: true })
        .eq('product_id', id);

      if (countErr) throw countErr;

      if (count > 0) {
        return res.status(409).json({
          error: `"${existing.name}" has order history and cannot be deleted. Set is_active=false to delist it instead.`,
          has_order_history: true,
        });
      }

      const { error: delErr } = await supabase
        .from('supplement_products')
        .delete()
        .eq('id', id)
        .eq('gym_id', req.gymId);

      if (delErr) throw delErr;
      res.json({ success: true });
    } catch (err) {
      console.error('DELETE /api/supplements/products/:id error:', err);
      res.status(500).json({ error: err.message });
    }
  }
);

// POST /api/supplements/products/:id/upload-image — Cloudinary product image
router.post(
  '/products/:id/upload-image',
  auth, withProfile, ownerOnly,
  imgUpload.single('image'),
  async (req, res) => {
    try {
      const { id } = req.params;
      if (!req.file) return res.status(400).json({ error: 'No image file provided' });

      const { data: existing, error: fetchErr } = await supabase
        .from('supplement_products')
        .select('id')
        .eq('id', id)
        .eq('gym_id', req.gymId)
        .maybeSingle();

      if (fetchErr) throw fetchErr;
      if (!existing) return res.status(404).json({ error: 'Product not found in your gym' });

      const result = await new Promise((resolve, reject) => {
        cloudinary.uploader.upload_stream(
          {
            folder:          'fitforge/supplements',
            public_id:       `product-${id}`,
            overwrite:       true,
            transformation:  [{ width: 800, height: 800, crop: 'limit' }],
          },
          (err, result) => { if (err) reject(err); else resolve(result); }
        ).end(req.file.buffer);
      });

      const { error: updateErr } = await supabase
        .from('supplement_products')
        .update({ image_url: result.secure_url, updated_at: new Date().toISOString() })
        .eq('id', id)
        .eq('gym_id', req.gymId);

      if (updateErr) throw updateErr;
      res.json({ image_url: result.secure_url });
    } catch (err) {
      console.error('POST /api/supplements/products/:id/upload-image error:', err);
      res.status(500).json({ error: err.message || 'Image upload failed' });
    }
  }
);

// ── OWNER — Orders ────────────────────────────────────────────────────────────

// GET /api/supplements/orders — all orders for owner's gym; ?status= filter
router.get(
  '/orders',
  auth, withProfile, ownerOnly,
  async (req, res) => {
    try {
      const { status } = req.query;

      let query = supabase
        .from('supplement_orders')
        .select(`
          *,
          users!supplement_orders_user_id_fkey(full_name, phone),
          supplement_order_items(
            id, product_id, product_name_snapshot,
            unit_price_snapshot, quantity
          )
        `)
        .eq('gym_id', req.gymId)
        .order('created_at', { ascending: false });

      if (status) {
        query = query.eq('status', status);
      }

      const { data, error } = await query;
      if (error) throw error;

      // Flatten member name into the order object for convenience
      const orders = data.map(({ users, ...order }) => ({
        ...order,
        member_name:  users?.full_name || null,
        member_phone: users?.phone     || null,
      }));

      res.json(orders);
    } catch (err) {
      console.error('GET /api/supplements/orders error:', err);
      res.status(500).json({ error: err.message });
    }
  }
);

const VALID_STATUS_TRANSITIONS = {
  pending:          ['ready_for_pickup', 'cancelled'],
  ready_for_pickup: ['completed', 'cancelled'],
  completed:        [],
  cancelled:        [],
};

// PATCH /api/supplements/orders/:id/status — owner updates order status
router.patch(
  '/orders/:id/status',
  auth, withProfile, ownerOnly,
  async (req, res) => {
    try {
      const { id } = req.params;
      const { status: newStatus } = req.body;

      const { data: order, error: fetchErr } = await supabase
        .from('supplement_orders')
        .select('id, status')
        .eq('id', id)
        .eq('gym_id', req.gymId)
        .maybeSingle();

      if (fetchErr) throw fetchErr;
      if (!order) return res.status(404).json({ error: 'Order not found in your gym' });

      const allowed = VALID_STATUS_TRANSITIONS[order.status] || [];
      if (!allowed.includes(newStatus)) {
        return res.status(400).json({
          error: `Cannot move order from "${order.status}" to "${newStatus}". Allowed transitions: ${allowed.join(', ') || 'none'}`,
        });
      }

      const { data, error } = await supabase
        .from('supplement_orders')
        .update({ status: newStatus, updated_at: new Date().toISOString() })
        .eq('id', id)
        .eq('gym_id', req.gymId)
        .select()
        .single();

      if (error) throw error;
      res.json(data);
    } catch (err) {
      console.error('PATCH /api/supplements/orders/:id/status error:', err);
      res.status(500).json({ error: err.message });
    }
  }
);

// PATCH /api/supplements/orders/:id/payment — owner marks order as paid
router.patch(
  '/orders/:id/payment',
  auth, withProfile, ownerOnly,
  async (req, res) => {
    try {
      const { id } = req.params;
      const { payment_method } = req.body;

      const { data: order, error: fetchErr } = await supabase
        .from('supplement_orders')
        .select('id')
        .eq('id', id)
        .eq('gym_id', req.gymId)
        .maybeSingle();

      if (fetchErr) throw fetchErr;
      if (!order) return res.status(404).json({ error: 'Order not found in your gym' });

      const updates = {
        payment_status: 'paid',
        updated_at:     new Date().toISOString(),
      };
      if (payment_method) {
        if (!['cash', 'upi'].includes(payment_method)) {
          return res.status(400).json({ error: 'payment_method must be "cash" or "upi"' });
        }
        updates.payment_method = payment_method;
      }

      const { data, error } = await supabase
        .from('supplement_orders')
        .update(updates)
        .eq('id', id)
        .eq('gym_id', req.gymId)
        .select()
        .single();

      if (error) throw error;
      res.json(data);
    } catch (err) {
      console.error('PATCH /api/supplements/orders/:id/payment error:', err);
      res.status(500).json({ error: err.message });
    }
  }
);

// ── MEMBER — Catalog & Orders ─────────────────────────────────────────────────

// GET /api/supplements/catalog — active products for member's linked gym
router.get(
  '/catalog',
  auth, withProfile, memberOnly,
  async (req, res) => {
    try {
      const { data, error } = await supabase
        .from('supplement_products')
        .select('id, name, description, category, price, image_url, stock_count, is_active')
        .eq('gym_id', req.gymId)
        .eq('is_active', true)
        .order('category', { ascending: true })
        .order('name',     { ascending: true });

      if (error) throw error;
      res.json(data);
    } catch (err) {
      console.error('GET /api/supplements/catalog error:', err);
      res.status(500).json({ error: err.message });
    }
  }
);

// GET /api/supplements/orders/mine — member's own order history
// Must be registered before PATCH /orders/:id/... to avoid ambiguity.
router.get(
  '/orders/mine',
  auth, withProfile, memberOnly,
  async (req, res) => {
    try {
      const { data, error } = await supabase
        .from('supplement_orders')
        .select(`
          *,
          supplement_order_items(
            id, product_id, product_name_snapshot,
            unit_price_snapshot, quantity
          )
        `)
        .eq('user_id', req.user.id)
        .eq('gym_id', req.gymId)
        .order('created_at', { ascending: false });

      if (error) throw error;
      res.json(data);
    } catch (err) {
      console.error('GET /api/supplements/orders/mine error:', err);
      res.status(500).json({ error: err.message });
    }
  }
);

// POST /api/supplements/orders — member places an order
// Stock decrement + order creation handled atomically via PG function.
router.post(
  '/orders',
  auth, withProfile, memberOnly,
  async (req, res) => {
    try {
      const { items, payment_method, notes } = req.body;

      if (!Array.isArray(items) || items.length === 0) {
        return res.status(400).json({ error: 'items must be a non-empty array' });
      }

      // Validate item structure before hitting the DB
      for (const item of items) {
        if (!item.product_id) {
          return res.status(400).json({ error: 'Each item must have a product_id' });
        }
        const qty = Number(item.quantity);
        if (!Number.isInteger(qty) || qty < 1) {
          return res.status(400).json({ error: `quantity for product ${item.product_id} must be a positive integer` });
        }
      }

      if (payment_method && !['cash', 'upi'].includes(payment_method)) {
        return res.status(400).json({ error: 'payment_method must be "cash" or "upi"' });
      }

      const { data: result, error } = await supabase.rpc('create_supplement_order', {
        p_gym_id:         req.gymId,
        p_user_id:        req.user.id,
        p_items:          items,
        p_payment_method: payment_method || null,
        p_notes:          notes          || null,
      });

      if (error) throw error;

      if (result?.error === 'insufficient_stock') {
        const lines = result.items.map(
          i => `"${i.name}": requested ${i.requested}, only ${i.available} in stock`
        );
        return res.status(409).json({
          error: `Insufficient stock for the following item(s): ${lines.join('; ')}`,
          insufficient_items: result.items,
        });
      }

      if (result?.error) {
        return res.status(400).json({ error: result.error });
      }

      res.status(201).json({
        order_id:     result.order_id,
        total_amount: result.total_amount,
      });
    } catch (err) {
      console.error('POST /api/supplements/orders error:', err);
      const msg = err.message || '';
      if (msg.includes('Race condition')) {
        return res.status(409).json({ error: 'Order could not be placed due to a stock conflict. Please try again.' });
      }
      res.status(500).json({ error: msg });
    }
  }
);

// PATCH /api/supplements/orders/:id/cancel — member cancels own pending order
// Stock is restored atomically via PG function.
router.patch(
  '/orders/:id/cancel',
  auth, withProfile, memberOnly,
  async (req, res) => {
    try {
      const { id } = req.params;

      const { data: result, error } = await supabase.rpc('cancel_supplement_order', {
        p_order_id: id,
        p_user_id:  req.user.id,
      });

      if (error) throw error;

      if (result?.error === 'not_found') {
        return res.status(404).json({ error: 'Order not found or does not belong to you' });
      }

      if (result?.error === 'not_cancellable') {
        return res.status(409).json({
          error: `Order cannot be cancelled because its status is "${result.current_status}". Only pending orders can be cancelled.`,
        });
      }

      if (result?.error) {
        return res.status(400).json({ error: result.error });
      }

      res.json({ success: true });
    } catch (err) {
      console.error('PATCH /api/supplements/orders/:id/cancel error:', err);
      res.status(500).json({ error: err.message });
    }
  }
);

// PATCH /api/supplements/orders/:id/confirm-payment
// Member declares how they intend to pay (cash / upi).
// Sets payment_method only; payment_status stays 'unpaid' until owner confirms.
router.patch(
  '/orders/:id/confirm-payment',
  auth, withProfile, memberOnly,
  async (req, res) => {
    try {
      const { id } = req.params;
      const { payment_method } = req.body;

      if (!payment_method || !['cash', 'upi'].includes(payment_method)) {
        return res.status(400).json({ error: 'payment_method must be "cash" or "upi"' });
      }

      // Verify the order belongs to this member and is still open
      const { data: order, error: fetchErr } = await supabase
        .from('supplement_orders')
        .select('id, status, payment_status')
        .eq('id', id)
        .eq('user_id', req.user.id)
        .eq('gym_id', req.gymId)
        .maybeSingle();

      if (fetchErr) throw fetchErr;
      if (!order) return res.status(404).json({ error: 'Order not found or does not belong to you' });

      if (['cancelled', 'completed'].includes(order.status)) {
        return res.status(409).json({
          error: `Cannot update payment intent on a ${order.status} order`,
        });
      }

      const { data, error } = await supabase
        .from('supplement_orders')
        .update({ payment_method, updated_at: new Date().toISOString() })
        .eq('id', id)
        .eq('user_id', req.user.id)
        .select()
        .single();

      if (error) throw error;
      res.json(data);
    } catch (err) {
      console.error('PATCH /api/supplements/orders/:id/confirm-payment error:', err);
      res.status(500).json({ error: err.message });
    }
  }
);

module.exports = router;
