import { Hono } from 'hono';

import type { Env, Role } from '../env';

type JwtUser = { id: string; email: string; role: Role };

export const actorRoute = new Hono<{
  Bindings: Env;
  Variables: { jwtUser: JwtUser };
}>();

actorRoute.get('/:kind', async (c) => {
  const user = c.get('jwtUser');
  const kind = c.req.param('kind') as string;

  // role gate
  if (kind === 'student' && user.role !== 'student') return c.json({ error: 'FORBIDDEN' }, 403);
  if (kind === 'faculty' && user.role !== 'faculty') return c.json({ error: 'FORBIDDEN' }, 403);
  if (kind === 'admin' && user.role !== 'admin') return c.json({ error: 'FORBIDDEN' }, 403);

  // pick namespace
  const ns =
    kind === 'student'
      ? c.env.STUDENT_DO
      : kind === 'faculty'
        ? c.env.FACULTY_DO
        : kind === 'admin'
          ? c.env.ADMIN_DO
          : null;

  if (!ns) return c.json({ error: 'BAD_REQUEST', message: 'Unknown actor kind' }, 400);

  // stable per-user DO
  const stub = ns.get(ns.idFromName(user.id));

  // forward to DO /ws
  const url = new URL(c.req.url);
  url.pathname = '/ws';

  // ✅ MUST pass identity headers for DO
  const headers = new Headers(c.req.raw.headers);
  headers.set('x-actor-user-id', user.id);
  headers.set('x-actor-user-role', user.role);

  const req = new Request(url.toString(), {
    method: 'GET',
    headers,
  });

  return stub.fetch(req);
});
