// Web Push (VAPID + RFC 8291 aes128gcm) implemented on Web Crypto.
// Encryption correctness is verified by a real device receiving a notification.

const enc = new TextEncoder();
const b64u = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes)))
  .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64u = (s) => {
  s = s.replace(/-/g, '+').replace(/_/g, '/'); s += '='.repeat((4 - s.length % 4) % 4);
  return Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
};
const concat = (...a) => {
  const len = a.reduce((n, x) => n + x.length, 0);
  const out = new Uint8Array(len); let o = 0;
  for (const x of a) { out.set(x, o); o += x.length; }
  return out;
};
const u32be = (n) => new Uint8Array([(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255]);

async function hkdf(salt, ikm, info, len) {
  const key = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, key, len * 8);
  return new Uint8Array(bits);
}

async function vapidAuthHeader(env, endpoint) {
  const aud = new URL(endpoint).origin;
  const head = b64u(enc.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const body = b64u(enc.encode(JSON.stringify({
    aud, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: env.VAPID_SUBJECT,
  })));
  const signingInput = `${head}.${body}`;
  const key = await crypto.subtle.importKey('jwk', JSON.parse(env.VAPID_PRIVATE_JWK),
    { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, enc.encode(signingInput));
  const jwt = `${signingInput}.${b64u(new Uint8Array(sig))}`;
  return `vapid t=${jwt}, k=${env.VAPID_PUBLIC}`;
}

async function encryptPayload(plaintext, p256dhB64, authB64) {
  const uaPublic = unb64u(p256dhB64);   // subscriber public key, 65 bytes
  const authSecret = unb64u(authB64);   // 16 bytes
  const salt = crypto.getRandomValues(new Uint8Array(16));

  const asKeys = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const asPublic = new Uint8Array(await crypto.subtle.exportKey('raw', asKeys.publicKey)); // 65 bytes
  const uaKey = await crypto.subtle.importKey('raw', uaPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const ecdh = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: uaKey }, asKeys.privateKey, 256));

  // RFC 8291: IKM from ECDH + auth secret
  const ikmInfo = concat(enc.encode('WebPush: info\0'), uaPublic, asPublic);
  const ikm = await hkdf(authSecret, ecdh, ikmInfo, 32);
  // RFC 8188 content keys
  const cek = await hkdf(salt, ikm, enc.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, ikm, enc.encode('Content-Encoding: nonce\0'), 12);

  const cekKey = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  const record = concat(plaintext, new Uint8Array([2])); // 0x02 = last-record delimiter
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce, tagLength: 128 }, cekKey, record));

  // aes128gcm body: salt(16) | rs(4) | idlen(1) | keyid(as public, 65) | ciphertext
  return concat(salt, u32be(4096), new Uint8Array([asPublic.length]), asPublic, cipher);
}

// Send one push. Returns {ok, status, gone} — gone=true means delete the subscription.
export async function sendPush(env, sub, payloadObj) {
  if (!env.VAPID_PRIVATE_JWK || !env.VAPID_PUBLIC) return { ok: false, status: 0, error: 'no vapid' };
  const body = await encryptPayload(enc.encode(JSON.stringify(payloadObj)), sub.p256dh, sub.auth);
  const auth = await vapidAuthHeader(env, sub.endpoint);
  const res = await fetch(sub.endpoint, {
    method: 'POST',
    headers: {
      'Authorization': auth,
      'Content-Encoding': 'aes128gcm',
      'Content-Type': 'application/octet-stream',
      'TTL': '86400',
    },
    body,
  });
  return { ok: res.ok, status: res.status, gone: res.status === 404 || res.status === 410 };
}
