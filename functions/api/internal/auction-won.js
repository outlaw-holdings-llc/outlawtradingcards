import { route, json, err, readJson, uuid } from '../_lib.js';
import { stripe } from '../_stripe.js';

// POST /api/internal/auction-won — called by the LiveRoom DO when an auction
// closes with a winner. Auth: Bearer AUCTION_SECRET (shared with otc-live Worker).
// Charges the winner's saved card off-session, marks the card sold, records an order.
export const onRequestPost = route(async ({ request, env }) => {
  const token = (request.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  if (!env.AUCTION_SECRET || token !== env.AUCTION_SECRET) throw err('Unauthorized', 401);

  const b = await readJson(request);
  const cardId = String(b.card_id || '');
  const userId = String(b.winner_user_id || '');
  const amount = Math.round(Number(b.amount_cents) || 0);
  if (!userId || amount < 50) throw err('Invalid auction result', 400);

  const user = await env.DB.prepare('SELECT id, email, stripe_customer_id FROM users WHERE id = ?')
    .bind(userId).first();
  if (!user) return json({ status: 'failed', error: 'winner not found' });
  if (!user.stripe_customer_id) return json({ status: 'failed', error: 'no card on file' });

  const s = stripe(env);
  // pick the customer's default card, else their first saved card
  const cust = await s.get(`/customers/${user.stripe_customer_id}`).catch(() => null);
  let pm = cust && cust.invoice_settings && cust.invoice_settings.default_payment_method;
  if (!pm) {
    const list = await s.get(`/payment_methods?customer=${user.stripe_customer_id}&type=card&limit=1`).catch(() => null);
    pm = list && list.data && list.data[0] && list.data[0].id;
  }
  if (!pm) return json({ status: 'failed', error: 'no card on file' });

  const orderId = uuid();
  const items = JSON.stringify([{ card_id: cardId, title: String(b.title || 'Live lot'), price_cents: amount }]);
  await env.DB.prepare(
    `INSERT INTO orders (id,user_id,amount_cents,status,items) VALUES (?,?,?,?,?)`)
    .bind(orderId, userId, amount, 'pending', items).run();

  let pi;
  try {
    pi = await s.post('/payment_intents', {
      amount, currency: 'usd', customer: user.stripe_customer_id,
      payment_method: pm, off_session: true, confirm: true,
      metadata: { order_id: orderId, user_id: userId, kind: 'auction', card_id: cardId },
    }, orderId);
  } catch (e) {
    await env.DB.prepare('UPDATE orders SET status=? WHERE id=?').bind('failed', orderId).run();
    return json({ status: 'failed', error: e.message || 'charge failed', order_id: orderId });
  }

  await env.DB.prepare('UPDATE orders SET stripe_payment_intent_id=? WHERE id=?').bind(pi.id, orderId).run();

  if (pi.status === 'succeeded') {
    const stmts = [env.DB.prepare("UPDATE orders SET status='paid' WHERE id=?").bind(orderId)];
    // only the reserved auction card transitions to sold (guards against a parallel sale)
    if (cardId) stmts.push(env.DB.prepare("UPDATE cards SET status='sold' WHERE id=? AND status='reserved'").bind(cardId));
    await env.DB.batch(stmts);
    return json({ status: 'paid', order_id: orderId });
  }
  // requires_action (off-session SCA) or other — leave pending for follow-up
  return json({ status: 'failed', error: `payment ${pi.status}`, order_id: orderId });
});
