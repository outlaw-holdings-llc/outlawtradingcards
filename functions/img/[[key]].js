// GET /img/<key> — serve a card photo from KV (public; these are product images).
// Storage is KV today (R2 not enabled on the account); swap to R2 later without URL changes.
export async function onRequestGet({ params, env }) {
  const key = Array.isArray(params.key) ? params.key.join('/') : params.key;
  if (!key) return new Response('Not found', { status: 404 });

  const obj = await env.IMAGES_KV.getWithMetadata(key, { type: 'arrayBuffer' });
  if (!obj || !obj.value) return new Response('Not found', { status: 404 });

  const contentType = (obj.metadata && obj.metadata.contentType) || 'application/octet-stream';
  return new Response(obj.value, {
    headers: {
      'Content-Type': contentType,
      'Cache-Control': 'public, max-age=86400',
    },
  });
}
