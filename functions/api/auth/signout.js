import { route, json, sha256hex, clearCookie, SESSION_COOKIE } from '../_lib.js';

export const onRequestPost = route(async ({ request, env }) => {
  const raw = request.headers.get('Cookie') || '';
  const token = raw.split(';').map((p) => p.trim())
    .find((p) => p.startsWith(SESSION_COOKIE + '='))?.slice(SESSION_COOKIE.length + 1);
  if (token) {
    await env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?')
      .bind(await sha256hex(token)).run();
  }
  return json({ ok: true }, 200, { 'Set-Cookie': clearCookie() });
});
