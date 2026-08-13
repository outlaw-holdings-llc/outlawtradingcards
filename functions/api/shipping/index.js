import { route, json, err, readJson, requireUser, uuid } from '../_lib.js';

// GET /api/shipping — the signed-in user's shipping profiles.
export const onRequestGet = route(async ({ request, env }) => {
  const user = await requireUser(request, env);
  const { results } = await env.DB.prepare(
    'SELECT * FROM shipping_profiles WHERE user_id = ? ORDER BY is_default DESC, created_at DESC')
    .bind(user.id).all();
  return json({ shipping_profiles: results });
});

// POST /api/shipping — create a profile for the signed-in user.
export const onRequestPost = route(async ({ request, env }) => {
  const user = await requireUser(request, env);
  const b = await readJson(request);

  const req = (k) => {
    const v = String(b[k] || '').trim();
    if (!v) throw err(`${k} is required`);
    return v;
  };
  const name = req('name');
  const address1 = req('address1');
  const city = req('city');
  const state = req('state');
  const zip = req('zip');
  const country = String(b.country || 'US').trim();
  const address2 = b.address2 ? String(b.address2).trim() : null;
  const is_default = b.is_default ? 1 : 0;

  const id = uuid();
  const stmts = [];
  if (is_default) {
    stmts.push(env.DB.prepare('UPDATE shipping_profiles SET is_default = 0 WHERE user_id = ?').bind(user.id));
  }
  stmts.push(env.DB.prepare(
    `INSERT INTO shipping_profiles (id,user_id,name,address1,address2,city,state,zip,country,is_default)
     VALUES (?,?,?,?,?,?,?,?,?,?)`)
    .bind(id, user.id, name, address1, address2, city, state, zip, country, is_default));
  await env.DB.batch(stmts);

  const row = await env.DB.prepare('SELECT * FROM shipping_profiles WHERE id = ?').bind(id).first();
  return json({ shipping_profile: row }, 201);
});
