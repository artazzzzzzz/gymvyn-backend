const express = require('express');

const router = express.Router();

// GET /api/xp/profile — get user's XP profile
router.get('/profile', (req, res) => {
  res.status(501).json({ message: 'Not implemented' });
});

// GET /api/xp/events — get user's XP event history (paginated)
router.get('/events', (req, res) => {
  res.status(501).json({ message: 'Not implemented' });
});

// GET /api/xp/leaderboard/:type — type is 'gym' or 'global'
router.get('/leaderboard/:type', (req, res) => {
  res.status(501).json({ message: 'Not implemented' });
});

// POST /api/xp/freeze — use a streak freeze
router.post('/freeze', (req, res) => {
  res.status(501).json({ message: 'Not implemented' });
});

// GET /api/xp/challenges — get current week's challenges
router.get('/challenges', (req, res) => {
  res.status(501).json({ message: 'Not implemented' });
});

// GET /api/xp/muscle-balance — get 7-day muscle group coverage
router.get('/muscle-balance', (req, res) => {
  res.status(501).json({ message: 'Not implemented' });
});

// GET /api/xp/season — get current active season info
router.get('/season', (req, res) => {
  res.status(501).json({ message: 'Not implemented' });
});

module.exports = router;
