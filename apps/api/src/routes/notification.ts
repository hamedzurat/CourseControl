import { and, desc, eq, isNull, or } from 'drizzle-orm';
import { Hono } from 'hono';

import { notification as notificationTable } from '../db/schema';
import type { Env, Role } from '../env';
import { getDb } from '../lib/db';

type JwtUser = { id: string; email: string; role: Role };

const lastPollByUser = new Map<string, number>(); // userId -> ms

export const notificationRoute = new Hono<{
  Bindings: Env;
  Variables: { jwtUser: JwtUser };
}>();

notificationRoute.post('/create', async (c) => {
  const user = c.get('jwtUser');

  const body = (await c.req.json().catch(() => null)) as null | {
    audienceRole?: Role | null;
    audienceUserId?: string | null;
    title: string;
    body: string;
  };

  if (!body?.title || !body?.body) {
    return c.json({ error: 'BAD_REQUEST', message: 'title and body required' }, { status: 400 });
  }

  const db = getDb(c.env);
  await db.insert(notificationTable).values({
    createdByUserId: user.id,
    audienceRole: body.audienceRole ?? null,
    audienceUserId: body.audienceUserId ?? null,
    title: String(body.title),
    body: String(body.body),
    createdAtMs: Date.now(),
  });

  return c.json({ ok: true });
});

notificationRoute.get('/poll', async (c) => {
  const user = c.get('jwtUser');

  const now = Date.now();
  const last = lastPollByUser.get(user.id) ?? 0;
  if (now - last < 1_000) {
    return c.json({ error: 'RATE_LIMITED', message: 'poll allowed once per minute' }, { status: 429 });
  }
  lastPollByUser.set(user.id, now);

  const sinceMsRaw = c.req.query('sinceMs');
  const sinceMs = sinceMsRaw ? Number(sinceMsRaw) : now - 7 * 24 * 60 * 60_000;
  const safeSince = Number.isFinite(sinceMs) ? sinceMs : now - 7 * 24 * 60 * 60_000;

  const db = getDb(c.env);

  const rows = await db
    .select()
    .from(notificationTable)
    .where(
      or(
        eq(notificationTable.audienceUserId, user.id),
        eq(notificationTable.audienceRole, user.role),
        and(isNull(notificationTable.audienceUserId), isNull(notificationTable.audienceRole)),
      ),
    )
    .orderBy(desc(notificationTable.createdAtMs))
    .limit(50);

  const filtered = rows.filter((r: any) => r.createdAtMs >= safeSince).reverse();

  return c.json({
    nowMs: now,
    sinceMs: safeSince,
    items: filtered,
  });
});
