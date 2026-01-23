import type { DurableObjectState } from '@cloudflare/workers-types';
import { and, eq, inArray } from 'drizzle-orm';

import { baUser, section as sectionTable, subject as subjectTable } from '../../db/schema';
import type { Env, Role } from '../../env';
import { getDb } from '../../lib/db';
import { ChatStore, deliverMessage } from '../utils/chat';
import { AppError } from '../utils/errors';
import { fromError, json } from '../utils/http';
import { getSubjectKv } from '../utils/kv';
import { getPhase } from '../utils/phase';
import { isClientAction } from '../utils/protocol';
import { TokenBucket } from '../utils/rate-limit';
import { broadcast, parseJsonMessage, sendJson, upgradeToWebSocket, type AnyWebSocket } from '../utils/ws';

type Identity = { userId: string; role: Role };

export class FacultyDO {
  private ident: Identity | null = null;

  /** Cache of what faculty teaches */
  private taughtSectionIds = new Set<number>();
  private taughtSubjectIds = new Set<number>();

  // chat + rate limit
  private chat = new ChatStore();
  private chatBucket = new TokenBucket(1, 1); /** Rate limit: 1 msg/sec */

  constructor(
    private state: DurableObjectState,
    private env: Env,
  ) {
    this.state.blockConcurrencyWhile(async () => {
      await this.initSql();
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
  }

  private async ensureAlarm(delayMs: number) {
    await this.state.storage.setAlarm(Date.now() + delayMs);
  }

  private readIdentity(req: Request): Identity {
    const userId = req.headers.get('x-actor-user-id') || '';
    const role = (req.headers.get('x-actor-user-role') || '') as Role;
    if (!userId) throw new AppError('MISSING_IDENTITY', 'Missing x-actor-user-id', 401);
    if (!role) throw new AppError('MISSING_IDENTITY', 'Missing x-actor-user-role', 401);
    return { userId, role };
  }

  private async loadTeaching(userId: string) {
    const db = getDb(this.env);

    const rows = await db
      .select({
        sectionId: sectionTable.id,
        subjectId: sectionTable.subjectId,
      })
      .from(sectionTable)
      .where(and(eq(sectionTable.facultyUserId, userId), eq(sectionTable.published, 1)));

    this.taughtSectionIds = new Set(rows.map((r) => r.sectionId));
    this.taughtSubjectIds = new Set(rows.map((r) => r.subjectId));
  }

  private async buildFacultyInfo(userId: string) {
    const db = getDb(this.env);

    const userRows = await db
      .select({ id: baUser.id, name: baUser.name, email: baUser.email, image: baUser.image })
      .from(baUser)
      .where(eq(baUser.id, userId))
      .limit(1);

    const facultyRow = userRows[0] ?? null;

    const subjectIds = Array.from(this.taughtSubjectIds);
    let subjects: any[] = [];
    if (subjectIds.length) {
      subjects = await db
        .select({ id: subjectTable.id, code: subjectTable.code, name: subjectTable.name })
        .from(subjectTable)
        .where(and(eq(subjectTable.published, 1), inArray(subjectTable.id, subjectIds)));
    }

    return { faculty: facultyRow, subjects };
  }

  private async pushSeatStatus() {
    if (!this.ident) return;
    this.log('seat_status:push', { userId: this.ident.userId, subjects: Array.from(this.taughtSubjectIds) });

    const subjectIds = Array.from(this.taughtSubjectIds);
    const seatPayload: Record<string, any> = {};

    for (const sid of subjectIds) {
      const kv = await getSubjectKv(this.env, sid);
      if (!kv || !kv.sections) {
        seatPayload[String(sid)] = null;
        continue;
      }

      // Only include sections taught by this faculty
      const filtered: Record<string, any> = {};
      for (const [sectionIdStr, v] of Object.entries<any>(kv.sections)) {
        const sectionId = Number(sectionIdStr);
        if (this.taughtSectionIds.has(sectionId)) filtered[sectionIdStr] = v;
      }

      seatPayload[String(sid)] = {
        subjectId: sid,
        updatedAtMs: kv.updatedAtMs ?? Date.now(),
        sections: filtered,
      };
    }

    broadcast(this.state, {
      type: 'seat_status',
      nowMs: Date.now(),
      subjects: seatPayload,
    } as any);
  }

  async alarm() {
    try {
      const { phase } = await getPhase(this.env);

      // Poll faster during selection, slower otherwise
      const delayMs = phase === 'selection' ? 1_000 : 5_000;

      // If already initialized, keep pushing seat status periodically
      if (this.ident) {
        await this.pushSeatStatus();
      }

      await this.ensureAlarm(delayMs);
    } catch {
      await this.ensureAlarm(5_000);
    }
  }

  async fetch(req: Request): Promise<Response> {
    try {
      const url = new URL(req.url);

      if (url.pathname === '/ws' && req.method === 'GET') {
        const ident = this.readIdentity(req);
        if (ident.role !== 'faculty') throw new AppError('FORBIDDEN', 'Faculty actor only', 403);

        this.ident = ident;
        this.log('ws:connect', { userId: ident.userId });

        await this.loadTeaching(ident.userId);
        this.log('teaching:loaded', { taughtSectionIds: Array.from(this.taughtSectionIds) });

        const info = await this.buildFacultyInfo(ident.userId);

        const { response, server } = upgradeToWebSocket(this.state);

        sendJson(
          server as AnyWebSocket,
          { type: 'hello', actor: 'faculty', userId: ident.userId, role: ident.role, nowMs: Date.now() } as any,
        );
        sendJson(server as AnyWebSocket, {
          type: 'status',
          nowMs: Date.now(),
          data: { ...info, taughtSectionIds: Array.from(this.taughtSectionIds) },
        });

        // Push current seat status immediately
        await this.pushSeatStatus();

        return response;
      }

      // Receive chat from other DOs
      if (url.pathname === '/message' && req.method === 'POST') {
        const body = (await req.json().catch(() => null)) as null | {
          fromUserId: string;
          toUserId: string;
          text: string;
          atMs?: number;
        };
        if (!body?.fromUserId || !body?.toUserId || !body?.text)
          throw new AppError('BAD_REQUEST', 'Invalid message body', 400);

        this.chat.addIn(body.fromUserId, body.text, body.atMs ?? Date.now());

        broadcast(this.state, {
          type: 'chat',
          nowMs: Date.now(),
          fromUserId: body.fromUserId,
          toUserId: body.toUserId,
          text: body.text,
        } as any);

        return json({ ok: true });
      }

      // Debug
      if (url.pathname === '/status' && req.method === 'GET') {
        return json({
          ident: this.ident,
          taughtSubjectIds: Array.from(this.taughtSubjectIds),
          taughtSectionIds: Array.from(this.taughtSectionIds),
        });
      }

      return new Response('Not found', { status: 404 });
    } catch (e) {
      return fromError(e);
    }
  }

  async webSocketMessage(ws: WebSocket, message: any) {
    const msg = parseJsonMessage(message);
    if (!msg) return;

    // Only one client action we care about now: message + status
    if (!isClientAction(msg)) return;
    if (!this.ident) return;

    if (msg.action === 'message') {
      const payload = msg.payload as any;
      const toUserId = String(payload?.toUserId ?? '');
      const text = String(payload?.text ?? '').trim();

      if (!toUserId || !text) {
        sendJson(
          ws as any,
          { type: 'error', requestId: msg.id, code: 'BAD_REQUEST', message: 'toUserId and text required' } as any,
        );
        return;
      }

      // 1 msg/sec
      if (!this.chatBucket.take(1)) {
        sendJson(
          ws as any,
          { type: 'error', requestId: msg.id, code: 'RATE_LIMITED', message: '1 message per second' } as any,
        );
        return;
      }

      // store local outbox + deliver
      this.chat.addOut(toUserId, text);

      try {
        await deliverMessage(this.env, this.ident.userId, toUserId, text);
        sendJson(ws as any, { type: 'chat', nowMs: Date.now(), fromUserId: this.ident.userId, toUserId, text } as any);
      } catch (e: any) {
        sendJson(
          ws as any,
          {
            type: 'error',
            requestId: msg.id,
            code: 'DELIVERY_FAILED',
            message: e?.message ?? 'delivery failed',
          } as any,
        );
      }

      return;
    }

    if (msg.action === 'status') {
      const info = await this.buildFacultyInfo(this.ident.userId);
      sendJson(
        ws as any,
        {
          type: 'status',
          nowMs: Date.now(),
          data: { ...info, taughtSectionIds: Array.from(this.taughtSectionIds) },
        } as any,
      );
      await this.pushSeatStatus();
    }
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
