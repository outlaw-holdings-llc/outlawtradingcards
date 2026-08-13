import { route, json, err, readJson, getUser, requireAdmin } from '../_lib.js';
import { shape } from './index.js';

// GET /api/cards/:id — public (available), admin sees any.
export const onRequestGet = route(async ({ request, env, params }) => {
  const row = await env.DB.prepare('SELECT * FROM cards WHERE id = ?').bind(params.id).first();
  if (!row) throw err('Card not found', 404);
  const user = await getUser(request, env);
  const isAdmin = user && user.role === 'admin';
  if ((row.status !== 'available' || row.needs_review) && !isAdmin) throw err('Card not found', 404);
  return json({ card: shape(row) });
});

// PATCH /api/cards/:id — admin only. Partial update.
export const onRequestPatch = route(async ({ request, env, params }) => {
  await requireAdmin(request, env);
  const existing = await env.DB.prepare('SELECT id FROM cards WHERE id = ?').bind(params.id).first();
  if (!existing) throw err('Card not found', 404);
  const b = await readJson(request);

  const fields = [];
  const binds = [];
  const set = (col, val) => { fields.push(`${col} = ?`); binds.push(val); };

  if (b.title !== undefined) set('title', String(b.title).trim());
  if (b.category !== undefined || b.cat !== undefined) set('category', String(b.category ?? b.cat).trim());
  for (const col of ['player', 'year', 'card_set', 'grader', 'grade', 'cert_number', 'tag',
                     'emoji', 'image_url', 'image_back_url', 'status', 'notes']) {
    if (b[col] !== undefined) set(col, b[col]);
  }
  if (b.price_cents !== undefined) set('price_cents', Math.round(Number(b.price_cents)));
  else if (b.price !== undefined) set('price_cents', Math.round(Number(b.price) * 100));
  if (b.sort !== undefined) set('sort', Number(b.sort));
  if (b.needs_review !== undefined) set('needs_review', b.needs_review ? 1 : 0);
  if (b.ai_suggestions !== undefined) {
    set('ai_suggestions', b.ai_suggestions == null ? null
      : (typeof b.ai_suggestions === 'string' ? b.ai_suggestions : JSON.stringify(b.ai_suggestions)));
  }

  if (!fields.length) throw err('No fields to update');
  binds.push(params.id);
  await env.DB.prepare(`UPDATE cards SET ${fields.join(', ')} WHERE id = ?`).bind(...binds).run();

  const row = await env.DB.prepare('SELECT * FROM cards WHERE id = ?').bind(params.id).first();
  return json({ card: shape(row) });
});

// DELETE /api/cards/:id — admin only. Also removes the card's photos from KV.
export const onRequestDelete = route(async ({ request, env, params }) => {
  await requireAdmin(request, env);
  const row = await env.DB.prepare('SELECT image_url, image_back_url FROM cards WHERE id = ?')
    .bind(params.id).first();
  if (!row) throw err('Card not found', 404);

  for (const url of [row.image_url, row.image_back_url]) {
    if (url && url.startsWith('/img/')) {
      await env.IMAGES_KV.delete(url.slice('/img/'.length)).catch(() => {});
    }
  }
  await env.DB.prepare('DELETE FROM cards WHERE id = ?').bind(params.id).run();
  return json({ ok: true });
});
