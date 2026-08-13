// Shared helpers for OutlawTradingCards API (Cloudflare Pages Functions + D1).
// Files/dirs prefixed with "_" are not routed, but are importable by sibling routes.

export const SESSION_COOKIE = 'otc_session';
export const SESSION_DAYS = 30;

export const json = (data, status = 200, headers = {}) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...headers },
  });

export const err = (message, status = 400) => json({ error: message }, status);

// ---- base64 (standard) ----
const b64 = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes)));
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const b64url = (bytes) => b64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

// ---- password hashing: PBKDF2-SHA256, 100k iters, 16-byte salt ----
export async function hashPassword(password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const bits = await pbkdf2(password, salt, 100000);
  return `pbkdf2$100000$${b64(salt)}$${b64(bits)}`;
}

export async function verifyPassword(password, stored) {
  const parts = String(stored || '').split('$');
  if (parts.length !== 4 || parts[0] !== 'pbkdf2') return false;
  const iterations = parseInt(parts[1], 10);
  const salt = unb64(parts[2]);
  const bits = await pbkdf2(password, salt, iterations);
  return timingSafeEqual(b64(bits), parts[3]);
}

async function pbkdf2(password, salt, iterations) {
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' }, key, 256);
  return new Uint8Array(bits);
}

function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let out = 0;
  for (let i = 0; i < a.length; i++) out |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return out === 0;
}

// ---- sessions ----
export function newSessionToken() {
  return b64url(crypto.getRandomValues(new Uint8Array(32)));
}

export async function sha256hex(str) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
  return [...new Uint8Array(digest)].map((x) => x.toString(16).padStart(2, '0')).join('');
}

export function sessionCookie(token, maxAgeSeconds = SESSION_DAYS * 86400) {
  return `${SESSION_COOKIE}=${token}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${maxAgeSeconds}`;
}
export const clearCookie = () =>
  `${SESSION_COOKIE}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`;

function readCookie(request, name) {
  const raw = request.headers.get('Cookie') || '';
  for (const part of raw.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return v.join('=');
  }
  return null;
}

// Returns the authenticated user row, or null. Prunes expired sessions lazily.
export async function getUser(request, env) {
  const token = readCookie(request, SESSION_COOKIE);
  if (!token) return null;
  const th = await sha256hex(token);
  const row = await env.DB.prepare(
    `SELECT u.id, u.email, u.display_name, u.role, u.stripe_customer_id, s.expires_at
       FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = ?`).bind(th).first();
  if (!row) return null;
  if (new Date(row.expires_at + 'Z') < new Date()) {
    await env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(th).run();
    return null;
  }
  return {
    id: row.id, email: row.email, display_name: row.display_name,
    role: row.role, stripe_customer_id: row.stripe_customer_id,
  };
}

export async function requireUser(request, env) {
  const user = await getUser(request, env);
  if (!user) throw json({ error: 'Not signed in' }, 401);
  return user;
}

export async function requireAdmin(request, env) {
  const user = await requireUser(request, env);
  if (user.role !== 'admin') throw json({ error: 'Admin only' }, 403);
  return user;
}

export function uuid() {
  return crypto.randomUUID();
}

// Parse + guard a JSON body.
export async function readJson(request) {
  try { return await request.json(); }
  catch { throw err('Invalid JSON body', 400); }
}

// Wrap a handler so thrown Response objects (from require* guards / err) become
// the actual response, and unexpected errors become a clean 500.
export function route(handler) {
  return async (context) => {
    try { return await handler(context); }
    catch (e) {
      if (e instanceof Response) return e;
      const status = e && Number.isInteger(e.status) ? e.status : 500;
      return json({ error: (e && e.message) || 'Server error' }, status);
    }
  };
}
