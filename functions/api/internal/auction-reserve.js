import { route, json, err, readJson } from '../_lib.js';

// POST /api/internal/auction-reserve — called by the LiveRoom DO when an auction
// starts. Atomically takes the card off the shop (available -> reserved) so it
// can't be Buy-Now'd mid-auction. Bearer AUCTION_SECRET.
export const onRequestPost = route(async ({ request, env }) => {
  const token = (request.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  if (!env.AUCTION_SECRET || token !== env.AUCTION_SECRET) throw err('Unauthorized', 401);

  const b = await readJson(request);
  const cardId = String(b.card_id || '');
  if (!cardId) return json({ ok: false, error: 'no card' });

  const res = await env.DB.prepare(
    "UPDATE cards SET status='reserved' WHERE id=? AND status='available' AND needs_review=0")
    .bind(cardId).run();
  if (!res.meta.changes) return json({ ok: false, error: 'card is not available' });

  const c = await env.DB.prepare(
    'SELECT title, image_url, price_cents FROM cards WHERE id=?').bind(cardId).first();
  return json({ ok: true, title: c.title, image: c.image_url, price_cents: c.price_cents });
});
