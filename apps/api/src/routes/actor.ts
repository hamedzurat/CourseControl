import { eq } from 'drizzle-orm';
import { Hono } from 'hono';

import { section, subject } from '../db/schema';
import type { Env, Role } from '../env';
import { getDb } from '../lib/db';

type JwtUser = { id: string; email: string; role: Role };

export const actorRoute = new Hono<{
  Bindings: Env;
  Variables: { jwtUser: JwtUser };
}>();

// Public schedule endpoint - returns published subjects with their sections
actorRoute.get('/everything/schedule', async (c) => {
  const db = getDb(c.env);

  const subjects = await db
    .select({
      id: subject.id,
      code: subject.code,
      name: subject.name,
    })
    .from(subject)
    .where(eq(subject.published, 1));

  const sections = await db
    .select({
      id: section.id,
      subjectId: section.subjectId,
      sectionNumber: section.sectionNumber,
      maxSeats: section.maxSeats,
      timeslotMask: section.timeslotMask,
      facultyUserId: section.facultyUserId,
    })
    .from(section)
    .where(eq(section.published, 1));

  // Group sections by subject
  const sectionsBySubject = new Map<number, typeof sections>();
  for (const sec of sections) {
    const list = sectionsBySubject.get(sec.subjectId) ?? [];
    list.push(sec);
    sectionsBySubject.set(sec.subjectId, list);
  }

  const result = subjects.map((sub) => ({
    id: sub.id,
    code: sub.code,
    name: sub.name,
    sections: (sectionsBySubject.get(sub.id) ?? []).map((sec) => ({
      id: sec.id,
      timeslot: sec.timeslotMask,
      maxSeats: sec.maxSeats,
      location: sec.sectionNumber,
      instructorUserId: sec.facultyUserId,
    })),
  }));

  return c.json({ subjects: result });
});

actorRoute.all('/:kind', async (c) => {
  const user = c.get('jwtUser');
  const kind = c.req.param('kind') as string;

  let ns: Env['STUDENT_DO'] | null = null;
  let objectIdString: string | null = null;

  switch (kind) {
    case 'student':
      if (user.role !== 'student' && user.role !== 'admin') return c.json({ error: 'FORBIDDEN' }, 403);
      ns = c.env.STUDENT_DO;
      objectIdString = user.id;
      break;
    case 'faculty':
      if (user.role !== 'faculty' && user.role !== 'admin') return c.json({ error: 'FORBIDDEN' }, 403);
      ns = c.env.FACULTY_DO;
      objectIdString = user.id;
      break;
    case 'admin':
      if (user.role !== 'admin') return c.json({ error: 'FORBIDDEN' }, 403);
      ns = c.env.ADMIN_DO;
      objectIdString = user.id;
      break;
    case 'section':
      if (user.role !== 'faculty' && user.role !== 'admin') return c.json({ error: 'FORBIDDEN' }, 403);
      ns = c.env.SECTION_DO;
      objectIdString = c.req.query('id') || null;
      break;
    default:
      return c.json({ error: 'BAD_REQUEST', message: 'Unknown actor kind' }, 400);
  }

  if (!ns) return c.json({ error: 'BAD_REQUEST', message: 'Namespace not found' }, 400);
  if (!objectIdString) return c.json({ error: 'BAD_REQUEST', message: 'Missing ID for actor' }, 400);

  const stub = ns.get(ns.idFromName(objectIdString));

  // Determine target path/method (default to /ws for backward compat if strict, but 'path' param overrides)
  const targetPath = c.req.query('path') || '/ws';
  const targetMethod = c.req.query('method') || c.req.method;

  const url = new URL(c.req.url);
  url.pathname = targetPath;

  const headers = new Headers(c.req.raw.headers);
  headers.set('x-actor-user-id', user.id);
  headers.set('x-actor-user-role', user.role);

  const req = new Request(url.toString(), {
    method: targetMethod,
    headers,
    body: c.req.raw.body,
  });

  return stub.fetch(req);
});
