import type { MiddlewareHandler } from 'hono';

import type { Env } from '../env';

type Key = string;

const lastHit = new Map<Key, number>();

function makeKey(userId: string, routeKey: string): Key {
  return `${routeKey}:${userId}`;
}

/**
 * Simple in-memory per-user limiter:
 * - allows 1 request per `windowMs` for (routeKey, userId)
 * - returns 429 with retryAfterSeconds
 *
 * Notes:
 * - This is isolate-local, not globally consistent across all Worker instances.
 *   For polling this is usually acceptable. If you want hard global limits,
 *   we'd move this to a DO or KV later.
 */
export function limitPerUser(
  windowMs: number,
  routeKey: string,
): MiddlewareHandler<{
  Bindings: Env;
  Variables: { jwtUser: { id: string } };
}> {
  return async (c, next) => {
    const u = c.get('jwtUser');
    const key = makeKey(u.id, routeKey);

    const now = Date.now();
    const prev = lastHit.get(key);

    if (typeof prev === 'number') {
      const elapsed = now - prev;
      if (elapsed < windowMs) {
        const retryAfterSeconds = Math.ceil((windowMs - elapsed) / 1000);
        return c.json(
          {
            error: 'Too Many Requests',
            retryAfterSeconds,
          },
          429,
          {
            'Retry-After': String(retryAfterSeconds),
          },
        );
      }
    }

    lastHit.set(key, now);
    await next();
  };
}

/**
 * Optional helper to avoid unbounded growth.
 * Call this occasionally (e.g. every few thousand requests) if you want.
 */
export function cleanupLimiter(maxAgeMs: number) {
  const cutoff = Date.now() - maxAgeMs;
  for (const [k, t] of lastHit.entries()) {
    if (t < cutoff) lastHit.delete(k);
  }
}
