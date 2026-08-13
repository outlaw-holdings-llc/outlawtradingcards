import { route, json, err, readJson } from '../_lib.js';

// POST /api/internal/auction-release — DO calls this when an auction ends with no
// sale (or is cancelled). Puts the card back on the shop. Bearer AUCTION_SECRET.
export const onRequestPost = route(async ({ request, env }) => {
  const token = (request.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  if (!env.AUCTION_SECRET || token !== env.AUCTION_SECRET) throw err('Unauthorized', 401);
  const b = await readJson(request);
  const cardId = String(b.card_id || '');
  if (cardId) {
    await env.DB.prepare("UPDATE cards SET status='available' WHERE id=? AND status='reserved'")
      .bind(cardId).run();
  }
  return json({ ok: true });
});
