import { getUser } from '../_lib.js';

// GET /api/live/socket?show=<id> — WebSocket upgrade into the show's LiveRoom.
// Anonymous clients can watch/read; only signed-in users can post chat.
export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const showId = url.searchParams.get('show');
  if (!showId) return new Response('missing show', { status: 400 });
  if ((request.headers.get('Upgrade') || '').toLowerCase() !== 'websocket') {
    return new Response('expected websocket', { status: 426 });
  }
  // authenticate on the same-origin request (cookies present), pass identity to the DO
  const user = await getUser(request, env);
  const id = env.LIVE_ROOM.idFromName(showId);
  const stub = env.LIVE_ROOM.get(id);
  const fwd = new Request(url.toString(), request);
  fwd.headers.set('X-User-Id', user ? user.id : '');
  fwd.headers.set('X-User-Name', user ? user.display_name : '');
  fwd.headers.set('X-User-Role', user ? user.role : '');
  return stub.fetch(fwd);
}
// The LiveRoom Durable Object itself lives in the otc-live Worker (Pages can't
// host a DO). This route just authenticates + forwards to the LIVE_ROOM binding.
