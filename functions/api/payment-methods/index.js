import { route, json, requireUser } from '../_lib.js';
import { stripe } from '../_stripe.js';

// GET /api/payment-methods — auth. The signed-in user's saved cards.
export const onRequestGet = route(async ({ request, env }) => {
  const user = await requireUser(request, env);
  if (!user.stripe_customer_id) return json({ payment_methods: [] });

  const s = stripe(env);
  const cust = await s.get(`/customers/${user.stripe_customer_id}`);
  const defaultPm = cust.invoice_settings && cust.invoice_settings.default_payment_method;
  const list = await s.get(`/payment_methods?customer=${user.stripe_customer_id}&type=card&limit=20`);

  const payment_methods = (list.data || []).map((pm) => ({
    id: pm.id,
    brand: pm.card.brand,
    last4: pm.card.last4,
    exp_month: pm.card.exp_month,
    exp_year: pm.card.exp_year,
    is_default: pm.id === defaultPm,
  }));
  return json({ payment_methods });
});
