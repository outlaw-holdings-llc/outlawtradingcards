import { route, json, err, readJson, requireAdmin, uuid } from '../../_lib.js';
import { stream, playbackFor } from '../../_stream.js';

// Admin view of a show, including the private RTMP ingest key (for OBS/phone).
function adminShow(r) {
  return {
    id: r.id, title: r.title, status: r.status, break_type: r.break_type,
    scheduled_at: r.scheduled_at, created_at: r.created_at,
    stream_uid: r.stream_uid,
    rtmps_url: r.rtmps_url, rtmps_key: r.rtmps_key,
    playback: r.stream_uid ? playbackFor(r.stream_uid) : null,
  };
}

// GET /api/admin/shows — list all shows with their stream credentials.
export const onRequestGet = route(async ({ request, env }) => {
  await requireAdmin(request, env);
  const { results } = await env.DB.prepare(
    'SELECT * FROM shows ORDER BY created_at DESC').all();
  return json({ shows: results.map(adminShow) });
});

// POST /api/admin/shows — create a show + a Cloudflare Stream live input.
export const onRequestPost = route(async ({ request, env }) => {
  await requireAdmin(request, env);
  const b = await readJson(request);
  const title = String(b.title || '').trim();
  if (!title) throw err('Show title is required');

  const li = await stream(env).createLiveInput(title); // throws 503 if not configured
  const rtmps = li.rtmps || {};
  const id = uuid();
  try {
    await env.DB.prepare(
      `INSERT INTO shows (id, title, scheduled_at, status, break_type, stream_uid, rtmps_url, rtmps_key)
       VALUES (?,?,?,?,?,?,?,?)`)
      .bind(id, title, b.scheduled_at || null, 'scheduled', b.break_type || 'mixed',
        li.uid, rtmps.url || null, rtmps.streamKey || null).run();
  } catch (e) {
    // don't leave an orphaned Cloudflare live input if the DB write fails
    try { await stream(env).deleteLiveInput(li.uid); } catch { /* best-effort */ }
    throw e;
  }

  const row = await env.DB.prepare('SELECT * FROM shows WHERE id = ?').bind(id).first();
  return json({ show: adminShow(row) }, 201);
});
