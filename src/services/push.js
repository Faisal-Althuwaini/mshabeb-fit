// Web Push sender (D16). Runs in the Node bot process (D1).
// Needs VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT in .env; without them push is a no-op.
const webpush = require('web-push');
const { getSupabase } = require('../supabase.js');

let configured = null;

function isEnabled() {
  if (configured !== null) return configured;
  const { VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT } = process.env;
  configured = !!(VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY);
  if (configured) {
    webpush.setVapidDetails(VAPID_SUBJECT || 'mailto:admin@example.com', VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
  }
  return configured;
}

/**
 * Send a notification to every subscription of the given auth users.
 * Removes subscriptions the push service reports as gone (404/410).
 * @param {string[]} authUserIds
 * @param {{title: string, body: string, url?: string, tag?: string}} payload
 * @returns {Promise<number>} number of successful deliveries
 */
async function sendToAuthUsers(authUserIds, payload) {
  const ids = [...new Set((authUserIds || []).filter(Boolean))];
  if (!isEnabled() || ids.length === 0) return 0;
  const supabase = getSupabase();
  const { data: subs, error } = await supabase
    .from('push_subscriptions')
    .select('id, endpoint, p256dh, auth')
    .in('auth_user_id', ids);
  if (error) throw error;

  let ok = 0;
  const body = JSON.stringify({ url: '/', ...payload });
  await Promise.all(
    (subs || []).map(async (s) => {
      try {
        await webpush.sendNotification(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          body,
          { TTL: 60 * 60 * 24 }
        );
        ok += 1;
      } catch (e) {
        if (e.statusCode === 404 || e.statusCode === 410) {
          await supabase.from('push_subscriptions').delete().eq('id', s.id);
        } else {
          console.error('push send error:', e.statusCode || '', e.message);
        }
      }
    })
  );
  return ok;
}

module.exports = { isEnabled, sendToAuthUsers };
