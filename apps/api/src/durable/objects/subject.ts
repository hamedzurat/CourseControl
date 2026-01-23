import type { DurableObjectState } from '@cloudflare/workers-types';

import type { Env } from '../../env';
import { AppError } from '../utils/errors';
import { fromError, json } from '../utils/http';
import { getPhase } from '../utils/phase';
import { sendJson, upgradeToWebSocket, type AnyWebSocket } from '../utils/ws';

type UpdateBody = {
  subjectId: number;
  sectionId: number;
  seats: number;
  maxSeats: number;
};

type SubjectMeta = {
  subjectId: number;
};

export class SubjectDO {
  private meta: SubjectMeta | null = null;

  constructor(
    private state: DurableObjectState,
    private env: Env,
  ) {
    this.state.blockConcurrencyWhile(async () => {
      await this.initSql();
      await this.ensureAlarm();
      this.log('instance:start', { actorId: state.id.toString(), at: Date.now() });
    });
  }

  private async initSql() {
    const db = await this.state.storage.sql;

    db.exec(`
      CREATE TABLE IF NOT EXISTS meta (
        k TEXT PRIMARY KEY NOT NULL,
        v TEXT NOT NULL
      );
    `);

    /** Latest section seat data */
    db.exec(`
      CREATE TABLE IF NOT EXISTS section_state (
        sectionId INTEGER PRIMARY KEY NOT NULL,
        seats INTEGER NOT NULL,
        maxSeats INTEGER NOT NULL,
        updatedAtMs INTEGER NOT NULL
      );
    `);

    /** Optional history log (small; can be expanded later) */
    db.exec(`
      CREATE TABLE IF NOT EXISTS update_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
        sectionId INTEGER NOT NULL,
        seats INTEGER NOT NULL,
        maxSeats INTEGER NOT NULL,
        createdAtMs INTEGER NOT NULL
      );
    `);
  }

  private async ensureAlarm() {
    await this.state.storage.setAlarm(Date.now() + 1_000);
  }

  private async getMeta(): Promise<SubjectMeta | null> {
    if (this.meta) return this.meta;
    const db = await this.state.storage.sql;
    const rows = db.exec(`SELECT v FROM meta WHERE k='meta' LIMIT 1;`).toArray() as { v: string }[];
    if (!rows.length) return null;

    try {
      const meta = JSON.parse(rows[0].v) as SubjectMeta;
      if (typeof meta?.subjectId !== 'number') return null;
      this.meta = meta;
      return meta;
    } catch {
      return null;
    }
  }

  private async setMeta(meta: SubjectMeta) {
    this.meta = meta;
    const db = await this.state.storage.sql;
    db.exec(`INSERT OR REPLACE INTO meta (k, v) VALUES ('meta', ?);`, JSON.stringify(meta));
  }

  private async ensureMetaFromBody(body: UpdateBody): Promise<SubjectMeta> {
    const existing = await this.getMeta();
    if (existing) return existing;

    if (typeof body.subjectId !== 'number' || !Number.isFinite(body.subjectId) || body.subjectId <= 0) {
      throw new AppError('BAD_REQUEST', 'subjectId required', 400);
    }

    const meta = { subjectId: body.subjectId };
    await this.setMeta(meta);
    return meta;
  }

  private async upsertSectionState(sectionId: number, seats: number, maxSeats: number) {
    const db = await this.state.storage.sql;
    const now = Date.now();

    db.exec(
      `INSERT INTO section_state (sectionId, seats, maxSeats, updatedAtMs)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(sectionId) DO UPDATE SET
         seats=excluded.seats,
         maxSeats=excluded.maxSeats,
         updatedAtMs=excluded.updatedAtMs;`,
      sectionId,
      seats,
      maxSeats,
      now,
    );

    db.exec(
      `INSERT INTO update_log (sectionId, seats, maxSeats, createdAtMs) VALUES (?, ?, ?, ?);`,
      sectionId,
      seats,
      maxSeats,
      now,
    );
  }

  private async buildKvPayload(subjectId: number) {
    const db = await this.state.storage.sql;
    const rows = db
      .exec(`SELECT sectionId, seats, maxSeats, updatedAtMs FROM section_state ORDER BY sectionId;`)
      .toArray() as { sectionId: number; seats: number; maxSeats: number; updatedAtMs: number }[];

    const sections: Record<string, any> = {};
    for (const r of rows) {
      sections[String(r.sectionId)] = {
        sectionId: r.sectionId,
        seats: r.seats,
        maxSeats: r.maxSeats,
        updatedAtMs: r.updatedAtMs,
      };
    }

    return {
      subjectId,
      updatedAtMs: Date.now(),
      sections,
    };
  }

