'use strict';

// Push dispatch for chat and class-booking/waitlist events only — marketplace
// notifications are explicitly out of scope (that feature is being rebuilt as
// an external site with no event model yet).
//
// Unlike other required-env checks in this codebase (e.g. GEMINI_API_KEY),
// this module does NOT throw at load time if FCM/APNs credentials are
// missing. Push is an enhancement on top of already-working chat/booking
// features, not a dependency of them — a missing credential should silently
// disable push, not take down the whole server. Call sites must always
// invoke sendPushToUser fire-and-forget (`.catch(...)`), never await it in a
// way that would fail the underlying request.

const { createClient } = require('@supabase/supabase-js');

let firebaseApp = null;
function getFirebaseApp() {
  if (firebaseApp) return firebaseApp;
  if (!process.env.FCM_SERVICE_ACCOUNT_JSON) return null;
  try {
    const admin = require('firebase-admin');
    const credentials = JSON.parse(process.env.FCM_SERVICE_ACCOUNT_JSON);
    firebaseApp = admin.apps.length
      ? admin.app()
      : admin.initializeApp({ credential: admin.credential.cert(credentials) });
    return firebaseApp;
  } catch (err) {
    console.error('[notificationService] Failed to initialize Firebase Admin (FCM disabled):', err.message);
    return null;
  }
}

let apnProvider = null;
let apnProviderAttempted = false;
function getApnProvider() {
  if (apnProviderAttempted) return apnProvider;
  apnProviderAttempted = true;
  const { APNS_KEY, APNS_KEY_ID, APNS_TEAM_ID } = process.env;
  if (!APNS_KEY || !APNS_KEY_ID || !APNS_TEAM_ID) return null;
  try {
    const apn = require('@parse/node-apn');
    apnProvider = new apn.Provider({
      token: {
        key: APNS_KEY,
        keyId: APNS_KEY_ID,
        teamId: APNS_TEAM_ID,
      },
      production: process.env.APNS_PRODUCTION === 'true',
    });
    return apnProvider;
  } catch (err) {
    console.error('[notificationService] Failed to initialize APNs provider (iOS push disabled):', err.message);
    return null;
  }
}

async function removeToken(supabase, token) {
  await supabase.from('device_tokens').delete().eq('token', token);
}

async function sendToAndroidTokens(supabase, tokens, { title, body, data }) {
  const app = getFirebaseApp();
  if (!app || tokens.length === 0) return;
  const admin = require('firebase-admin');
  const messages = tokens.map(token => ({
    token,
    notification: { title, body },
    data: data ? Object.fromEntries(Object.entries(data).map(([k, v]) => [k, String(v)])) : undefined,
  }));

  const results = await Promise.allSettled(
    messages.map(msg => admin.messaging(app).send(msg))
  );

  await Promise.all(results.map(async (result, i) => {
    if (result.status !== 'rejected') return;
    const code = result.reason?.code || '';
    if (code === 'messaging/registration-token-not-registered' || code === 'messaging/invalid-registration-token') {
      await removeToken(supabase, tokens[i]);
    } else {
      console.error('[notificationService] FCM send failed:', result.reason?.message || result.reason);
    }
  }));
}

async function sendToIosTokens(supabase, tokens, { title, body, data }) {
  const provider = getApnProvider();
  if (!provider || tokens.length === 0) return;
  const apn = require('@parse/node-apn');

  const bundleId = process.env.APNS_BUNDLE_ID;
  const notification = new apn.Notification();
  notification.alert = { title, body };
  notification.topic = bundleId;
  notification.payload = data || {};

  const result = await provider.send(notification, tokens);

  await Promise.all((result.failed || []).map(async (failure) => {
    const reason = failure.response?.reason;
    if (reason === 'BadDeviceToken' || reason === 'Unregistered') {
      await removeToken(supabase, failure.device);
    } else {
      console.error('[notificationService] APNs send failed:', reason || failure.error?.message);
    }
  }));
}

// Sends a push to every device registered for userId. Never throws — logs
// and returns on any failure so a push problem can never break the caller's
// underlying request (message send, booking, etc).
async function sendPushToUser(supabase, userId, { title, body, data } = {}) {
  try {
    if (!userId || !title || !body) return;
    if (!getFirebaseApp() && !getApnProvider()) return; // no creds configured yet

    const { data: tokenRows, error } = await supabase
      .from('device_tokens')
      .select('platform, token')
      .eq('user_id', userId);
    if (error) throw error;
    if (!tokenRows || tokenRows.length === 0) return;

    const androidTokens = tokenRows.filter(r => r.platform === 'android').map(r => r.token);
    const iosTokens = tokenRows.filter(r => r.platform === 'ios').map(r => r.token);

    await Promise.all([
      sendToAndroidTokens(supabase, androidTokens, { title, body, data }),
      sendToIosTokens(supabase, iosTokens, { title, body, data }),
    ]);
  } catch (err) {
    console.error('[notificationService] sendPushToUser failed:', err.message);
  }
}

module.exports = { sendPushToUser };
