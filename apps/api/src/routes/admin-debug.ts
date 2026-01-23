import { Hono } from 'hono';

import type { Env } from '../env';
import { requireJwt, requireRole } from '../middleware/authz';

export const adminDebugRoute = new Hono<{
  Bindings: Env;
  Variables: { jwtUser: { id: string; email: string; role: 'student' | 'faculty' | 'admin' } };
}>();

adminDebugRoute.use('*', requireJwt, requireRole(['admin']));

function adminStub(env: Env, userId: string) {
  const id = env.ADMIN_DO.idFromName(userId);
  return env.ADMIN_DO.get(id);
}

function identityHeaders(u: { id: string; role: string }) {
  return {
    'x-actor-user-id': u.id,
    'x-actor-user-role': u.role,
  };
}

adminDebugRoute.get('/tables', async (c) => {
  const u = c.get('jwtUser');
  const stub = adminStub(c.env, u.id);

  const resp = await stub.fetch('https://do/tables', {
    method: 'GET',
    headers: identityHeaders(u),
  });

  const text = await resp.text();
  return new Response(text, { status: resp.status, headers: { 'content-type': 'application/json' } });
});

adminDebugRoute.get('/table', async (c) => {
  const u = c.get('jwtUser');
  const stub = adminStub(c.env, u.id);

  const name = c.req.query('name') ?? '';
  const limit = c.req.query('limit') ?? '100';

  const url = new URL('https://do/table');
  url.searchParams.set('name', name);
  url.searchParams.set('limit', limit);

  const resp = await stub.fetch(url.toString(), {
    method: 'GET',
    headers: identityHeaders(u),
  });

  const text = await resp.text();
  return new Response(text, { status: resp.status, headers: { 'content-type': 'application/json' } });
});
