import { route, json, err, readJson, requireUser, uuid } from './_lib.js';
import { stripe, ensureCustomer } from './_stripe.js';

// POST /api/checkout — auth. Charge the user's saved card for the given cards.
// Body: { card_ids: [...], payment_method_id, shipping_profile_id? }
// Prices are recomputed server-side from the DB — never trusted from the client.
export const onRequestPost = route(async ({ request, env }) => {
  const user = await requireUser(request, env);
  const body = await readJson(request);

  const cardIds = Array.isArray(body.card_ids) ? [...new Set(body.card_ids.map(String))] : [];
  const paymentMethodId = String(body.payment_method_id || '');
  if (!cardIds.length) throw err('Your cart is empty');
  if (!paymentMethodId) throw err('Choose a payment method');

  // Load + validate the cards (must be available and published).
  const placeholders = cardIds.map(() => '?').join(',');
  const { results: cards } = await env.DB.prepare(
    `SELECT id, title, price_cents, status, needs_review FROM cards WHERE id IN (${placeholders})`)
    .bind(...cardIds).all();
  if (cards.length !== cardIds.length) throw err('One or more cards are no longer listed', 409);
  for (const c of cards) {
    if (c.status !== 'available' || c.needs_review) throw err(`"${c.title}" is no longer available`, 409);
  }
  const amount = cards.reduce((s, c) => s + c.price_cents, 0);
  if (amount < 50) throw err('Order total is below the $0.50 minimum', 400);

  // Validate shipping profile ownership if provided.
  let shippingId = null;
  if (body.shipping_profile_id) {
    const sp = await env.DB.prepare(
      'SELECT id FROM shipping_profiles WHERE id = ? AND user_id = ?')
      .bind(body.shipping_profile_id, user.id).first();
    if (!sp) throw err('Invalid shipping address', 400);
    shippingId = sp.id;
  }

  const customerId = await ensureCustomer(env, user);
  const orderId = uuid();
  const items = cards.map((c) => ({ card_id: c.id, title: c.title, price_cents: c.price_cents }));

  // Record a pending order first (id doubles as the idempotency key).
  await env.DB.prepare(
    `INSERT INTO orders (id,user_id,amount_cents,status,shipping_profile_id,items)
     VALUES (?,?,?,?,?,?)`)
    .bind(orderId, user.id, amount, 'pending', shippingId, JSON.stringify(items)).run();

  let pi;
  try {
    pi = await stripe(env).post('/payment_intents', {
      amount, currency: 'usd', customer: customerId,
      payment_method: paymentMethodId,
      payment_method_types: ['card'],
      confirm: true,
      metadata: { order_id: orderId, user_id: user.id },
    }, orderId);
  } catch (e) {
    await env.DB.prepare('UPDATE orders SET status = ? WHERE id = ?').bind('failed', orderId).run();
    throw err(e.message || 'Payment failed', 402);
  }

  await env.DB.prepare('UPDATE orders SET stripe_payment_intent_id = ? WHERE id = ?')
    .bind(pi.id, orderId).run();

  if (pi.status === 'succeeded') {
    await markPaid(env, orderId, cardIds);
    return json({ status: 'paid', order_id: orderId });
  }
  if (pi.status === 'requires_action' || pi.status === 'requires_confirmation') {
    // Front-end completes 3-D Secure with this client secret; webhook finalizes.
    return json({ status: 'requires_action', order_id: orderId, client_secret: pi.client_secret });
  }
  await env.DB.prepare('UPDATE orders SET status = ? WHERE id = ?').bind('failed', orderId).run();
  throw err(`Payment ${pi.status}`, 402);
});

async function markPaid(env, orderId, cardIds) {
  const stmts = [env.DB.prepare('UPDATE orders SET status = ? WHERE id = ?').bind('paid', orderId)];
  for (const id of cardIds) {
    stmts.push(env.DB.prepare("UPDATE cards SET status = 'sold' WHERE id = ?").bind(id));
  }
  await env.DB.batch(stmts);
}
