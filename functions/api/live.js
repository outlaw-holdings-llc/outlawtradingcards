import { route, json } from './_lib.js';
import { playbackFor } from './_stream.js';

// GET /api/live — public. The current live show (or the next scheduled one).
// Never exposes the RTMP ingest key.
export const onRequestGet = route(async ({ env }) => {
  const live = await env.DB.prepare(
    "SELECT id,title,break_type,stream_uid FROM shows WHERE status='live' ORDER BY created_at DESC LIMIT 1").first();
  if (live && live.stream_uid) {
    return json({ status: 'live', show: {
      id: live.id, title: live.title, break_type: live.break_type,
      playback: playbackFor(live.stream_uid),
    } });
  }
  const next = await env.DB.prepare(
    "SELECT id,title,scheduled_at FROM shows WHERE status='scheduled' AND scheduled_at IS NOT NULL ORDER BY scheduled_at ASC LIMIT 1").first();
  return json({ status: 'offline', next: next || null });
});
