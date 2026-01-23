import type { DurableObjectState } from '@cloudflare/workers-types';

import { ChatStore, deliverMessage } from '../durable/chat';
import { AppError } from '../durable/errors';
import { fromError, json } from '../durable/http';
import { isClientAction } from '../durable/protocol';
import { TokenBucket } from '../durable/rate-limit';
import { broadcast, parseJsonMessage, sendJson, upgradeToWebSocket, type AnyWebSocket } from '../durable/ws';
import type { Env, Role } from '../env';

type Identity = { userId: string; role: Role };

const ALLOWED_TABLES = [
  'user',
  'session',
  'account',
  'verification',
  'jwks',
  'phase_schedule',
  'admin',
  'faculty',
  'student',
  'subject',
  'section',
  'enrollment',
  'section_selection',
  'group',
  'group_invite',
  'group_member',
  'swap',
  'swap_invite',
  'swap_participant',
  'notification',
] as const;

export class AdminDO {
  private ident: Identity | null = null;

  private chat = new ChatStore();
  private chatBucket = new TokenBucket(1, 1); // 1 msg/sec for chat only

  constructor(
    private state: DurableObjectState,
    private env: Env,
  ) {
    this.state.blockConcurrencyWhile(async () => {
      const db = await this.state.storage.sql;
      db.exec(`
        CREATE TABLE IF NOT EXISTS meta (
          k TEXT PRIMARY KEY NOT NULL,
          v TEXT NOT NULL
        );
      `);

      this.log('instance:start', { actorId: state.id.toString(), at: Date.now() });
    });
  }

  private readIdentity(req: Request): Identity {
    const userId = req.headers.get('x-actor-user-id') || '';
    const role = (req.headers.get('x-actor-user-role') || '') as Role;
    if (!userId) throw new AppError('MISSING_IDENTITY', 'Missing x-actor-user-id', 401);
    if (!role) throw new AppError('MISSING_IDENTITY', 'Missing x-actor-user-role', 401);
    return { userId, role };
  }

  private ensureAdmin() {
    if (!this.ident || this.ident.role !== 'admin') throw new AppError('FORBIDDEN', 'Admin actor only', 403);
  }

  private parseLimit(url: URL): number {
    const raw = url.searchParams.get('limit');
    const n = raw ? Number(raw) : 100;
    if (!Number.isFinite(n) || n <= 0) return 100;
    return Math.min(1000, Math.floor(n));
  }

  async fetch(req: Request): Promise<Response> {
    try {
      const url = new URL(req.url);

      if (url.pathname === '/ws' && req.method === 'GET') {
        const ident = this.readIdentity(req);
        this.ident = ident;
        this.log('ws:connect', { userId: ident.userId });

        this.ensureAdmin();

        const { response, server } = upgradeToWebSocket(this.state);

        sendJson(
          server as AnyWebSocket,
          { type: 'hello', actor: 'admin', userId: ident.userId, role: ident.role, nowMs: Date.now() } as any,
        );
        sendJson(
          server as AnyWebSocket,
          { type: 'status', nowMs: Date.now(), data: { allowedTables: ALLOWED_TABLES } } as any,
        );

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

      // Debugging endpoints (no rate limiting)
      if (url.pathname === '/tables' && req.method === 'GET') {
        return json({ tables: ALLOWED_TABLES });
      }

      if (url.pathname === '/table' && req.method === 'GET') {
        const ident = this.ident ?? this.readIdentity(req);
        this.ident = ident;
        this.ensureAdmin();

        const name = url.searchParams.get('name') || '';
        if (!ALLOWED_TABLES.includes(name as any)) throw new AppError('FORBIDDEN_TABLE', 'Table not allowed', 403);

        const limit = this.parseLimit(url);

        this.log('debug:table', { name, limit, userId: ident.userId });

        // Use D1 directly for debugging reads (still “Drizzle related to D1” overall),
        // but Drizzle doesn't support dynamic table selection safely without boilerplate.
        // This is admin-only and allowlisted.
        const res = await this.env.DB.prepare(`SELECT * FROM "${name}" LIMIT ?;`).bind(limit).all();
        return json({ table: name, limit, rows: res.results });
      }

      return new Response('Not found', { status: 404 });
    } catch (e) {
      return fromError(e);
    }
  }

  async webSocketMessage(ws: WebSocket, message: any) {
    const msg = parseJsonMessage(message);
    if (!msg) return;
    if (!isClientAction(msg)) return;

    if (!this.ident) return;
    this.ensureAdmin();

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

      if (!this.chatBucket.take(1)) {
        sendJson(
          ws as any,
          { type: 'error', requestId: msg.id, code: 'RATE_LIMITED', message: '1 message per second' } as any,
        );
        return;
      }

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
      sendJson(ws as any, { type: 'status', nowMs: Date.now(), data: { allowedTables: ALLOWED_TABLES } } as any);
      return;
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
