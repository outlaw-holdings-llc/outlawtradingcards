import { json } from '../_lib.js';

// POST /api/stripe/webhook — Stripe events. Finalizes orders that complete via
// 3-D Secure and reconciles failures. Verifies the signature when a webhook
// secret is configured (env.STRIPE_WEBHOOK_SECRET, "whsec_...").
export async function onRequestPost({ request, env }) {
  const raw = await request.text();
  const sig = request.headers.get('Stripe-Signature') || '';
  const secret = env.STRIPE_WEBHOOK_SECRET;

  if (secret) {
    const ok = await verify(raw, sig, secret);
    if (!ok) return json({ error: 'Bad signature' }, 400);
  }

  let event;
  try { event = JSON.parse(raw); } catch { return json({ error: 'Bad payload' }, 400); }

  try {
    const pi = event.data && event.data.object;
    if (event.type === 'payment_intent.succeeded' && pi) {
      const orderId = pi.metadata && pi.metadata.order_id;
      if (orderId) await finalizePaid(env, orderId);
    } else if (event.type === 'payment_intent.payment_failed' && pi) {
      const orderId = pi.metadata && pi.metadata.order_id;
      if (orderId) {
        await env.DB.prepare("UPDATE orders SET status='failed' WHERE id=? AND status='pending'")
          .bind(orderId).run();
      }
    }
  } catch (e) {
    return json({ received: true, note: 'handler error: ' + String(e.message || e) }, 200);
  }
  return json({ received: true });
}

async function finalizePaid(env, orderId) {
  const order = await env.DB.prepare('SELECT id, status, items FROM orders WHERE id = ?')
    .bind(orderId).first();
  if (!order || order.status === 'paid') return; // idempotent
  const items = safeParse(order.items) || [];
  const stmts = [env.DB.prepare("UPDATE orders SET status='paid' WHERE id=?").bind(orderId)];
  for (const it of items) {
    if (it.card_id) stmts.push(env.DB.prepare("UPDATE cards SET status='sold' WHERE id=?").bind(it.card_id));
  }
  await env.DB.batch(stmts);
}

function safeParse(s) { try { return JSON.parse(s); } catch { return null; } }

// Verify Stripe's HMAC-SHA256 signature (scheme v1) with a 5-minute tolerance.
async function verify(payload, header, secret) {
  const parts = Object.fromEntries(header.split(',').map((p) => p.split('=')));
  const t = parts.t, v1 = parts.v1;
  if (!t || !v1) return false;
  if (Math.abs(Date.now() / 1000 - Number(t)) > 300) return false;

  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${t}.${payload}`));
  const expected = [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, '0')).join('');
  // constant-time-ish compare
  if (expected.length !== v1.length) return false;
  let out = 0;
  for (let i = 0; i < expected.length; i++) out |= expected.charCodeAt(i) ^ v1.charCodeAt(i);
  return out === 0;
}
