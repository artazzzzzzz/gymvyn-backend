const { requireGymOwner } = require('./auth');

// Verifies the caller is a gym owner AND owns the gym identified by
// `getGymId(req)` (a query param, body field, or URL param — per route).
// Wraps the shared requireGymOwner (which only reads req.params.gymId)
// instead of duplicating its ownership SQL across route files. Must run
// after `auth` and a middleware that populates req.profile.role (e.g. a
// route file's local withProfile).
function ownerOnly(getGymId) {
  return (req, res, next) => {
    if (req.profile.role !== 'gym_owner') {
      return res.status(403).json({ error: 'Gym owner access required' });
    }

    const gymId = getGymId(req);
    if (!gymId) return res.status(400).json({ error: 'gym_id is required' });

    req.params.gymId = gymId;
    req.gymId = gymId;
    return requireGymOwner(req, res, next);
  };
}

const gymIdFromQuery = (req) => req.query.gym_id;
const gymIdFromBody = (req) => req.body?.gym_id;
const gymIdFromParams = (req) => req.params.gymId;

module.exports = { ownerOnly, gymIdFromQuery, gymIdFromBody, gymIdFromParams };
