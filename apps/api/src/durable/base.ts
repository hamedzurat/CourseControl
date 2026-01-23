import type { DurableObjectState } from '@cloudflare/workers-types';

import type { Env, Role } from '../env';
import { DurableQueue } from './queue';
import { AppError } from './utils/errors';

export class BaseDurableObject {
  protected queue: DurableQueue;

  constructor(
    protected state: DurableObjectState,
    protected env: Env,
  ) {
    this.queue = new DurableQueue(state);
  }

  /** Common initialization logic (meta table, kv_cache, queue schema) */
  protected async initGenericSql() {
    const db = await this.state.storage.sql;

    db.exec(`
      CREATE TABLE IF NOT EXISTS meta (
        k TEXT PRIMARY KEY NOT NULL,
        v TEXT NOT NULL
      );
    `);

    db.exec(`
      CREATE TABLE IF NOT EXISTS kv_cache (
        k TEXT PRIMARY KEY NOT NULL,
        v TEXT NOT NULL
      );
    `);

    await this.queue.initSchema(db);
  }

  protected async ensureAlarm(delayMs: number) {
    await this.state.storage.setAlarm(Date.now() + delayMs);
  }

  protected readIdentity(req: Request): { userId: string; role: Role } {
    const userId = req.headers.get('x-actor-user-id') || '';
    const role = (req.headers.get('x-actor-user-role') || '') as Role;
    if (!userId) throw new AppError('MISSING_IDENTITY', 'Missing x-actor-user-id', 401);
    if (!role) throw new AppError('MISSING_IDENTITY', 'Missing x-actor-user-role', 401);
    return { userId, role };
  }

  protected ensureRole(req: Request, allowed: Role | Role[]) {
    const { role } = this.readIdentity(req);
    const allowList = Array.isArray(allowed) ? allowed : [allowed];
    if (!allowList.includes(role)) {
      throw new AppError('FORBIDDEN', `Role ${role} not allowed`, 403);
    }
    return { role };
  }
}
