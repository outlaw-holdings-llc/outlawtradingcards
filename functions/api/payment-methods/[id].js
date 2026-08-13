import { route, json, err, requireUser } from '../_lib.js';
import { stripe } from '../_stripe.js';

async function ownedPm(env, user, pmId) {
  if (!user.stripe_customer_id) throw err('Payment method not found', 404);
  const pm = await stripe(env).get(`/payment_methods/${pmId}`).catch(() => null);
  if (!pm || pm.customer !== user.stripe_customer_id) throw err('Payment method not found', 404);
  return pm;
}

// DELETE /api/payment-methods/:id — detach a saved card from the user.
export const onRequestDelete = route(async ({ request, env, params }) => {
  const user = await requireUser(request, env);
  await ownedPm(env, user, params.id);
  await stripe(env).post(`/payment_methods/${params.id}/detach`, {});
  return json({ ok: true });
});

// PATCH /api/payment-methods/:id  {default:true} — set as the customer's default.
export const onRequestPatch = route(async ({ request, env, params }) => {
  const user = await requireUser(request, env);
  await ownedPm(env, user, params.id);
  await stripe(env).post(`/customers/${user.stripe_customer_id}`, {
    invoice_settings: { default_payment_method: params.id },
  });
  return json({ ok: true });
});
