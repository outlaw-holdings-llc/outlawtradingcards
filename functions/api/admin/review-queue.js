import { route, json, requireAdmin } from '../_lib.js';
import { shape } from '../cards/index.js';

// GET /api/admin/review-queue — admin only. Cards freshly uploaded, awaiting review.
// This is the hook Claude uses to assist: pull the queue, view /img photos, enrich, PATCH back.
export const onRequestGet = route(async ({ request, env }) => {
  await requireAdmin(request, env);
  const { results } = await env.DB.prepare(
    'SELECT * FROM cards WHERE needs_review = 1 ORDER BY created_at ASC').all();
  return json({ count: results.length, cards: results.map(shape) });
});
