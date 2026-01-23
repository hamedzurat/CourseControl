import { desc } from 'drizzle-orm';
import { Hono } from 'hono';

import { phaseSchedule } from '../db/schema';
import type { Env } from '../env';
import { getDb } from '../lib/db';

type Phase = 'pre' | 'selection' | 'between' | 'swap' | 'post';

function computePhase(nowMs: number, s: any): Phase {
  if (!s) return 'pre';
  if (nowMs < s.selectionStartMs) return 'pre';
  if (nowMs < s.selectionEndMs) return 'selection';
  if (nowMs < s.swapStartMs) return 'between';
  if (nowMs < s.swapEndMs) return 'swap';
  return 'post';
}

export const phaseRoute = new Hono<{ Bindings: Env }>();

phaseRoute.get('/', async (c) => {
  const db = getDb(c.env);
  const nowMs = Date.now();

  const rows = await db.select().from(phaseSchedule).orderBy(desc(phaseSchedule.createdAtMs)).limit(1);
  const schedule = rows[0] ?? null;

  const phase = computePhase(nowMs, schedule);

  return c.json({
    nowMs,
    phase,
    schedule,
  });
});
