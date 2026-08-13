import { route, json, err, readJson, uuid } from './_lib.js';
import { shape } from './cards/index.js';

// POST /api/ingest — machine ingestion (the Drive->AI pipeline). Auth: a shared
// bearer token (Pages secret INGEST_TOKEN), NOT a user session. Creates a card
// in the review queue (needs_review=1) with photos + AI classification/pricing.
export const onRequestPost = route(async ({ request, env }) => {
  const token = (request.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  if (!env.INGEST_TOKEN || token !== env.INGEST_TOKEN) throw err('Unauthorized', 401);

  const b = await readJson(request);
  const title = String(b.title || '').trim();
  const category = String(b.category || 'Other').trim();
  if (!title) throw err('title required');

  let price_cents = Number.isFinite(b.price_cents) ? Math.round(b.price_cents)
    : (b.price != null ? Math.round(Number(b.price) * 100) : 0);
  if (!Number.isFinite(price_cents) || price_cents < 0) price_cents = 0;

  const id = uuid();
  const image_url = await storeB64(env, b.front_b64, b.front_type, id, 'front');
  const image_back_url = await storeB64(env, b.back_b64, b.back_type, id, 'back');

  const ai = b.ai_suggestions ? (typeof b.ai_suggestions === 'string' ? b.ai_suggestions : JSON.stringify(b.ai_suggestions)) : null;
  const g = (k) => { const v = b[k]; return v == null || v === '' ? null : String(v); };

  await env.DB.prepare(
    `INSERT INTO cards (id,title,category,player,year,card_set,grader,grade,cert_number,
                        tag,image_url,image_back_url,price_cents,status,needs_review,notes,ai_suggestions,sort)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,1,?,?,100)`)
    .bind(id, title, category, g('player'), g('year'), g('card_set'), g('grader'), g('grade'),
      g('cert_number'), g('tag'), image_url, image_back_url, price_cents, 'available', g('notes'), ai)
    .run();

  const row = await env.DB.prepare('SELECT * FROM cards WHERE id = ?').bind(id).first();
  return json({ card: shape(row) }, 201);
});

async function storeB64(env, b64, type, cardId, side) {
  if (!b64) return null;
  const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  const ct = type || 'image/jpeg';
  const ext = ct.split('/')[1].replace('jpeg', 'jpg');
  const key = `cards/${cardId}/${side}.${ext}`;
  await env.IMAGES_KV.put(key, bytes, { metadata: { contentType: ct } });
  return `/img/${key}`;
}
