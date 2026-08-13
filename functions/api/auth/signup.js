import { route, json, err, readJson, hashPassword, newSessionToken, sha256hex,
         sessionCookie, uuid, SESSION_DAYS } from '../_lib.js';

export const onRequestPost = route(async ({ request, env }) => {
  const body = await readJson(request);
  const email = String(body.email || '').trim().toLowerCase();
  const display_name = String(body.display_name || body.name || '').trim();
  const password = String(body.password || '');

  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw err('Enter a valid email');
  if (display_name.length < 2) throw err('Display name is too short');
  if (password.length < 8) throw err('Password must be at least 8 characters');

  const existing = await env.DB.prepare('SELECT id FROM users WHERE email = ?').bind(email).first();
  if (existing) throw err('An account with that email already exists', 409);

  const id = uuid();
  const password_hash = await hashPassword(password);
  await env.DB.prepare(
    'INSERT INTO users (id, email, display_name, password_hash) VALUES (?, ?, ?, ?)')
    .bind(id, email, display_name, password_hash).run();

  const token = newSessionToken();
  const expires = new Date(Date.now() + SESSION_DAYS * 86400 * 1000).toISOString().replace('T', ' ').slice(0, 19);
  await env.DB.prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)')
    .bind(await sha256hex(token), id, expires).run();

  return json({ user: { id, email, display_name, role: 'user' } }, 201,
    { 'Set-Cookie': sessionCookie(token) });
});
