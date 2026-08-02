const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const { auth } = require('../middleware/auth');

const router = express.Router();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

// POST /api/device-tokens
// Registers (or re-registers, if the device already had a token from a
// different user) a device for push notifications.
router.post('/', auth, async (req, res) => {
  try {
    const userId = req.userId;
    const { platform, token } = req.body || {};

    if (platform !== 'ios' && platform !== 'android') {
      return res.status(400).json({ error: "platform must be 'ios' or 'android'" });
    }
    if (typeof token !== 'string' || !token.trim()) {
      return res.status(400).json({ error: 'token is required' });
    }

    const trimmedToken = token.trim();

    // The unique constraint is on token, not (user_id, platform) — a token
    // identifies one specific app install, so re-registering under a
    // different user (device shared / re-logged-in) must move the existing
    // row, not create a duplicate. But an FCM/APNs token refresh mints a
    // brand-new token value for the *same* install, which wouldn't conflict
    // on upsert — so first drop this user's other rows for the platform
    // (their old, now-invalid tokens) before writing the new one.
    const { error: cleanupError } = await supabase
      .from('device_tokens')
      .delete()
      .eq('user_id', userId)
      .eq('platform', platform)
      .neq('token', trimmedToken);
    if (cleanupError) throw cleanupError;

    const { error } = await supabase
      .from('device_tokens')
      .upsert(
        { user_id: userId, platform, token: trimmedToken, updated_at: new Date().toISOString() },
        { onConflict: 'token' }
      );
    if (error) throw error;

    res.status(204).end();
  } catch (err) {
    console.error('POST /api/device-tokens error:', err);
    res.status(500).json({ error: err.message || 'Failed to register device token' });
  }
});

// DELETE /api/device-tokens
// Unregisters a device (called on logout) so a signed-out device stops
// receiving pushes meant for the account that just logged out.
router.delete('/', auth, async (req, res) => {
  try {
    const { token } = req.body || {};
    if (typeof token !== 'string' || !token.trim()) {
      return res.status(400).json({ error: 'token is required' });
    }

    // Scoped to the caller's own user_id — a caller can only remove a token
    // that is currently registered to their own account.
    const { error } = await supabase
      .from('device_tokens')
      .delete()
      .eq('token', token.trim())
      .eq('user_id', req.userId);
    if (error) throw error;

    res.status(204).end();
  } catch (err) {
    console.error('DELETE /api/device-tokens error:', err);
    res.status(500).json({ error: err.message || 'Failed to unregister device token' });
  }
});

module.exports = router;
