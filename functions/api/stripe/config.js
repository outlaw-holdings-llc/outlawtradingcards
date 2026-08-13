import { route, json } from '../_lib.js';

// GET /api/stripe/config — public. The publishable key is safe to expose; the
// front-end needs it for Stripe.js. Returns enabled:false until it's set.
export const onRequestGet = route(async ({ env }) => {
  const pk = env.STRIPE_PUBLISHABLE_KEY || null;
  return json({ enabled: !!pk, publishable_key: pk });
});
