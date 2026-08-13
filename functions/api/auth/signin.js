import { route, json, err, readJson, verifyPassword, newSessionToken, sha256hex,
         sessionCookie, SESSION_DAYS } from '../_lib.js';

export const onRequestPost = route(async ({ request, env }) => {
  const body = await readJson(request);
  const email = String(body.email || '').trim().toLowerCase();
  const password = String(body.password || '');

  const user = await env.DB.prepare(
    'SELECT id, email, display_name, role, password_hash FROM users WHERE email = ?')
    .bind(email).first();

  // Same message + a hash check either way to avoid leaking which emails exist.
  const ok = user && await verifyPassword(password, user.password_hash);
  if (!ok) throw err('Incorrect email or password', 401);

  const token = newSessionToken();
  const expires = new Date(Date.now() + SESSION_DAYS * 86400 * 1000).toISOString().replace('T', ' ').slice(0, 19);
  await env.DB.prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)')
    .bind(await sha256hex(token), user.id, expires).run();

  return json(
    { user: { id: user.id, email: user.email, display_name: user.display_name, role: user.role } },
    200, { 'Set-Cookie': sessionCookie(token) });
});
