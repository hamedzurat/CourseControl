import { Hono } from 'hono';

import type { Env } from '../env';

export const adminDbRoute = new Hono<{ Bindings: Env }>();

const ALLOWED = new Set([
  'user',
  'session',
  'account',
  'verification',
  'jwks',
  'admin',
  'faculty',
  'student',
  'subject',
  'section',
  'enrollment',
  'section_selection',
  'group',
  'group_member',
  'group_invite',
  'swap',
  'swap_participant',
  'swap_invite',
  'notification',
  'phase_schedule',
]);

adminDbRoute.get('/', (c) => c.json({ tables: Array.from(ALLOWED).sort() }));

adminDbRoute.get('/:table', async (c) => {
  const table = c.req.param('table');
  if (!ALLOWED.has(table)) return c.json({ error: 'BAD_REQUEST', message: 'Unknown table' }, 400);

  const limit = Math.max(1, Math.min(500, Number(c.req.query('limit') ?? 100)));
  const offset = Math.max(0, Number(c.req.query('offset') ?? 0));

  const res = await c.env.DB.prepare(`SELECT * FROM "${table}" LIMIT ? OFFSET ?`).bind(limit, offset).all();

  return c.json({ table, limit, offset, rows: res.results ?? [] });
});
