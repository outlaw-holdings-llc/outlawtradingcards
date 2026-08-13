import { route, json, err, readJson, getUser, requireAdmin, uuid } from '../_lib.js';

// Normalize a DB row into the shape the front-end expects.
export function shape(r) {
  const display_grade = !r.grader || r.grader === 'Raw' ? (r.grade || 'Raw') : `${r.grader} ${r.grade}`;
  return {
    id: r.id, title: r.title, category: r.category, cat: r.category,
    player: r.player, year: r.year, card_set: r.card_set,
    grader: r.grader, grade: display_grade, cert_number: r.cert_number,
    tag: r.tag || '', emoji: r.emoji || '🃏',
    image_url: r.image_url, image_back_url: r.image_back_url,
    price_cents: r.price_cents, price: r.price_cents / 100,
    status: r.status, sort: r.sort,
    needs_review: r.needs_review ? 1 : 0,
    notes: r.notes || '',
    ai_suggestions: r.ai_suggestions ? safeParse(r.ai_suggestions) : null,
  };
}

function safeParse(s) { try { return JSON.parse(s); } catch { return null; } }

// GET /api/cards  — public list. Admins may pass ?status=all to see everything.
export const onRequestGet = route(async ({ request, env }) => {
  const url = new URL(request.url);
  const category = url.searchParams.get('category');
  const statusParam = url.searchParams.get('status');

  const user = await getUser(request, env);
  const isAdmin = user && user.role === 'admin';

  const where = [];
  const binds = [];
  if (!isAdmin || statusParam !== 'all') {
    where.push('status = ?'); binds.push('available');
    where.push('needs_review = 0'); // hide un-reviewed uploads from the public shop
  }
  if (category && category !== 'all') { where.push('category = ?'); binds.push(category); }
  const sql = `SELECT * FROM cards ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
               ORDER BY sort ASC, created_at DESC`;
  const { results } = await env.DB.prepare(sql).bind(...binds).all();
  return json({ cards: results.map(shape) });
});

// POST /api/cards  — admin only. Create a card.
export const onRequestPost = route(async ({ request, env }) => {
  await requireAdmin(request, env);
  const b = await readJson(request);

  const title = String(b.title || '').trim();
  const category = String(b.category || b.cat || '').trim();
  if (!title) throw err('Title is required');
  if (!category) throw err('Category is required');

  let price_cents = Number.isFinite(b.price_cents) ? Math.round(b.price_cents)
    : Math.round(Number(b.price) * 100);
  if (!Number.isFinite(price_cents) || price_cents < 0) throw err('Valid price is required');

  const id = uuid();
  await env.DB.prepare(
    `INSERT INTO cards (id,title,category,player,year,card_set,grader,grade,cert_number,
                        tag,emoji,image_url,price_cents,status,sort)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .bind(id, title, category, b.player || null, b.year || null, b.card_set || null,
      b.grader || null, b.grade || null, b.cert_number || null, b.tag || null,
      b.emoji || null, b.image_url || null, price_cents,
      b.status || 'available', Number.isFinite(b.sort) ? b.sort : 100)
    .run();

  const row = await env.DB.prepare('SELECT * FROM cards WHERE id = ?').bind(id).first();
  return json({ card: shape(row) }, 201);
});
