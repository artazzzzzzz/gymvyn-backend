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

// Role check for trainer-only routes — must run after `auth`.
async function requireTrainerRole(req, res, next) {
  const { data, error } = await supabase
    .from('users')
    .select('role')
    .eq('id', req.user.id)
    .maybeSingle();

  if (error) return res.status(500).json({ error: error.message });
  if (!data || data.role !== 'trainer') {
    return res.status(403).json({ error: 'Trainer role required' });
  }

  next();
}

// Gates internal /api/admin/* superadmin routes on a comma-separated email
// allowlist (ADMIN_EMAILS). Must run after `auth`. Fails closed: an unset or
// empty allowlist rejects every request rather than allowing all, since a
// misconfigured env almost certainly means "not set up yet", not "open".
function requireAdmin(req, res, next) {
  const raw = String(process.env.ADMIN_EMAILS || '').trim();
  if (!raw) {
    console.warn('ADMIN_EMAILS is not configured -- rejecting all /api/admin requests');
    return res.status(403).json({ error: 'Admin access is not configured' });
  }
  const allowlist = raw.split(',').map((email) => email.trim().toLowerCase()).filter(Boolean);
  const callerEmail = String(req.user?.email || '').toLowerCase();
  if (!callerEmail || !allowlist.includes(callerEmail)) return res.status(403).json({ error: 'Admin access required' });
  next();
}

module.exports = { auth, requireGymOwner, requireStaffRole, requireTrainerRole, requireAdmin };
