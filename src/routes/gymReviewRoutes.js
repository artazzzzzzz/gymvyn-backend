const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const { auth } = require('../../middleware/auth');

const router = express.Router();
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

// Resolves the caller's own current gym via their active membership. Never
// trust a client-supplied gym_id for this endpoint -- gym_memberships is the
// source of truth for "who is actually a member of which gym" (same rule
// GET /api/my-gym/:userId and requireGymMembership in gymFeedRoutes.js
// already follow), so there is no gym_id input to tamper with in the first
// place.
async function getActiveMembershipGymId(userId) {
  const { data, error } = await supabase
    .from('gym_memberships')
    .select('gym_id')
    .eq('user_id', userId)
    .eq('status', 'active')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data?.gym_id || null;
}

// POST /api/gym-reviews — create or update the caller's own review for
// their current gym. Upsert on (gym_id, user_id): a member can revise their
// review later rather than this being one-time-only.
router.post('/', auth, async (req, res) => {
  try {
    const rating = Number(req.body?.rating);
    const reviewText = String(req.body?.reviewText ?? req.body?.review_text ?? '').trim();
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
      return res.status(400).json({ error: 'rating must be an integer from 1 to 5' });
    }
    if (!reviewText || reviewText.length > 2000) {
      return res.status(400).json({ error: 'review_text must be 1 to 2000 characters' });
    }

    const gymId = await getActiveMembershipGymId(req.user.id);
    if (!gymId) return res.status(403).json({ error: 'An active gym membership is required to leave a review' });

    const { data, error } = await supabase
      .from('gym_reviews')
      .upsert(
        { gym_id: gymId, user_id: req.user.id, rating, review_text: reviewText, updated_at: new Date().toISOString() },
        { onConflict: 'gym_id,user_id' }
      )
      .select('id, gym_id, rating, review_text, created_at, updated_at')
      .single();
    if (error) throw error;
    res.status(201).json(data);
  } catch (err) {
    console.error('POST /api/gym-reviews error:', err);
    res.status(500).json({ error: err.message || 'Failed to submit review' });
  }
});

// GET /api/gym-reviews/mine — lets the member's own client know whether
// they've already reviewed their current gym (and what they wrote), so the
// submission form can pre-fill for editing instead of silently duplicating
// on next open. Mirrors GET /api/plans/purchases/:purchaseId/review.
router.get('/mine', auth, async (req, res) => {
  try {
    const gymId = await getActiveMembershipGymId(req.user.id);
    if (!gymId) return res.status(404).json({ error: 'No active gym membership found' });

    const { data, error } = await supabase
      .from('gym_reviews')
      .select('id, gym_id, rating, review_text, created_at, updated_at')
      .eq('gym_id', gymId)
      .eq('user_id', req.user.id)
      .maybeSingle();
    if (error) throw error;
    if (!data) return res.status(404).json({ error: 'No review yet' });
    res.json(data);
  } catch (err) {
    console.error('GET /api/gym-reviews/mine error:', err);
    res.status(500).json({ error: err.message || 'Failed to load review' });
  }
});

module.exports = router;
