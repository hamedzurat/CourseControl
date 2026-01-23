import { Hono } from 'hono';

import { getPhase } from '../durable/utils/phase';
import type { Env } from '../env';

export const stateRoute = new Hono<{ Bindings: Env }>();

async function triggerEverythingBuild(env: Env) {
  const id = env.EVERYTHING_DO.idFromName('singleton');
  const stub = env.EVERYTHING_DO.get(id);

  // triggers EverythingDO to write R2/state.json
  await stub.fetch('https://do/build', { method: 'POST' });
}

async function buildStateFromD1(env: Env) {
  // seatsLeft = maxSeats - count(section_selection)
  const res = await env.DB.prepare(
    `
    SELECT
      'From DB' as source,
      s.id AS sectionId,
      s.maxSeats AS maxSeats,
      COALESCE(x.taken, 0) AS taken
    FROM section s
    LEFT JOIN (
      SELECT sectionId, COUNT(*) AS taken
      FROM section_selection
      GROUP BY sectionId
    ) x ON x.sectionId = s.id
    WHERE s.published = 1;
  `,
  ).all();

  const sections: Record<string, { maxSeats: number; seatsLeft: number; taken: number }> = {};

  for (const row of (res.results ?? []) as any[]) {
    const id = String(row.sectionId);
    const maxSeats = Number(row.maxSeats ?? 0);
    const taken = Number(row.taken ?? 0);
    const seatsLeft = Math.max(0, maxSeats - taken);
    sections[id] = { maxSeats, seatsLeft, taken };
  }

  return {
    generatedAtMs: Date.now(),
    source: 'd1',
    sections,
  };
}

stateRoute.get('/', async (c) => {
  const { phase } = await getPhase(c.env);

  // requirement: if NOT selection phase, always pull from D1
  if (phase !== 'selection') {
    const state = await buildStateFromD1(c.env);
    return c.json(state, 200);
  }

  // selection phase: use R2 state.json (fast, cached)
  let obj = await c.env.R2_STATE.get('state.json');

  // If missing, start EverythingDO build and retry a few times
  if (!obj) {
    try {
      await triggerEverythingBuild(c.env);
    } catch {
      // ignore and fall through to 404 if still not present
    }

    // retry a bit (EverythingDO build is quick in dev)
    for (let i = 0; i < 5 && !obj; i++) {
      await new Promise((r) => setTimeout(r, 120));
      obj = await c.env.R2_STATE.get('state.json');
    }
  }

  if (!obj) {
    return c.json(
      { error: 'STATE_NOT_READY', message: 'state.json not found in R2 yet (build triggered, retry shortly)' },
      { status: 404 },
    );
  }

  const headers = new Headers();
  headers.set('content-type', 'application/json; charset=utf-8');
  if (obj.etag) headers.set('etag', obj.etag);

  return new Response(obj.body, { status: 200, headers });
});
