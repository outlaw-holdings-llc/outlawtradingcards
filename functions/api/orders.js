import { route, json, requireUser } from './_lib.js';

// GET /api/orders — the signed-in user's order history.
export const onRequestGet = route(async ({ request, env }) => {
  const user = await requireUser(request, env);
  const { results } = await env.DB.prepare(
    `SELECT id, amount_cents, currency, status, items, created_at
       FROM orders WHERE user_id = ? ORDER BY created_at DESC`).bind(user.id).all();
  return json({ orders: results.map((o) => ({ ...o, items: safeParse(o.items) || [] })) });
});

function safeParse(s) { try { return JSON.parse(s); } catch { return null; } }
