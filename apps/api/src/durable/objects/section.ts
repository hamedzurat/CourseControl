import type { DurableObjectState } from '@cloudflare/workers-types';
import { and, eq, inArray } from 'drizzle-orm';

import { baUser, notification as notificationTable, sectionSelection, section as sectionTable } from '../../db/schema';
import type { Env } from '../../env';
import { getDb } from '../../lib/db';
import { AppError, asAppError } from '../utils/errors';
import { fromError, json } from '../utils/http';
import { getPhase } from '../utils/phase';
import { broadcast, parseJsonMessage, sendJson, upgradeToWebSocket, type AnyWebSocket } from '../utils/ws';

type SectionMeta = {
  sectionId: number;
  subjectId: number;
  maxSeats: number;
  timeslotMask: number;
};

type TakeBody = { studentUserId: string };
type DropBody = { studentUserId: string };
type ChangeFromBody = { studentUserId: string; fromSectionId: number };

export class SectionDO {
  private meta: SectionMeta | null = null;
  private lastSnapshotAtMs = 0;
  private lastSeatsLeftSent: number | null = null;

  constructor(
    private state: DurableObjectState,
    private env: Env,
  ) {
    this.state.blockConcurrencyWhile(async () => {
      await this.initSql();
      /** Schedule periodic snapshots */
      await this.ensureAlarm(1_000);
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
      CREATE TABLE IF NOT EXISTS member (
        studentUserId TEXT PRIMARY KEY NOT NULL,
        joinedAtMs INTEGER NOT NULL
      );
    `);

    db.exec(`
      CREATE TABLE IF NOT EXISTS hold (
        studentUserId TEXT PRIMARY KEY NOT NULL,
        createdAtMs INTEGER NOT NULL,
        expiresAtMs INTEGER NOT NULL
      );
    `);
  }

  private async ensureAlarm(delayMs: number) {
    await this.state.storage.setAlarm(Date.now() + delayMs);
  }

  private async getSeatNumbers(meta: SectionMeta) {
    const taken = await this.seatCount();
    const seatsLeft = Math.max(0, meta.maxSeats - taken);
    return { taken, seatsLeft };
  }

  private async pushSeatsLeftToSubject(meta: SectionMeta, seatsLeft: number) {
    try {
      const stub = this.env.SUBJECT_DO.get(this.env.SUBJECT_DO.idFromName(String(meta.subjectId)));
      await stub.fetch('https://do/update', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          subjectId: meta.subjectId,
          sectionId: meta.sectionId,
          seats: seatsLeft, // IMPORTANT: seatsLeft, not taken
          maxSeats: meta.maxSeats,
        }),
      });

      console.log(`[DO:SectionDO] subject:update`, {
        sectionId: meta.sectionId,
        subjectId: meta.subjectId,
        seatsLeft,
        maxSeats: meta.maxSeats,
      });
    } catch (e) {
      console.log(`[DO:SectionDO] subject:update:fail`, {
        sectionId: meta.sectionId,
        subjectId: meta.subjectId,
        error: String((e as any)?.message ?? e),
      });
    }
  }

  private async loadMetaFromD1(sectionId: number): Promise<SectionMeta> {
    const db = getDb(this.env);

    const rows = await db
      .select({
        id: sectionTable.id,
        subjectId: sectionTable.subjectId,
        maxSeats: sectionTable.maxSeats,
        timeslotMask: sectionTable.timeslotMask,
      })
      .from(sectionTable)
      .where(eq(sectionTable.id, sectionId))
      .limit(1);

    if (!rows.length) throw new AppError('SECTION_NOT_FOUND', `section ${sectionId} not found`, 404);

    const r = rows[0];
    return {
      sectionId: r.id,
      subjectId: r.subjectId,
      maxSeats: r.maxSeats,
      timeslotMask: r.timeslotMask,
    };
  }

  private async getSectionIdFromName(req: Request): Promise<number> {
    // DO is created by idFromName(sectionIdStr), so name is the section id string.
    // But Workers DO API doesn't give us the name directly; so we require query param id for /ws debugging,
    // and for POST endpoints we rely on the DO instance already being the correct one.
    // For safety we still accept ?id=... and validate if provided.

    const url = new URL(req.url);
    const idParam = url.searchParams.get('id');
    if (!idParam) {
      // Many internal calls won't include it; in that case we attempt to read meta from storage.
      const cached = await this.getCachedMeta();
      if (cached) return cached.sectionId;
      throw new AppError('MISSING_ID', 'Missing ?id=<sectionId> on first request to SectionDO', 400);
    }
    const id = Number(idParam);
    if (!Number.isFinite(id) || id <= 0) throw new AppError('INVALID_ID', 'Invalid section id', 400);
    return id;
  }

  private async getCachedMeta(): Promise<SectionMeta | null> {
    if (this.meta) return this.meta;

    const db = await this.state.storage.sql;
    const rows = db.exec(`SELECT v FROM meta WHERE k='meta' LIMIT 1;`).toArray() as { v: string }[];
    if (!rows.length) return null;

    try {
      const meta = JSON.parse(rows[0].v) as SectionMeta;
      this.meta = meta;
      return meta;
    } catch {
      return null;
    }
  }

  private async setCachedMeta(meta: SectionMeta) {
    this.meta = meta;
    const db = await this.state.storage.sql;
    db.exec(`INSERT OR REPLACE INTO meta (k, v) VALUES ('meta', ?);`, JSON.stringify(meta));
  }

  private async ensureMeta(req: Request): Promise<SectionMeta> {
    const cached = await this.getCachedMeta();
    if (cached) return cached;

    const sectionId = await this.getSectionIdFromName(req);
    const meta = await this.loadMetaFromD1(sectionId);
    await this.setCachedMeta(meta);
    return meta;
  }

  private async seatCount(): Promise<number> {
    const db = await this.state.storage.sql;
    const rows = db.exec(`SELECT COUNT(*) as c FROM member;`).toArray() as { c: number }[];
    return rows[0]?.c ?? 0;
  }

  private async hasMember(studentUserId: string): Promise<boolean> {
    const db = await this.state.storage.sql;
    const rows = db.exec(`SELECT 1 as ok FROM member WHERE studentUserId=? LIMIT 1;`, studentUserId).toArray();
    return rows.length > 0;
  }

  private async insertMember(studentUserId: string) {
    const db = await this.state.storage.sql;
    db.exec(`INSERT OR REPLACE INTO member (studentUserId, joinedAtMs) VALUES (?, ?);`, studentUserId, Date.now());
  }

  private async deleteMember(studentUserId: string) {
    const db = await this.state.storage.sql;
    db.exec(`DELETE FROM member WHERE studentUserId=?;`, studentUserId);
  }

  private async readMembers(): Promise<{ studentUserId: string; joinedAtMs: number }[]> {
    const db = await this.state.storage.sql;
    return db.exec(`SELECT studentUserId, joinedAtMs FROM member ORDER BY joinedAtMs ASC;`).toArray() as any;
  }

  private async snapshotToD1(meta: SectionMeta) {
    const db = getDb(this.env);
    const members = await this.readMembers();

    /**
     * Authoritative Sync:
     * We overwrite the D1 state with our local truth. This ensures that even if
     * D1 was stale or incorrect, the DO's state eventually prevails.
     */
    // Since key is (studentUserId, subjectId), we upsert those rows.
    // Also: removing students from this section doesn't remove their selection for subject if they've moved elsewhere,
    // but StudentDO/SectionDO workflow should ensure correctness. We'll keep it simple: upsert existing members.
    const nowMs = Date.now();

    // Small batches to avoid huge payloads
    const chunkSize = 200;
    for (let i = 0; i < members.length; i += chunkSize) {
      const chunk = members.slice(i, i + chunkSize);

      await db
        .insert(sectionSelection)
        .values(
          chunk.map((m) => ({
            studentUserId: m.studentUserId,
            subjectId: meta.subjectId,
            sectionId: meta.sectionId,
            selectedAtMs: nowMs,
          })),
        )
        .onConflictDoUpdate({
          target: [sectionSelection.studentUserId, sectionSelection.subjectId],
          set: {
            sectionId: meta.sectionId,
            selectedAtMs: nowMs,
          },
        });
    }
  }

  private async backupSnapshotToR2(meta: SectionMeta, errMsg: string) {
    const members = await this.readMembers();
    const payload = {
      meta,
      members,
      error: errMsg,
      createdAtMs: Date.now(),
    };
    const key = `section-snapshots/${meta.sectionId}/${Date.now()}.json`;
    await this.env.R2_STATE.put(key, JSON.stringify(payload), {
      httpMetadata: { contentType: 'application/json' },
    });
    return key;
  }

  private async notifyAdmin(meta: SectionMeta, message: string, extra?: any) {
    const db = getDb(this.env);
    await db.insert(notificationTable).values({
      createdByUserId: 'system',
      audienceRole: 'admin',
      audienceUserId: null,
      title: `Section snapshot failed (section ${meta.sectionId})`,
      body: `${message}\n${extra ? JSON.stringify(extra) : ''}`,
      createdAtMs: Date.now(),
    });
  }

  async alarm() {
    try {
      const { phase } = await getPhase(this.env);
      const meta = await this.ensureMeta(new Request('https://local/')); // meta must already be cached once

      // During selection: publish seatsLeft frequently + snapshot less frequently.
      if (phase === 'selection') {
        const now = Date.now();
        const { seatsLeft } = await this.getSeatNumbers(meta);

        // push KV signal only if it changed (or first time)
        if (this.lastSeatsLeftSent === null || this.lastSeatsLeftSent !== seatsLeft) {
          this.lastSeatsLeftSent = seatsLeft;
          await this.pushSeatsLeftToSubject(meta, seatsLeft);
        }

        // snapshot to D1 every 10s
        if (now - this.lastSnapshotAtMs >= 10_000) {
          this.lastSnapshotAtMs = now;
          this.log(`snapshot:d1`, { sectionId: meta.sectionId, subjectId: meta.subjectId });
          await this.safeSnapshot(meta);
        }

        await this.ensureAlarm(1_000);
        return;
      }

      // Outside selection: do a final snapshot once and stop scheduling.
      if (phase === 'between' || phase === 'swap' || phase === 'post') {
        this.log(`snapshot:final`, { phase, sectionId: meta.sectionId, subjectId: meta.subjectId });
        await this.safeSnapshot(meta);
        return;
      }

      // pre: just wake up occasionally so you can “warm” them
      await this.ensureAlarm(15_000);
    } catch (e) {
      this.log(`alarm:error`, String((e as any)?.message ?? e));
      await this.state.storage.setAlarm(Date.now() + 30_000);
    }
  }

  private async safeSnapshot(meta: SectionMeta) {
    try {
      await this.snapshotToD1(meta);
    } catch (e) {
      const err = asAppError(e);
      const key = await this.backupSnapshotToR2(meta, `${err.code}: ${err.message}`);
      await this.notifyAdmin(meta, 'D1 snapshot write failed; backed up to R2.', { r2Key: key });
    }
  }

  async fetch(req: Request): Promise<Response> {
    try {
      const url = new URL(req.url);
      const path = url.pathname;
      this.log('fetch', { method: req.method, path, id: url.searchParams.get('id') });

      // Ensure meta is loaded for any request that provides ?id=...
      // For internal calls without ?id=..., meta should already be cached after first ws connection.
      if (path === '/ws') {
        const meta = await this.ensureMeta(req);
        const { response, server } = upgradeToWebSocket(this.state);

        // hello + initial status
        sendJson(server as AnyWebSocket, { type: 'hello', actor: 'section', nowMs: Date.now() } as any);
        const { taken, seatsLeft } = await this.getSeatNumbers(meta);
        sendJson(server as AnyWebSocket, {
          type: 'status',
          nowMs: Date.now(),
          data: {
            sectionId: meta.sectionId,
            subjectId: meta.subjectId,
            seatsLeft,
            seatsTaken: taken,
            maxSeats: meta.maxSeats,
          },
        });

        return response;
      }

      if (path === '/status' && req.method === 'GET') {
        const meta = await this.ensureMeta(req);
        const members = await this.readMembers();

        let membersWithNames = members.map((m) => ({ ...m, name: m.studentUserId }));

        if (members.length > 0) {
          try {
            const ids = members.map((m) => m.studentUserId);
            const db = getDb(this.env);
            const users = await db
              .select({
                id: baUser.id,
                name: baUser.name,
              })
              .from(baUser)
              .where(inArray(baUser.id, ids));

            const nameMap = new Map<string, string>();
            for (const u of users) {
              nameMap.set(u.id, u.name);
            }

            membersWithNames = members.map((m) => ({
              ...m,
              name: nameMap.get(m.studentUserId) || m.studentUserId,
            }));
          } catch (e) {
            console.error('Failed to hydrate names', e);
          }
        }

        return json({
          meta,
          seats: members.length,
          members: membersWithNames,
        });
      }

      if (path === '/take' && req.method === 'POST') {
        console.log('sectionDO - take');

        const meta = await this.ensureMeta(req);
        const { phase } = await getPhase(this.env);
        if (phase !== 'selection') throw new AppError('PHASE_NOT_SELECTION', 'Not in selection phase', 409);

        const body = (await req.json().catch(() => null)) as TakeBody | null;
        const studentUserId = body?.studentUserId;
        this.log('take', { sectionId: meta.sectionId, studentUserId });
        if (!studentUserId) throw new AppError('BAD_REQUEST', 'studentUserId required', 400);

        if (await this.hasMember(studentUserId)) {
          // idempotent take
          return json({ ok: true, seats: await this.seatCount(), maxSeats: meta.maxSeats });
        }

        const { taken } = await this.getSeatNumbers(meta);
        if (taken >= meta.maxSeats) throw new AppError('SECTION_FULL', 'No seats available', 409);

        await this.insertMember(studentUserId);

        const after = await this.seatCount();
        this.log('take:ok', { sectionId: meta.sectionId, studentUserId, seats: after, maxSeats: meta.maxSeats });

        broadcast(this.state, {
          type: 'status',
          nowMs: Date.now(),
          data: { sectionId: meta.sectionId, subjectId: meta.subjectId, seats: after, maxSeats: meta.maxSeats },
        });

        return json({ ok: true, seats: after, maxSeats: meta.maxSeats });
      }

      if (path === '/drop' && req.method === 'POST') {
        console.log('sectionDO - drop');

        const meta = await this.ensureMeta(req);
        const { phase } = await getPhase(this.env);
        if (phase !== 'selection') throw new AppError('PHASE_NOT_SELECTION', 'Not in selection phase', 409);

        const body = (await req.json().catch(() => null)) as DropBody | null;
        const studentUserId = body?.studentUserId;
        this.log('drop', { sectionId: meta.sectionId, studentUserId });
        if (!studentUserId) throw new AppError('BAD_REQUEST', 'studentUserId required', 400);

        if (!(await this.hasMember(studentUserId))) {
          // idempotent
          return json({ ok: true, seats: await this.seatCount(), maxSeats: meta.maxSeats });
        }

        await this.deleteMember(studentUserId);
        const after = await this.seatCount();
        this.log('drop:ok', { sectionId: meta.sectionId, studentUserId, seats: after });

        broadcast(this.state, {
          type: 'status',
          nowMs: Date.now(),
          data: { sectionId: meta.sectionId, subjectId: meta.subjectId, seats: after, maxSeats: meta.maxSeats },
        });

        return json({ ok: true, seats: after, maxSeats: meta.maxSeats });
      }

      if (path === '/changeFrom' && req.method === 'POST') {
        console.log('sectionDO - changefrom');

        // Per your spec: studentDO sends to destination section with info about previous section.
        // This endpoint behaves like /take but includes fromSectionId for auditing/future logic.
        const meta = await this.ensureMeta(req);
        const { phase } = await getPhase(this.env);
        if (phase !== 'selection') throw new AppError('PHASE_NOT_SELECTION', 'Not in selection phase', 409);

        const body = (await req.json().catch(() => null)) as ChangeFromBody | null;
        const studentUserId = body?.studentUserId;
        const fromSectionId = body?.fromSectionId;
        this.log('changeFrom', { toSectionId: meta.sectionId, fromSectionId, studentUserId });

        if (!studentUserId || typeof fromSectionId !== 'number') {
          throw new AppError('BAD_REQUEST', 'studentUserId and fromSectionId required', 400);
        }

        // just perform take (StudentDO will drop old section via old sectionDO separately)
        if (await this.hasMember(studentUserId)) {
          return json({ ok: true, seats: await this.seatCount(), maxSeats: meta.maxSeats });
        }

        const seats = await this.seatCount();
        if (seats >= meta.maxSeats) throw new AppError('SECTION_FULL', 'No seats available', 409);

        await this.insertMember(studentUserId);
        const after = await this.seatCount();
        this.log('changeFrom:ok', { toSectionId: meta.sectionId, fromSectionId, studentUserId, seats: after });

        broadcast(this.state, {
          type: 'status',
          nowMs: Date.now(),
          data: {
            sectionId: meta.sectionId,
            subjectId: meta.subjectId,
            seats: after,
            maxSeats: meta.maxSeats,
            changedFrom: fromSectionId,
          },
        });

        return json({ ok: true, seats: after, maxSeats: meta.maxSeats });
      }

      return new Response('Not found', { status: 404 });
    } catch (e) {
      this.warn('fetch:error', { err: String((e as any)?.message ?? e) });
      return fromError(e);
    }
  }

  // Optional: if we later want to handle WS messages (e.g. live observers), we can.
  async webSocketMessage(_ws: WebSocket, message: string) {
    const msg = parseJsonMessage(message);
    if (!msg) return;
    // currently no client-driven commands for SectionDO
  }

  async webSocketClose(_ws: WebSocket) {}
  async webSocketError(_ws: WebSocket) {}

  private log(event: string, data?: any) {
    console.log(`[DO:${this.constructor.name}]`, event, data ?? '');
  }
  private warn(event: string, data?: any) {
    console.warn(`[DO:${this.constructor.name}]`, event, data ?? '');
  }
}
