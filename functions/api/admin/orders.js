import { route, json, requireAdmin } from '../_lib.js';

// GET /api/admin/orders — all orders with buyer + ship-to, for fulfillment.
export const onRequestGet = route(async ({ request, env }) => {
  await requireAdmin(request, env);
  const { results } = await env.DB.prepare(
    `SELECT o.id, o.amount_cents, o.status, o.items, o.created_at, o.stripe_payment_intent_id,
            u.email AS buyer_email, u.display_name AS buyer_name,
            s.name AS ship_name, s.address1, s.address2, s.city, s.state, s.zip, s.country
       FROM orders o
       JOIN users u ON u.id = o.user_id
       LEFT JOIN shipping_profiles s ON s.id = o.shipping_profile_id
      ORDER BY o.created_at DESC`).all();
  return json({ orders: results.map((o) => ({ ...o, items: safeParse(o.items) || [] })) });
});

function safeParse(s) { try { return JSON.parse(s); } catch { return null; } }
