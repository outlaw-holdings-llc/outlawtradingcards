import { route, json } from '../_lib.js';

// GET /api/push/config — public VAPID key for the browser to subscribe with.
export const onRequestGet = route(async ({ env }) =>
  json({ enabled: !!env.VAPID_PUBLIC, vapid_public: env.VAPID_PUBLIC || null }));
