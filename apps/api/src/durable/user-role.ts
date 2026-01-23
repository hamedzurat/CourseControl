import { eq } from 'drizzle-orm';

import { baUser } from '../db/schema';
import type { Env, Role } from '../env';
import { getDb } from '../lib/db';
import { AppError } from './errors';

type CacheEntry = { role: Role; expiresAtMs: number };

const cache = new Map<string, CacheEntry>();

export async function resolveUserRole(env: Env, userId: string): Promise<Role> {
  const now = Date.now();
  const hit = cache.get(userId);
  if (hit && hit.expiresAtMs > now) return hit.role;

  const db = getDb(env);
  const rows = await db.select({ role: baUser.role }).from(baUser).where(eq(baUser.id, userId)).limit(1);

  if (!rows.length) throw new AppError('USER_NOT_FOUND', `User not found: ${userId}`, 404);

  const role = (rows[0].role as Role) ?? 'student';
  cache.set(userId, { role, expiresAtMs: now + 10 * 60_000 }); // 10 min TTL
  return role;
}
