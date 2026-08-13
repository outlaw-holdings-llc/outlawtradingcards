import { route, json, requireUser } from '../_lib.js';
import { stripe, ensureCustomer } from '../_stripe.js';

// POST /api/stripe/setup-intent — auth. Creates a SetupIntent so the user can
// save a card on file for future (off-session) charges. No charge occurs here.
export const onRequestPost = route(async ({ request, env }) => {
  const user = await requireUser(request, env);
  const customerId = await ensureCustomer(env, user);
  const si = await stripe(env).post('/setup_intents', {
    customer: customerId,
    usage: 'off_session',
    payment_method_types: ['card'],
  });
  return json({ client_secret: si.client_secret, customer: customerId });
});
