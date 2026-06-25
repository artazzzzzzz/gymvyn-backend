const express = require('express');
const { createClient } = require('@supabase/supabase-js');

const router = express.Router();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const VALID_CATEGORIES = [
  'rent', 'equipment', 'salaries', 'utilities',
  'marketing', 'maintenance', 'other',
];

// ── Middleware ────────────────────────────────────────────────────────────────

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

// ── Helpers ───────────────────────────────────────────────────────────────────

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

// Returns { start, end } as YYYY-MM-DD strings defaulting to current month.
function resolveDateRange(startDate, endDate) {
  if (startDate && endDate) return { start: startDate, end: endDate };
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), 1)
    .toISOString().slice(0, 10);
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 0)
    .toISOString().slice(0, 10);
  return { start, end };
}

// ── GET /api/expenses/summary/monthly ────────────────────────────────────────
// Must be registered BEFORE /:id routes.

router.get(
  '/summary/monthly',
  auth, withProfile, ownerOnly,
  async (req, res) => {
    try {
      // Build a series of the last 6 months (oldest → newest).
      const months = [];
      const now = new Date();
      for (let i = 5; i >= 0; i--) {
        const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
        months.push({
          month: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`,
          start: new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10),
          end:   new Date(d.getFullYear(), d.getMonth() + 1, 0).toISOString().slice(0, 10),
        });
      }

      const { data, error } = await supabase
        .from('gym_expenses')
        .select('expense_date, amount')
        .eq('gym_id', req.gymId)
        .gte('expense_date', months[0].start)
        .lte('expense_date', months[months.length - 1].end);

      if (error) throw error;

      // Bucket each expense into its month.
      const totals = {};
      for (const { month } of months) totals[month] = 0;
      for (const row of data || []) {
        const m = row.expense_date.slice(0, 7); // 'YYYY-MM'
        if (totals[m] !== undefined) totals[m] += Number(row.amount);
      }

      res.json(months.map(({ month }) => ({ month, total: totals[month] })));
    } catch (err) {
      console.error('GET /api/expenses/summary/monthly error:', err);
      res.status(500).json({ error: err.message });
    }
  }
);

// ── GET /api/expenses/summary ─────────────────────────────────────────────────

router.get(
  '/summary',
  auth, withProfile, ownerOnly,
  async (req, res) => {
    try {
      const { startDate, endDate } = req.query;
      const { start, end } = resolveDateRange(startDate, endDate);

      const { data, error } = await supabase
        .from('gym_expenses')
        .select('category, amount')
        .eq('gym_id', req.gymId)
        .gte('expense_date', start)
        .lte('expense_date', end);

      if (error) throw error;

      // Aggregate
      const catMap = {};
      for (const cat of VALID_CATEGORIES) catMap[cat] = { total: 0, count: 0 };
      let totalAmount = 0;

      for (const row of data || []) {
        const amt = Number(row.amount);
        totalAmount += amt;
        if (catMap[row.category]) {
          catMap[row.category].total += amt;
          catMap[row.category].count += 1;
        }
      }

      const byCategory = VALID_CATEGORIES.map(cat => ({
        category: cat,
        total:    catMap[cat].total,
        count:    catMap[cat].count,
      }));

      res.json({ totalAmount, byCategory, periodStart: start, periodEnd: end });
    } catch (err) {
      console.error('GET /api/expenses/summary error:', err);
      res.status(500).json({ error: err.message });
    }
  }
);

// ── GET /api/expenses ─────────────────────────────────────────────────────────

router.get(
  '/',
  auth, withProfile, ownerOnly,
  async (req, res) => {
    try {
      const { category, startDate, endDate } = req.query;

      let query = supabase
        .from('gym_expenses')
        .select('*')
        .eq('gym_id', req.gymId)
        .order('expense_date', { ascending: false })
        .order('created_at',   { ascending: false });

      if (category) {
        if (!VALID_CATEGORIES.includes(category)) {
          return res.status(400).json({ error: `Invalid category. Must be one of: ${VALID_CATEGORIES.join(', ')}` });
        }
        query = query.eq('category', category);
      }
      if (startDate) query = query.gte('expense_date', startDate);
      if (endDate)   query = query.lte('expense_date', endDate);

      const { data, error } = await query;
      if (error) throw error;

      res.json(data);
    } catch (err) {
      console.error('GET /api/expenses error:', err);
      res.status(500).json({ error: err.message });
    }
  }
);

// ── POST /api/expenses ────────────────────────────────────────────────────────

router.post(
  '/',
  auth, withProfile, ownerOnly,
  async (req, res) => {
    try {
      const { category, description, amount, expense_date } = req.body;

      if (!category || !VALID_CATEGORIES.includes(category)) {
        return res.status(400).json({ error: `category must be one of: ${VALID_CATEGORIES.join(', ')}` });
      }
      const amt = Number(amount);
      if (!Number.isFinite(amt) || amt <= 0) {
        return res.status(400).json({ error: 'amount must be a positive number' });
      }

      const { data, error } = await supabase
        .from('gym_expenses')
        .insert({
          gym_id:       req.gymId,
          category,
          description:  description?.trim() || null,
          amount:       amt,
          expense_date: expense_date || todayISO(),
        })
        .select()
        .single();

      if (error) throw error;
      res.status(201).json(data);
    } catch (err) {
      console.error('POST /api/expenses error:', err);
      res.status(500).json({ error: err.message });
    }
  }
);

// ── PATCH /api/expenses/:id ───────────────────────────────────────────────────

router.patch(
  '/:id',
  auth, withProfile, ownerOnly,
  async (req, res) => {
    try {
      const { id } = req.params;

      // Confirm ownership before touching
      const { data: existing, error: fetchErr } = await supabase
        .from('gym_expenses')
        .select('id')
        .eq('id', id)
        .eq('gym_id', req.gymId)
        .maybeSingle();

      if (fetchErr) throw fetchErr;
      if (!existing) return res.status(404).json({ error: 'Expense not found in your gym' });

      const updates = {};

      if (req.body.category !== undefined) {
        if (!VALID_CATEGORIES.includes(req.body.category)) {
          return res.status(400).json({ error: `category must be one of: ${VALID_CATEGORIES.join(', ')}` });
        }
        updates.category = req.body.category;
      }
      if (req.body.amount !== undefined) {
        const amt = Number(req.body.amount);
        if (!Number.isFinite(amt) || amt <= 0) {
          return res.status(400).json({ error: 'amount must be a positive number' });
        }
        updates.amount = amt;
      }
      if (req.body.description !== undefined) updates.description = req.body.description?.trim() || null;
      if (req.body.expense_date !== undefined) updates.expense_date = req.body.expense_date;

      if (Object.keys(updates).length === 0) {
        return res.status(400).json({ error: 'No valid fields to update' });
      }

      const { data, error } = await supabase
        .from('gym_expenses')
        .update(updates)
        .eq('id', id)
        .eq('gym_id', req.gymId)
        .select()
        .single();

      if (error) throw error;
      res.json(data);
    } catch (err) {
      console.error('PATCH /api/expenses/:id error:', err);
      res.status(500).json({ error: err.message });
    }
  }
);

// ── DELETE /api/expenses/:id ──────────────────────────────────────────────────

router.delete(
  '/:id',
  auth, withProfile, ownerOnly,
  async (req, res) => {
    try {
      const { id } = req.params;

      const { data: existing, error: fetchErr } = await supabase
        .from('gym_expenses')
        .select('id')
        .eq('id', id)
        .eq('gym_id', req.gymId)
        .maybeSingle();

      if (fetchErr) throw fetchErr;
      if (!existing) return res.status(404).json({ error: 'Expense not found in your gym' });

      const { error } = await supabase
        .from('gym_expenses')
        .delete()
        .eq('id', id)
        .eq('gym_id', req.gymId);

      if (error) throw error;
      res.json({ success: true });
    } catch (err) {
      console.error('DELETE /api/expenses/:id error:', err);
      res.status(500).json({ error: err.message });
    }
  }
);

module.exports = router;
