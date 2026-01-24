import type { MiddlewareHandler } from 'hono';

import type { Env, Role } from '../env';
import { verifyJwtFromRequest } from '../lib/auth';

type JwtUser = { id: string; email: string; role: Role };

export const requireJwt: MiddlewareHandler<{ Bindings: Env; Variables: { jwtUser: JwtUser } }> = async (c, next) => {
  if (c.req.method === 'OPTIONS') {
    return next();
  }
  try {
    const user = await verifyJwtFromRequest(c.env, c.req.raw);
    c.set('jwtUser', user);
  } catch (e: any) {
    return c.json({ error: 'UNAUTHORIZED', message: e?.message || 'Unauthorized' }, 401);
  }
  await next();
};

export function requireRole(roles: Role[]): MiddlewareHandler<{ Bindings: Env; Variables: { jwtUser: JwtUser } }> {
  return async (c, next) => {
    const u = c.get('jwtUser');
    if (!roles.includes(u.role)) {
      return c.json({ error: 'FORBIDDEN', message: 'Insufficient role' }, { status: 403 });
    }
    await next();
  };
}
