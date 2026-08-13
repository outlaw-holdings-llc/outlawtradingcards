import { route, json, err, readJson, getUser } from '../_lib.js';

// POST /api/push/subscribe — store a browser's push subscription (upsert by endpoint).
export const onRequestPost = route(async ({ request, env }) => {
  const b = await readJson(request);
  const endpoint = String(b.endpoint || '');
  const keys = b.keys || {};
  if (!endpoint || !keys.p256dh || !keys.auth) throw err('Invalid subscription');
  const user = await getUser(request, env);
  await env.DB.prepare(
    `INSERT INTO push_subscriptions (endpoint, p256dh, auth, user_id) VALUES (?,?,?,?)
     ON CONFLICT(endpoint) DO UPDATE SET p256dh=excluded.p256dh, auth=excluded.auth, user_id=excluded.user_id`)
    .bind(endpoint, keys.p256dh, keys.auth, user ? user.id : null).run();
  return json({ ok: true });
});
