'use strict';
// POST /api/trainer-reviews — create or update the caller's own review for their
// active trainer. Upsert on (trainer_id, user_id): a client can revise their
// review rather than it being one-time-only (same decision as gym_reviews).
//
// Guard: the caller must have an *active* trainer-client relationship with the
// target trainer (checked via getActiveTrainerClientLink from relationshipAuth.js).
// A former client whose link was severed cannot leave or edit a review.
//
// GET /api/trainer-reviews/mine?trainerId=... — lets the client know whether
// they've already reviewed a given trainer so the form can pre-fill for editing.

const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const { auth } = require('../../middleware/auth');
const { getActiveTrainerClientLink } = require('../utils/relationshipAuth');

const router = express.Router();
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

// POST /api/trainer-reviews
router.post('/', auth, async (req, res) => {
  try {
    const rating = Number(req.body?.rating);
    const reviewText = String(
      req.body?.reviewText ?? req.body?.review_text ?? ''
    ).trim();
    const trainerId = req.body?.trainerId ?? req.body?.trainer_id;

    if (!trainerId) {
      return res.status(400).json({ error: 'trainerId is required' });
    }
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
      return res.status(400).json({ error: 'rating must be an integer from 1 to 5' });
    }
    if (!reviewText || reviewText.length > 2000) {
      return res.status(400).json({ error: 'review_text must be 1 to 2000 characters' });
    }
    // Prevent self-review
    if (trainerId === req.user.id) {
      return res.status(400).json({ error: 'You cannot review yourself' });
    }

    // Guard: must have an active trainer-client relationship
    const link = await getActiveTrainerClientLink(supabase, trainerId, req.user.id);
    if (!link) {
      return res.status(403).json({
        error: 'An active trainer-client relationship is required to leave a review',
      });
    }

    const { data, error } = await supabase
      .from('trainer_reviews')
      .upsert(
        {
          trainer_id:  trainerId,
          user_id:     req.user.id,
          rating,
          review_text: reviewText,
          updated_at:  new Date().toISOString(),
        },
        { onConflict: 'trainer_id,user_id' }
      )
      .select('id, trainer_id, user_id, rating, review_text, created_at, updated_at')
      .single();

    if (error) {
      // PGRST205 = table not in schema cache (migration not yet applied)
      if (error.code === 'PGRST205') {
        return res.status(503).json({ error: 'trainer_reviews table not yet created — run the pending migration' });
      }
      throw error;
    }
    res.status(201).json(data);
  } catch (err) {
    console.error('POST /api/trainer-reviews error:', err);
    res.status(500).json({ error: err.message || 'Failed to submit review' });
  }
});

// GET /api/trainer-reviews/mine?trainerId=...
// Returns the caller's existing review for a specific trainer, or 404 if none.
router.get('/mine', auth, async (req, res) => {
  try {
    const trainerId = req.query.trainerId ?? req.query.trainer_id;
    if (!trainerId) {
      return res.status(400).json({ error: 'trainerId query param is required' });
    }

    // Guard: must have an active trainer-client relationship
    const link = await getActiveTrainerClientLink(supabase, trainerId, req.user.id);
    if (!link) {
      return res.status(403).json({
        error: 'An active trainer-client relationship is required',
      });
    }

    const { data, error } = await supabase
      .from('trainer_reviews')
      .select('id, trainer_id, user_id, rating, review_text, created_at, updated_at')
      .eq('trainer_id', trainerId)
      .eq('user_id', req.user.id)
      .maybeSingle();

    if (error) {
      if (error.code === 'PGRST205') {
        return res.status(503).json({ error: 'trainer_reviews table not yet created — run the pending migration' });
      }
      throw error;
    }
    if (!data) return res.status(404).json({ error: 'No review yet' });
    res.json(data);
  } catch (err) {
    console.error('GET /api/trainer-reviews/mine error:', err);
    res.status(500).json({ error: err.message || 'Failed to load review' });
  }
});

module.exports = router;
