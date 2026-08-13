import { route, json, err, readJson, requireUser } from '../_lib.js';

async function ownedProfile(env, userId, id) {
  const row = await env.DB.prepare(
    'SELECT * FROM shipping_profiles WHERE id = ? AND user_id = ?').bind(id, userId).first();
  if (!row) throw err('Shipping profile not found', 404);
  return row;
}

// PATCH /api/shipping/:id — update own profile.
export const onRequestPatch = route(async ({ request, env, params }) => {
  const user = await requireUser(request, env);
  await ownedProfile(env, user.id, params.id);
  const b = await readJson(request);

  const fields = [];
  const binds = [];
  for (const col of ['name', 'address1', 'address2', 'city', 'state', 'zip', 'country']) {
    if (b[col] !== undefined) { fields.push(`${col} = ?`); binds.push(String(b[col]).trim()); }
  }
  const stmts = [];
  if (b.is_default) {
    stmts.push(env.DB.prepare('UPDATE shipping_profiles SET is_default = 0 WHERE user_id = ?').bind(user.id));
    fields.push('is_default = ?'); binds.push(1);
  } else if (b.is_default === false) {
    fields.push('is_default = ?'); binds.push(0);
  }
  if (!fields.length) throw err('No fields to update');
  binds.push(params.id, user.id);
  stmts.push(env.DB.prepare(
    `UPDATE shipping_profiles SET ${fields.join(', ')} WHERE id = ? AND user_id = ?`).bind(...binds));
  await env.DB.batch(stmts);

  const row = await env.DB.prepare('SELECT * FROM shipping_profiles WHERE id = ?').bind(params.id).first();
  return json({ shipping_profile: row });
});

// DELETE /api/shipping/:id — delete own profile.
export const onRequestDelete = route(async ({ request, env, params }) => {
  const user = await requireUser(request, env);
  const res = await env.DB.prepare(
    'DELETE FROM shipping_profiles WHERE id = ? AND user_id = ?').bind(params.id, user.id).run();
  if (!res.meta.changes) throw err('Shipping profile not found', 404);
  return json({ ok: true });
});
