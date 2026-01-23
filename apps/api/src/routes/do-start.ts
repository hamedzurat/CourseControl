import { Hono } from 'hono';

import type { Env } from '../env';
import { requireJwt, requireRole } from '../middleware/authz';

export const doStartRoute = new Hono<{
  Bindings: Env;
  Variables: { jwtUser: { id: string; email: string; role: 'student' | 'faculty' | 'admin' } };
}>();

doStartRoute.use('*', requireJwt, requireRole(['admin']));

function bad(c: any, message: string) {
  return c.json({ error: 'BAD_REQUEST', message }, 400);
}

doStartRoute.post('/start', async (c) => {
  const kind = String(c.req.query('kind') ?? '').trim();
  const idRaw = String(c.req.query('id') ?? '').trim();

  if (!kind) return bad(c, 'kind is required');
  if (kind !== 'everything' && !idRaw) return bad(c, 'id is required (except kind=everything)');

  // normalize id for idFromName
  const name = kind === 'everything' ? 'singleton' : idRaw;

  let stub: DurableObjectStub;
  let url = 'https://do/status';

  switch (kind) {
    case 'section':
      stub = c.env.SECTION_DO.get(c.env.SECTION_DO.idFromName(name));
      // SectionDO expects id in query on first request
      url = `https://do/status?id=${encodeURIComponent(idRaw)}`;
      break;

    case 'subject':
      stub = c.env.SUBJECT_DO.get(c.env.SUBJECT_DO.idFromName(name));
      url = `https://do/status?id=${encodeURIComponent(idRaw)}`;
      break;

    case 'student':
      stub = c.env.STUDENT_DO.get(c.env.STUDENT_DO.idFromName(name));
      break;

    case 'faculty':
      stub = c.env.FACULTY_DO.get(c.env.FACULTY_DO.idFromName(name));
      break;

    case 'admin':
      stub = c.env.ADMIN_DO.get(c.env.ADMIN_DO.idFromName(name));
      break;

    case 'everything':
      stub = c.env.EVERYTHING_DO.get(c.env.EVERYTHING_DO.idFromName('singleton'));
      url = 'https://do/status';
      break;

    default:
      return bad(c, `unsupported kind: ${kind}`);
  }

  const resp = await stub.fetch(url, { method: 'GET' });
  const text = await resp.text();

  return new Response(text, {
    status: resp.status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
});
