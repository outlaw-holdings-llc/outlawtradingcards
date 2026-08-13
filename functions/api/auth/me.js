import { route, json, getUser } from '../_lib.js';

export const onRequestGet = route(async ({ request, env }) => {
  const user = await getUser(request, env);
  return json({ user: user || null });
});
