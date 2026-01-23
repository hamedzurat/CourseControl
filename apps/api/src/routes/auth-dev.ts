import { eq } from 'drizzle-orm';
import { Hono } from 'hono';

import { baUser } from '../db/schema';
import type { Env } from '../env';
import { getDb } from '../lib/db';
import { signAppJwt } from '../lib/jwt';

export const authDevRoute = new Hono<{ Bindings: Env }>();

function requireSecret(c: any) {
  const secret = c.req.query('secret');
  if (!secret || secret !== c.env.PSEUDO_SECRET_ID) {
    return c.json({ error: 'FORBIDDEN', message: 'bad secret' }, 403);
  }
  return null;
}

authDevRoute.get('/users', async (c) => {
  const deny = requireSecret(c);
  if (deny) return deny;

  const db = getDb(c.env);
  const rows = await db
    .select({ id: baUser.id, name: baUser.name, email: baUser.email, role: baUser.role })
    .from(baUser);
  return c.json({ users: rows });
});

authDevRoute.post('/login', async (c) => {
  const deny = requireSecret(c);
  if (deny) return deny;

  const body = (await c.req.json().catch(() => null)) as null | { userId?: string; email?: string };
  const userId = body?.userId ? String(body.userId) : null;
  const email = body?.email ? String(body.email) : null;

  if (!userId && !email) return c.json({ error: 'BAD_REQUEST', message: 'userId or email required' }, 400);

  const db = getDb(c.env);
  const row = userId
    ? (await db.select().from(baUser).where(eq(baUser.id, userId)).limit(1))[0]
    : (await db.select().from(baUser).where(eq(baUser.email, email!)).limit(1))[0];

  if (!row) return c.json({ error: 'NOT_FOUND', message: 'user not found' }, 404);

  const token = await signAppJwt(c.env, { sub: row.id, email: row.email, role: row.role as any });
  return c.json({ token, user: { id: row.id, email: row.email, role: row.role } });
});
