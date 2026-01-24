import { Hono } from 'hono';

import type { Env } from '../env';
import { HttpError, mintAppJwtFromRequest } from '../lib/auth';

export const authAppRoute = new Hono<{ Bindings: Env }>();

/**
 * POST /auth/app/token
 * Requires an active Better Auth session (cookie or BetterAuth bearer),
 * returns our role-carrying "app JWT" for frontend to use.
 */
authAppRoute.post('/token', async (c) => {
  try {
    const out = await mintAppJwtFromRequest(c.env, c.req.raw);
    return c.json(out);
  } catch (e: any) {
    if (e instanceof HttpError) {
      return c.json({ error: e.code, message: e.message }, { status: e.status } as any);
    }
    return c.json({ error: 'INTERNAL', message: e?.message ?? 'Failed to mint token' }, { status: 500 } as any);
  }
});
