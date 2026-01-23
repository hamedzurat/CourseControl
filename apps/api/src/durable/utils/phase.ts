import { desc } from 'drizzle-orm';

import { phaseSchedule } from '../../db/schema';
import type { Env } from '../../env';
import { getDb } from '../../lib/db';

type Phase = 'pre' | 'selection' | 'between' | 'swap' | 'post';

let cache: { fetchedAtMs: number; schedule: any; phase: Phase } | null = null;

export async function getPhase(env: Env): Promise<{ phase: Phase; schedule: any; nowMs: number }> {
  const nowMs = Date.now();
  if (cache && nowMs - cache.fetchedAtMs < 5000) {
    return { phase: cache.phase, schedule: cache.schedule, nowMs };
  }

  const db = getDb(env);
  const rows = await db.select().from(phaseSchedule).orderBy(desc(phaseSchedule.createdAtMs)).limit(1);

  if (!rows.length) {
    // treat as pre if not seeded
    const schedule = null;
    cache = { fetchedAtMs: nowMs, schedule, phase: 'pre' };
    return { phase: 'pre', schedule, nowMs };
  }

  const schedule = rows[0];

  let phase: Phase = 'pre';
  if (nowMs < schedule.selectionStartMs) phase = 'pre';
  else if (nowMs < schedule.selectionEndMs) phase = 'selection';
  else if (nowMs < schedule.swapStartMs) phase = 'between';
  else if (nowMs < schedule.swapEndMs) phase = 'swap';
  else phase = 'post';

  cache = { fetchedAtMs: nowMs, schedule, phase };
  return { phase, schedule, nowMs };
}
