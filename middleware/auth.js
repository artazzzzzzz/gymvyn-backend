const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

async function auth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Missing auth token' });

  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data?.user) return res.status(401).json({ error: 'Invalid auth token' });

  req.user = data.user;
  req.userId = data.user.id; // convenience alias — do not remove, downstream handlers rely on it
  next();
}

// Ownership check for routes shaped /:gymId/... — must run after `auth`.
async function requireGymOwner(req, res, next) {
  const gymId = req.params.gymId;
  if (!gymId) return res.status(400).json({ error: 'gymId param required' });

  const { data, error } = await supabase
    .from('gyms')
    .select('id')
    .eq('id', gymId)
    .eq('owner_id', req.user.id)
    .maybeSingle();

  if (error) return res.status(500).json({ error: error.message });
  if (!data) return res.status(403).json({ error: 'You do not own this gym' });

  next();
}

// Role check for staff-only routes — must run after `auth`.
async function requireStaffRole(req, res, next) {
  const { data, error } = await supabase
    .from('users')
    .select('role')
    .eq('id', req.user.id)
    .maybeSingle();

  if (error) return res.status(500).json({ error: error.message });
  if (!data || data.role !== 'staff') {
    return res.status(403).json({ error: 'Staff role required' });
  }

  next();
}

module.exports = { auth, requireGymOwner, requireStaffRole };
