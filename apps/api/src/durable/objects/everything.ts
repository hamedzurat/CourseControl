import type { DurableObjectState } from '@cloudflare/workers-types';
import { eq, inArray } from 'drizzle-orm';

import { section as sectionTable } from '../../db/schema';
import type { Env } from '../../env';
import { getDb } from '../../lib/db';
import { fromError, json } from '../utils/http';
import { getPhase } from '../utils/phase';
import { sendJson, upgradeToWebSocket, type AnyWebSocket } from '../utils/ws';

type EverythingMeta = { singleton: true };

type KvSubjectPayload = {
  subjectId: number;
  updatedAtMs: number;
  sections: Record<
    string,
    {
      sectionId: number;
      seats: number; // seats left
      maxSeats: number;
      updatedAtMs: number;
    }
  >;
};

export class EverythingDO {
  private meta: EverythingMeta | null = null;

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

    db.exec(`
      CREATE TABLE IF NOT EXISTS build_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
        phase TEXT NOT NULL,
        createdAtMs INTEGER NOT NULL,
        r2Etag TEXT,
        sectionsCount INTEGER NOT NULL,
        subjectKvHits INTEGER NOT NULL,
        subjectKvMisses INTEGER NOT NULL,
        sectionKvMisses INTEGER NOT NULL
      );
    `);

