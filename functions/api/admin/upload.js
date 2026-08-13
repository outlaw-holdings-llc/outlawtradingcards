import { route, json, err, requireAdmin, uuid } from '../_lib.js';
import { shape } from '../cards/index.js';

const MAX_BYTES = 12 * 1024 * 1024; // 12 MB per image
const OK_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

async function storeImage(env, file, cardId, side) {
  if (!file || typeof file.arrayBuffer !== 'function') return null;
  const type = file.type || 'application/octet-stream';
  if (!OK_TYPES.includes(type)) {
    throw err(`Unsupported image type "${type}" for ${side}. Use JPEG, PNG, or WEBP (not HEIC).`, 415);
  }
  const buf = await file.arrayBuffer();
  if (buf.byteLength > MAX_BYTES) throw err(`${side} image is too large (max 12 MB).`, 413);
  const ext = type.split('/')[1].replace('jpeg', 'jpg');
  const key = `cards/${cardId}/${side}.${ext}`;
  await env.IMAGES_KV.put(key, buf, { metadata: { contentType: type } });
  return `/img/${key}`;
}

// POST /api/admin/upload  (multipart/form-data)  — admin only.
// Fields: title, category, grader, grade, cert_number, tag, player, year, card_set, price, notes.
// Files:  front (required), back (optional).
// Creates a card flagged needs_review=1 so it lands in the console review queue.
export const onRequestPost = route(async ({ request, env }) => {
  await requireAdmin(request, env);

  const form = await request.formData().catch(() => null);
  if (!form) throw err('Expected multipart/form-data');

  const title = String(form.get('title') || '').trim();
  const category = String(form.get('category') || '').trim();
  if (!title) throw err('Title is required');
  if (!category) throw err('Category is required');

  const priceRaw = String(form.get('price') || '').replace(/[^0-9.]/g, '');
  const price_cents = Math.round(parseFloat(priceRaw) * 100);
  if (!Number.isFinite(price_cents) || price_cents < 0) throw err('Valid price is required');

  const id = uuid();
  const image_url = await storeImage(env, form.get('front'), id, 'front');
  const image_back_url = await storeImage(env, form.get('back'), id, 'back');
  if (!image_url) throw err('A front photo is required');

  const g = (k) => { const v = String(form.get(k) || '').trim(); return v || null; };

  await env.DB.prepare(
    `INSERT INTO cards (id,title,category,player,year,card_set,grader,grade,cert_number,
                        tag,image_url,image_back_url,price_cents,status,needs_review,notes,sort)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,1,?,100)`)
    .bind(id, title, category, g('player'), g('year'), g('card_set'), g('grader'), g('grade'),
      g('cert_number'), g('tag'), image_url, image_back_url, price_cents,
      form.get('status') ? String(form.get('status')) : 'available', g('notes'))
    .run();

  const row = await env.DB.prepare('SELECT * FROM cards WHERE id = ?').bind(id).first();
  return json({ card: shape(row) }, 201);
});
