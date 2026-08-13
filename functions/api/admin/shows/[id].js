import { route, json, err, readJson, requireAdmin } from '../../_lib.js';
import { stream } from '../../_stream.js';
import { sendPush } from '../../_push.js';

// Notify push subscribers that a show just went live (runs via waitUntil).
// Chunked to stay under Cloudflare's per-request subrequest limit; capped for MVP.
// (Beyond ~900 subscribers, move this to a Cloudflare Queue consumer.)
async function notifyShowLive(env, show) {
  const { results } = await env.DB.prepare(
    'SELECT endpoint, p256dh, auth FROM push_subscriptions LIMIT 900').all();
  const payload = { title: '🔴 Outlaw Trading Cards is LIVE', body: (show.title || 'The stream just started') + ' — come rip!', url: '/live/' };
  const CHUNK = 40;
  for (let i = 0; i < results.length; i += CHUNK) {
    await Promise.allSettled(results.slice(i, i + CHUNK).map(async (sub) => {
      try {
        const r = await sendPush(env, sub, payload);
        if (r.gone) await env.DB.prepare('DELETE FROM push_subscriptions WHERE endpoint=?').bind(sub.endpoint).run();
      } catch { /* skip a bad subscription */ }
    }));
  }
}

// PATCH /api/admin/shows/:id — update status ('scheduled'|'live'|'ended') or title.
// Going live sets every other show back to 'scheduled' so only one is live at a time,
// and pushes a "show starting" notification to subscribers.
export const onRequestPatch = route(async (context) => {
  const { request, env, params } = context;
  await requireAdmin(request, env);
  const row = await env.DB.prepare('SELECT status FROM shows WHERE id = ?').bind(params.id).first();
  if (!row) throw err('Show not found', 404);
  const b = await readJson(request);
  const goingLive = b.status === 'live' && row.status !== 'live';

  const stmts = [];
  if (b.status && ['scheduled', 'live', 'ended'].includes(b.status)) {
    if (b.status === 'live') {
      stmts.push(env.DB.prepare("UPDATE shows SET status='scheduled' WHERE status='live' AND id<>?").bind(params.id));
    }
    stmts.push(env.DB.prepare('UPDATE shows SET status=? WHERE id=?').bind(b.status, params.id));
  }
  if (b.title !== undefined) {
    stmts.push(env.DB.prepare('UPDATE shows SET title=? WHERE id=?').bind(String(b.title).trim(), params.id));
  }
  if (b.scheduled_at !== undefined) {
    stmts.push(env.DB.prepare('UPDATE shows SET scheduled_at=? WHERE id=?').bind(b.scheduled_at || null, params.id));
  }
  if (!stmts.length) throw err('Nothing to update');
  await env.DB.batch(stmts);

  const updated = await env.DB.prepare('SELECT id,title,status,break_type,scheduled_at,stream_uid FROM shows WHERE id=?')
    .bind(params.id).first();
  if (goingLive && env.VAPID_PUBLIC && context.waitUntil) {
    context.waitUntil(notifyShowLive(env, updated));
  }
  return json({ show: updated });
});

// DELETE /api/admin/shows/:id — delete the show and its Cloudflare live input.
export const onRequestDelete = route(async ({ request, env, params }) => {
  await requireAdmin(request, env);
  const row = await env.DB.prepare('SELECT stream_uid FROM shows WHERE id = ?').bind(params.id).first();
  if (!row) throw err('Show not found', 404);
  if (row.stream_uid) {
    try { await stream(env).deleteLiveInput(row.stream_uid); } catch (e) { /* input may already be gone */ }
  }
  await env.DB.prepare('DELETE FROM shows WHERE id = ?').bind(params.id).run();
  return json({ ok: true });
});
