// Cloudflare Stream Live client. Uses a Stream-scoped token (Pages secret
// STREAM_API_TOKEN) + CF_ACCOUNT_ID. Throws 503 until streaming is configured.
export function stream(env) {
  const token = env.STREAM_API_TOKEN;
  const acct = env.CF_ACCOUNT_ID;
  if (!token || !acct) {
    const e = new Error('Live streaming is not configured yet (enable Cloudflare Stream + set STREAM_API_TOKEN).');
    e.status = 503;
    throw e;
  }
  const base = `https://api.cloudflare.com/client/v4/accounts/${acct}/stream`;
  const call = async (method, path, body) => {
    const r = await fetch(base + path, {
      method,
      headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok || !d.success) {
      const msg = (d.errors && d.errors[0] && d.errors[0].message) || `Stream API error ${r.status}`;
      const e = new Error(msg);
      e.status = r.status;
      throw e;
    }
    return d.result;
  };
  return {
    createLiveInput: (name) => call('POST', '/live_inputs', {
      meta: { name }, recording: { mode: 'automatic', timeoutSeconds: 10 },
    }),
    getLiveInput: (uid) => call('GET', '/live_inputs/' + uid),
    deleteLiveInput: (uid) => call('DELETE', '/live_inputs/' + uid),
  };
}

// Public HLS/iframe playback for a live input uid (no secret exposed).
// Uses this account's Stream subdomain (canonical for live playback).
const STREAM_SUBDOMAIN = 'customer-cg6igngzsjy7wotl';
export function playbackFor(uid) {
  return {
    uid,
    iframe: `https://${STREAM_SUBDOMAIN}.cloudflarestream.com/${uid}/iframe`,
    hls: `https://${STREAM_SUBDOMAIN}.cloudflarestream.com/${uid}/manifest/video.m3u8`,
  };
}