    const rows = db.exec(`SELECT 1 FROM meta WHERE k='meta' LIMIT 1;`).toArray();
    if (!rows.length) {
      db.exec(`INSERT INTO meta (k, v) VALUES ('meta', '{"singleton":true}');`);
    }
    this.meta = { singleton: true };
  }

  private async ensureAlarm(delayMs?: number) {
    await this.state.storage.setAlarm(Date.now() + (delayMs ?? 2_000));
  }

  private async readSubjectKv(subjectId: number): Promise<KvSubjectPayload | null> {
    const txt = await this.env.KV_SUBJECT.get(`subject:${subjectId}`);
    if (!txt) return null;
    try {
      return JSON.parse(txt) as KvSubjectPayload;
    } catch {
      return null;
    }
  }

  /**
   * Build R2 state.json as:
   * ```json
   * {
   *   "generatedAtMs": 123,
   *   "source": "kv",
   *   "sections": { ... },
   *   "stats": ...
   * }
   * ```
   *
   * @remarks
   * Rules:
   * - do not include subject metadata
   * - never boot SubjectDO/SectionDO
   * - if section missing in KV => seatsLeft = 0
   */
  private async buildStateFromKvOnly() {
    const db = getDb(this.env);

    // Only published sections matter
    const sections = await db
      .select({
        id: sectionTable.id,
        subjectId: sectionTable.subjectId,
        maxSeats: sectionTable.maxSeats,
      })
      .from(sectionTable)
      .where(eq(sectionTable.published, 1));

    const sectionsCount = sections.length;

    // Unique subject ids (we read KV once per subject)
    const subjectIds = Array.from(new Set(sections.map((s) => Number(s.subjectId))));

    let subjectKvHits = 0;
    let subjectKvMisses = 0;

    // subjectId -> kv payload
    const kvBySubject = new Map<number, KvSubjectPayload | null>();

    for (const sid of subjectIds) {
      const kv = await this.readSubjectKv(sid);
      if (kv) subjectKvHits++;
      else subjectKvMisses++;
      kvBySubject.set(sid, kv);
    }

    let sectionKvMisses = 0;

    const outSections: Record<
      string,
      {
        sectionId: number;
        subjectId: number;
        maxSeats: number;
        seatsLeft: number;
        updatedAtMs: number | null;
      }
    > = {};

    for (const s of sections) {
      const subjectId = Number(s.subjectId);
      const sectionId = Number(s.id);

      const kv = kvBySubject.get(subjectId) ?? null;
      const kvEntry = kv?.sections?.[String(sectionId)] ?? null;

      if (!kvEntry) sectionKvMisses++;

      const maxSeats = Number(kvEntry?.maxSeats ?? s.maxSeats ?? 0);
      const seatsLeft = Number(kvEntry?.seats ?? 0);
      const updatedAtMs = typeof kvEntry?.updatedAtMs === 'number' ? kvEntry.updatedAtMs : null;

      outSections[String(sectionId)] = {
        sectionId,
        subjectId,
        maxSeats,
        seatsLeft,
        updatedAtMs,
      };
    }

    const generatedAtMs = Date.now();

    const state = {
      generatedAtMs,
      source: 'kv',
      sections: outSections,
      stats: {
        sectionsCount,
        subjectsCount: subjectIds.length,
        subjectKvHits,
        subjectKvMisses,
        sectionKvMisses,
      },
    };

    return { state, sectionsCount, subjectKvHits, subjectKvMisses, sectionKvMisses };
  }

  private async writeStateToR2(state: any) {
    const body = JSON.stringify(state);
    const put = await this.env.R2_STATE.put('state.json', body, {
      httpMetadata: { contentType: 'application/json' },
    });
    return put?.etag ?? null;
  }

  async alarm() {
    try {
      const { phase } = await getPhase(this.env);
      this.log('alarm:phase', { phase });

      // only really needed during selection; outside selection you can slow down
      const delayMs = phase === 'selection' ? 2_000 : 20_000;

      const { state, sectionsCount, subjectKvHits, subjectKvMisses, sectionKvMisses } =
        await this.buildStateFromKvOnly();

      // this.log('build:done', { state, sectionsCount, subjectKvHits, subjectKvMisses, sectionKvMisses });

      const etag = await this.writeStateToR2(state);
      this.log('r2:state.json:put', { etag });

      const sdb = await this.state.storage.sql;
      sdb.exec(
        `INSERT INTO build_log (phase, createdAtMs, r2Etag, sectionsCount, subjectKvHits, subjectKvMisses, sectionKvMisses)
         VALUES (?, ?, ?, ?, ?, ?, ?);`,
        phase,
        Date.now(),
        etag,
        sectionsCount,
        subjectKvHits,
        subjectKvMisses,
        sectionKvMisses,
      );

      await this.ensureAlarm(delayMs);
    } catch {
      // keep alive with backoff
      await this.ensureAlarm(10_000);
    }
  }

  async fetch(req: Request): Promise<Response> {
    try {
      const url = new URL(req.url);
      const path = url.pathname;

      if (path === '/ws' && req.method === 'GET') {
        const { response, server } = upgradeToWebSocket(this.state);

        sendJson(
          server as AnyWebSocket,
          {
            type: 'hello',
            actor: 'everything',
            nowMs: Date.now(),
          } as any,
        );

        const head = await this.env.R2_STATE.head('state.json');
        sendJson(server as AnyWebSocket, {
          type: 'status',
          nowMs: Date.now(),
          data: {
            note: 'EverythingDO writes R2/state.json (sections only)',
            stateJson: head
              ? { size: head.size, etag: head.etag, uploaded: head.uploaded?.toISOString?.() ?? null }
              : null,
          },
        });

        return response;
      }

      if (path === '/build' && req.method === 'POST') {
        const { state } = await this.buildStateFromKvOnly();
        const etag = await this.writeStateToR2(state);
        return json({ ok: true, etag });
      }

      if (path === '/status' && req.method === 'GET') {
        const head = await this.env.R2_STATE.head('state.json');
        const sdb = await this.state.storage.sql;
        const logs = sdb.exec(`SELECT * FROM build_log ORDER BY id DESC LIMIT 20;`).toArray();

        return json({
          stateJson: head
            ? { size: head.size, etag: head.etag, uploaded: head.uploaded?.toISOString?.() ?? null }
            : null,
          last20Builds: logs,
        });
      }

      return new Response('Not found', { status: 404 });
    } catch (e) {
      return fromError(e);
    }
  }

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