  async alarm() {
    try {
      const meta = await this.getMeta();
      if (!meta) {
        // no meta yet; keep ticking
        await this.ensureAlarm();
        return;
      }

      const { phase } = await getPhase(this.env);

      // Requirement: updates KV every 1s using alarm.
      // We'll still tick every 1s always, but only write KV during selection by default.
      // If you want KV to keep updating during swap too, remove this condition.
      if (phase === 'selection') {
        const payload = await this.buildKvPayload(meta.subjectId);
        await this.env.KV_SUBJECT.put(`subject:${meta.subjectId}`, JSON.stringify(payload));
        // this.log('kv:write', { subjectId: meta.subjectId });
      }

      await this.ensureAlarm();
    } catch {
      // backoff slightly but keep alive
      await this.state.storage.setAlarm(Date.now() + 2_000);
    }
  }

  async fetch(req: Request): Promise<Response> {
    try {
      const url = new URL(req.url);
      const path = url.pathname;

      if (path === '/ws' && req.method === 'GET') {
        // optional: allow observers (faculty/student) to see seat status for this subject DO instance
        const { response, server } = upgradeToWebSocket(this.state);

        sendJson(server as AnyWebSocket, { type: 'hello', actor: 'subject', nowMs: Date.now() } as any);

        const meta = await this.getMeta();
        if (meta) {
          const payload = await this.buildKvPayload(meta.subjectId);
          sendJson(server as AnyWebSocket, { type: 'status', nowMs: Date.now(), data: payload });
        } else {
          sendJson(server as AnyWebSocket, {
            type: 'status',
            nowMs: Date.now(),
            data: { note: 'No meta yet; waiting for first /update' },
          });
        }

        return response;
      }

      if (path === '/update' && req.method === 'POST') {
        const body = (await req.json().catch(() => null)) as UpdateBody | null;
        if (!body) throw new AppError('BAD_REQUEST', 'Invalid JSON body', 400);

        const subjectId = body.subjectId;
        const sectionId = body.sectionId;
        const seats = body.seats;
        const maxSeats = body.maxSeats;

        if (
          typeof subjectId !== 'number' ||
          typeof sectionId !== 'number' ||
          typeof seats !== 'number' ||
          typeof maxSeats !== 'number' ||
          !Number.isFinite(subjectId) ||
          !Number.isFinite(sectionId) ||
          !Number.isFinite(seats) ||
          !Number.isFinite(maxSeats)
        ) {
          throw new AppError('BAD_REQUEST', 'subjectId, sectionId, seats, maxSeats must be numbers', 400);
        }

        if (subjectId <= 0 || sectionId <= 0) throw new AppError('BAD_REQUEST', 'Invalid ids', 400);
        if (seats < 0 || maxSeats <= 0 || seats > maxSeats)
          throw new AppError('BAD_REQUEST', 'Invalid seat values', 400);

        this.log('update', { subjectId, sectionId, seats, maxSeats });

        await this.ensureMetaFromBody(body);
        await this.upsertSectionState(sectionId, seats, maxSeats);
        this.log('update:ok', { subjectId, sectionId });

        return json({ ok: true });
      }

      if (path === '/status' && req.method === 'GET') {
        const meta = await this.getMeta();
        if (!meta) return json({ meta: null, note: 'No meta yet; waiting for first /update' });

        const payload = await this.buildKvPayload(meta.subjectId);
        return json({ meta, payload });
      }

      return new Response('Not found', { status: 404 });
    } catch (e) {
      return fromError(e);
    }
  }

  // No WS commands for SubjectDO
  async webSocketMessage(_ws: WebSocket, _message: string) {}
  async webSocketClose(_ws: WebSocket) {}
  async webSocketError(_ws: WebSocket) {}

  private log(event: string, data?: any) {
    console.log(`[DO:${this.constructor.name}]`, event, data ?? '');
  }
  private warn(event: string, data?: any) {
    console.warn(`[DO:${this.constructor.name}]`, event, data ?? '');
  }
}
