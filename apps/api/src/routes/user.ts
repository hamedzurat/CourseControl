import { eq } from 'drizzle-orm';
import { Hono } from 'hono';

import { baUser } from '../db/schema';
import type { Env } from '../env';
import { getDb } from '../lib/db';

export const userRoute = new Hono<{ Bindings: Env }>();

userRoute.get('/lookup', async (c) => {
  const email = c.req.query('email');
  if (!email) return c.json({ error: 'Email required' }, 400);

  try {
    const db = getDb(c.env);
    const user = await db
      .select({
        id: baUser.id,
        name: baUser.name,
        role: baUser.role,
        image: baUser.image,
      })
      .from(baUser)
      .where(eq(baUser.email, email))
      .limit(1);

    if (!user.length) return c.json({ error: 'User not found' }, 404);
    return c.json(user[0]);
  } catch (e: any) {
    console.error('User lookup error:', e);
    return c.json({ error: e?.message || 'Internal error' }, 500);
  }
});

userRoute.post('/resolve', async (c) => {
  const { userIds } = await c.req.json<{ userIds: string[] }>();
  if (!Array.isArray(userIds) || !userIds.length) return c.json({});

  try {
    const { inArray } = await import('drizzle-orm');
    const db = getDb(c.env);

    // De-duplicate IDs
    const uniqueIds = Array.from(new Set(userIds));

    const users = await db
      .select({
        id: baUser.id,
        name: baUser.name,
        role: baUser.role,
        image: baUser.image,
        email: baUser.email,
      })
      .from(baUser)
      .where(inArray(baUser.id, uniqueIds));

    return c.json(users);
  } catch (e: any) {
    console.error('User resolve error:', e);
    return c.json({ error: e?.message || 'Internal error' }, 500);
  }
});
