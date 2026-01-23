import type { DurableObjectState } from '@cloudflare/workers-types';
import { and, desc, eq, inArray } from 'drizzle-orm';

import {
  enrollment as enrollmentTable,
  groupInvite as groupInviteTable,
  groupMember as groupMemberTable,
  group as groupTable,
  sectionSelection,
  section as sectionTable,
  subject as subjectTable,
  swapInvite as swapInviteTable,
  swapParticipant as swapParticipantTable,
  swap as swapTable,
} from '../db/schema';
import { ChatStore, deliverMessage } from '../durable/chat';
import { AppError, asAppError } from '../durable/errors';
import { fromError, json } from '../durable/http';
import { inviteCode, randomId } from '../durable/ids';
import { getSubjectKv } from '../durable/kv';
import { getPhase } from '../durable/phase';
import { isClientAction, type ActionName, type QueueItem, type QueueStatus } from '../durable/protocol';
import { TokenBucket } from '../durable/rate-limit';
import { broadcast, parseJsonMessage, sendJson, upgradeToWebSocket, type AnyWebSocket } from '../durable/ws';
import type { Env, Role } from '../env';
import { getDb } from '../lib/db';

type Identity = { userId: string; role: Role };

type TakePayload = { sectionId: number };
type DropPayload = { subjectId: number };
type ChangePayload = { toSectionId: number };

type GroupCreatePayload = { subjectId: number };
type GroupInvitePayload = { groupId: number; count: number; expiresInMs?: number };
type GroupJoinPayload = { code: string };
type GroupLeavePayload = { groupId: number };
type GroupDisbandPayload = { groupId: number };
type GroupTakePayload = { groupId: number; sectionId: number };
type GroupDropPayload = { groupId: number; subjectId: number };
type GroupChangePayload = { groupId: number; toSectionId: number };

type SwapCreatePayload = {};
type SwapInvitePayload = { swapId: number; count: number; expiresInMs?: number };
type SwapJoinPayload = { code: string; giveSectionId: number; wantSectionId: number };
type SwapExecPayload = { swapId: number };

type CancelPayload = { queueId: string };
type MessagePayload = { toUserId: string; text: string };

type InternalApplyBody = {
  // leader DO calls member DO
  action: ActionName;
  payload?: any;
  origin?: { leaderUserId: string; groupId?: number; swapId?: number };
};

export class StudentDO {
  private ident: Identity | null = null;

  private chat = new ChatStore();
  private chatBucket = new TokenBucket(1, 1); // 1 msg/sec

  private processing = false;

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

  // -------------------- SQL schema --------------------
  private async initSql() {
    const db = await this.state.storage.sql;

    db.exec(`
      CREATE TABLE IF NOT EXISTS meta (
        k TEXT PRIMARY KEY NOT NULL,
        v TEXT NOT NULL
      );
    `);

    // queue log (append-only, statuses updated)
    db.exec(`
      CREATE TABLE IF NOT EXISTS queue (
        id TEXT PRIMARY KEY NOT NULL,
        action TEXT NOT NULL,
        status TEXT NOT NULL,
        createdAtMs INTEGER NOT NULL,
        startedAtMs INTEGER,
        finishedAtMs INTEGER,
        errorCode TEXT,
        errorMessage TEXT,
        payloadJson TEXT
      );
    `);

    db.exec(`CREATE INDEX IF NOT EXISTS queue_created_idx ON queue(createdAtMs);`);
    db.exec(`CREATE INDEX IF NOT EXISTS queue_status_idx ON queue(status);`);

    // current selections (authoritative for the student's live UI)
    db.exec(`
      CREATE TABLE IF NOT EXISTS selection (
        subjectId INTEGER PRIMARY KEY NOT NULL,
        sectionId INTEGER NOT NULL,
        timeslotMask INTEGER NOT NULL,
        updatedAtMs INTEGER NOT NULL
      );
    `);

    // enrollment cache
    db.exec(`
      CREATE TABLE IF NOT EXISTS enrolled_subject (
        subjectId INTEGER PRIMARY KEY NOT NULL
      );
    `);

    // last enrollment refresh
    db.exec(`
      CREATE TABLE IF NOT EXISTS kv_cache (
        k TEXT PRIMARY KEY NOT NULL,
        v TEXT NOT NULL
      );
    `);
  }

  private async ensureAlarm(delayMs: number) {
    await this.state.storage.setAlarm(Date.now() + delayMs);
  }

  // -------------------- Identity --------------------
  private readIdentity(req: Request): Identity {
    const userId = req.headers.get('x-actor-user-id') || '';
    const role = (req.headers.get('x-actor-user-role') || '') as Role;
    if (!userId) throw new AppError('MISSING_IDENTITY', 'Missing x-actor-user-id', 401);
    if (!role) throw new AppError('MISSING_IDENTITY', 'Missing x-actor-user-role', 401);
    return { userId, role };
  }

  private ensureStudent() {
    if (!this.ident || this.ident.role !== 'student') throw new AppError('FORBIDDEN', 'Student actor only', 403);
  }

  // -------------------- Helpers: queue --------------------
  private async insertQueue(item: QueueItem) {
    const db = await this.state.storage.sql;
    db.exec(
      `INSERT INTO queue (id, action, status, createdAtMs, payloadJson) VALUES (?, ?, ?, ?, ?);`,
      item.id,
      item.action,
      item.status,
      item.createdAtMs,
      item.payload ? JSON.stringify(item.payload) : null,
    );
  }

  private async updateQueue(id: string, patch: Partial<QueueItem>) {
    const db = await this.state.storage.sql;

    const status = patch.status ?? null;
    const startedAtMs = patch.startedAtMs ?? null;
    const finishedAtMs = patch.finishedAtMs ?? null;
    const errorCode = patch.error?.code ?? null;
    const errorMessage = patch.error?.message ?? null;

    db.exec(
      `UPDATE queue
       SET status = COALESCE(?, status),
           startedAtMs = COALESCE(?, startedAtMs),
           finishedAtMs = COALESCE(?, finishedAtMs),
           errorCode = COALESCE(?, errorCode),
           errorMessage = COALESCE(?, errorMessage)
       WHERE id = ?;`,
      status,
      startedAtMs,
      finishedAtMs,
      errorCode,
      errorMessage,
      id,
    );

    const row = db
      .exec(
        `SELECT id, action, status, createdAtMs, startedAtMs, finishedAtMs, errorCode, errorMessage, payloadJson
         FROM queue WHERE id=? LIMIT 1;`,
        id,
      )
      .toArray()[0] as any;

    if (row) {
      const out: QueueItem = {
        id: row.id,
        action: row.action,
        status: row.status,
        createdAtMs: row.createdAtMs,
        startedAtMs: row.startedAtMs ?? undefined,
        finishedAtMs: row.finishedAtMs ?? undefined,
        error: row.errorCode ? { code: row.errorCode, message: row.errorMessage ?? '' } : undefined,
        payload: row.payloadJson ? JSON.parse(row.payloadJson) : undefined,
      };

      broadcast(this.state, { type: 'queue_update', item: out } as any);
    }
  }

  private async nextQueued(): Promise<{ id: string; action: ActionName; payload: any } | null> {
    const db = await this.state.storage.sql;
    const rows = db
      .exec(
        `SELECT id, action, payloadJson
         FROM queue
         WHERE status='queued'
         ORDER BY createdAtMs ASC
         LIMIT 1;`,
      )
      .toArray() as any[];

    if (!rows.length) return null;
    return {
      id: rows[0].id,
      action: rows[0].action,
      payload: rows[0].payloadJson ? JSON.parse(rows[0].payloadJson) : undefined,
    };
  }

  private async cancelQueued(id: string): Promise<boolean> {
    const db = await this.state.storage.sql;
    const rows = db.exec(`SELECT status FROM queue WHERE id=? LIMIT 1;`, id).toArray() as any[];
    if (!rows.length) return false;
    if (rows[0].status !== 'queued') return false;
    db.exec(`UPDATE queue SET status='cancelled', finishedAtMs=? WHERE id=?;`, Date.now(), id);
    await this.updateQueue(id, { status: 'cancelled' });
    return true;
  }

  private async cancelAllQueued(): Promise<number> {
    const db = await this.state.storage.sql;
    const rows = db.exec(`SELECT id FROM queue WHERE status='queued';`).toArray() as any[];
    for (const r of rows) {
      db.exec(`UPDATE queue SET status='cancelled', finishedAtMs=? WHERE id=?;`, Date.now(), r.id);
      await this.updateQueue(r.id, { status: 'cancelled' });
    }
    return rows.length;
  }

  // -------------------- Helpers: selection + conflict --------------------
  private async currentSelections(): Promise<{ subjectId: number; sectionId: number; timeslotMask: number }[]> {
    const db = await this.state.storage.sql;
    return db.exec(`SELECT subjectId, sectionId, timeslotMask FROM selection ORDER BY subjectId;`).toArray() as any;
  }

  private async upsertSelection(subjectId: number, sectionId: number, timeslotMask: number) {
    const db = await this.state.storage.sql;
    db.exec(
      `INSERT INTO selection (subjectId, sectionId, timeslotMask, updatedAtMs)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(subjectId) DO UPDATE SET
         sectionId=excluded.sectionId,
         timeslotMask=excluded.timeslotMask,
         updatedAtMs=excluded.updatedAtMs;`,
      subjectId,
      sectionId,
      timeslotMask,
      Date.now(),
    );
  }

  private async deleteSelection(subjectId: number) {
    const db = await this.state.storage.sql;
    db.exec(`DELETE FROM selection WHERE subjectId=?;`, subjectId);
  }

  private async selectionForSubject(subjectId: number): Promise<{ sectionId: number; timeslotMask: number } | null> {
    const db = await this.state.storage.sql;
    const rows = db
      .exec(`SELECT sectionId, timeslotMask FROM selection WHERE subjectId=? LIMIT 1;`, subjectId)
      .toArray() as any[];
    if (!rows.length) return null;
    return { sectionId: rows[0].sectionId, timeslotMask: rows[0].timeslotMask };
  }

  private async conflictWith(timeslotMask: number, excludingSubjectId?: number): Promise<boolean> {
    const sel = await this.currentSelections();
    let union = 0;
    for (const s of sel) {
      if (excludingSubjectId && s.subjectId === excludingSubjectId) continue;
      union |= s.timeslotMask;
    }
    return (union & timeslotMask) !== 0;
  }

  // -------------------- Helpers: enrollment cache --------------------
  private async enrollmentRefreshNeeded(): Promise<boolean> {
    const db = await this.state.storage.sql;
    const rows = db.exec(`SELECT v FROM kv_cache WHERE k='enroll_refreshedAtMs' LIMIT 1;`).toArray() as any[];
    if (!rows.length) return true;
    const t = Number(rows[0].v);
    return !Number.isFinite(t) || Date.now() - t > 60_000; // refresh every 60s
  }

  private async refreshEnrollmentIfNeeded() {
    if (!this.ident) return;
    if (!(await this.enrollmentRefreshNeeded())) return;

    const db = getDb(this.env);
    const rows = await db
      .select({ subjectId: enrollmentTable.subjectId })
      .from(enrollmentTable)
      .where(eq(enrollmentTable.studentUserId, this.ident.userId));

    const sdb = await this.state.storage.sql;
    sdb.exec(`DELETE FROM enrolled_subject;`);
    for (const r of rows) {
      sdb.exec(`INSERT OR IGNORE INTO enrolled_subject (subjectId) VALUES (?);`, r.subjectId);
    }
    sdb.exec(`INSERT OR REPLACE INTO kv_cache (k, v) VALUES ('enroll_refreshedAtMs', ?);`, String(Date.now()));
  }

  private async isEnrolled(subjectId: number): Promise<boolean> {
    const db = await this.state.storage.sql;
    const rows = db.exec(`SELECT 1 FROM enrolled_subject WHERE subjectId=? LIMIT 1;`, subjectId).toArray();
    return rows.length > 0;
  }

  // -------------------- Helpers: section info --------------------
  private async getSectionInfo(
    sectionId: number,
  ): Promise<{ sectionId: number; subjectId: number; timeslotMask: number; maxSeats: number }> {
    const db = getDb(this.env);
    const rows = await db
      .select({
        id: sectionTable.id,
        subjectId: sectionTable.subjectId,
        timeslotMask: sectionTable.timeslotMask,
        maxSeats: sectionTable.maxSeats,
      })
      .from(sectionTable)
      .where(eq(sectionTable.id, sectionId))
      .limit(1);

    if (!rows.length) throw new AppError('SECTION_NOT_FOUND', `section ${sectionId} not found`, 404);
    return {
      sectionId: rows[0].id,
      subjectId: rows[0].subjectId,
      timeslotMask: rows[0].timeslotMask,
      maxSeats: rows[0].maxSeats,
    };
  }

  // -------------------- Helpers: sectionDO calls --------------------
  private sectionStub(sectionId: number) {
    const ns = this.env.SECTION_DO;
    return ns.get(ns.idFromName(String(sectionId)));
  }

  private async sectionTake(sectionId: number) {
    const stub = this.sectionStub(sectionId);
    const resp = await stub.fetch(`https://do/take?id=${sectionId}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ studentUserId: this.ident!.userId }),
    });
    if (!resp.ok) {
      const text = await resp.text().catch(() => '');
      throw new AppError('SECTION_TAKE_FAILED', `take failed (${resp.status}): ${text}`, 409);
    }
    return await resp.json().catch(() => ({}));
  }

  private async sectionDrop(sectionId: number) {
    const stub = this.sectionStub(sectionId);
    const resp = await stub.fetch(`https://do/drop?id=${sectionId}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ studentUserId: this.ident!.userId }),
    });
    if (!resp.ok) {
      const text = await resp.text().catch(() => '');
      throw new AppError('SECTION_DROP_FAILED', `drop failed (${resp.status}): ${text}`, 409);
    }
    return await resp.json().catch(() => ({}));
  }

  private async sectionChangeFrom(toSectionId: number, fromSectionId: number) {
    const stub = this.sectionStub(toSectionId);
    const resp = await stub.fetch(`https://do/changeFrom?id=${toSectionId}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ studentUserId: this.ident!.userId, fromSectionId }),
    });
    if (!resp.ok) {
      const text = await resp.text().catch(() => '');
      throw new AppError('SECTION_CHANGE_FAILED', `changeFrom failed (${resp.status}): ${text}`, 409);
    }
    return await resp.json().catch(() => ({}));
  }

  // -------------------- Action handlers --------------------
  private async handleTake(payload: TakePayload) {
    this.log('call:section/take', { sectionId: payload.sectionId });

    const { phase } = await getPhase(this.env);
    if (phase !== 'selection') throw new AppError('PHASE_NOT_SELECTION', 'Not in selection phase', 409);

    const sectionId = Number(payload?.sectionId);
    if (!Number.isFinite(sectionId) || sectionId <= 0) throw new AppError('BAD_REQUEST', 'sectionId required', 400);

    const info = await this.getSectionInfo(sectionId);

    await this.refreshEnrollmentIfNeeded();
    if (!(await this.isEnrolled(info.subjectId)))
      throw new AppError('NOT_ENROLLED', 'Not enrolled for this subject', 403);

    // already selected this subject?
    const existing = await this.selectionForSubject(info.subjectId);
    if (existing) {
      if (existing.sectionId === sectionId) return; // idempotent
      throw new AppError('ALREADY_SELECTED', 'Use change() to move within subject', 409);
    }

    if (await this.conflictWith(info.timeslotMask)) throw new AppError('CONFLICT', 'Timeslot conflict', 409);

    await this.sectionTake(sectionId);
    await this.upsertSelection(info.subjectId, sectionId, info.timeslotMask);
  }

  private async handleDrop(payload: DropPayload) {
    this.log('call:section/drop', { subjectId: payload.subjectId });

    const { phase } = await getPhase(this.env);
    if (phase !== 'selection') throw new AppError('PHASE_NOT_SELECTION', 'Not in selection phase', 409);

    const subjectId = Number(payload?.subjectId);
    if (!Number.isFinite(subjectId) || subjectId <= 0) throw new AppError('BAD_REQUEST', 'subjectId required', 400);

    const existing = await this.selectionForSubject(subjectId);
    if (!existing) return; // idempotent

    await this.sectionDrop(existing.sectionId);
    await this.deleteSelection(subjectId);
  }

  private async handleChange(payload: ChangePayload) {
    this.log('call:section/change', { toSectionId: payload.toSectionId });

    const { phase } = await getPhase(this.env);
    if (phase !== 'selection') throw new AppError('PHASE_NOT_SELECTION', 'Not in selection phase', 409);

    const toSectionId = Number(payload?.toSectionId);
    if (!Number.isFinite(toSectionId) || toSectionId <= 0)
      throw new AppError('BAD_REQUEST', 'toSectionId required', 400);

    const toInfo = await this.getSectionInfo(toSectionId);

    await this.refreshEnrollmentIfNeeded();
    if (!(await this.isEnrolled(toInfo.subjectId)))
      throw new AppError('NOT_ENROLLED', 'Not enrolled for this subject', 403);

    const existing = await this.selectionForSubject(toInfo.subjectId);
    if (!existing) throw new AppError('NOT_SELECTED', 'You have no section in this subject to change from', 409);
    if (existing.sectionId === toSectionId) return;

    if (await this.conflictWith(toInfo.timeslotMask, toInfo.subjectId))
      throw new AppError('CONFLICT', 'Timeslot conflict', 409);

    // Per your rule: send request to destination with info of previous section
    await this.sectionChangeFrom(toSectionId, existing.sectionId);

    // Then drop old; if drop fails, revert by dropping destination best-effort
    try {
      await this.sectionDrop(existing.sectionId);
    } catch {
      try {
        await this.sectionDrop(toSectionId);
      } catch {}
      throw new AppError('CHANGE_DROP_FAILED', 'Changed into destination but failed to drop previous section', 409);
    }

    await this.upsertSelection(toInfo.subjectId, toSectionId, toInfo.timeslotMask);
  }

  // ----- Group (D1-backed) -----
  private async requireGroupLeader(groupId: number) {
    const db = getDb(this.env);
    const rows = await db
      .select({ leaderUserId: groupTable.leaderUserId, isLocked: groupTable.isLocked, subjectId: groupTable.subjectId })
      .from(groupTable)
      .where(eq(groupTable.id, groupId))
      .limit(1);

    if (!rows.length) throw new AppError('GROUP_NOT_FOUND', 'Group not found', 404);
    if (rows[0].leaderUserId !== this.ident!.userId) throw new AppError('FORBIDDEN', 'Leader only', 403);

    return rows[0];
  }

  private async requireGroupUnlocked(groupId: number) {
    const g = await this.requireGroupLeader(groupId);
    if (g.isLocked) throw new AppError('GROUP_LOCKED', 'Group is locked', 409);
    return g;
  }

  private async groupMembers(groupId: number): Promise<string[]> {
    const db = getDb(this.env);
    const rows = await db
      .select({ studentUserId: groupMemberTable.studentUserId })
      .from(groupMemberTable)
      .where(eq(groupMemberTable.groupId, groupId));
    return rows.map((r) => r.studentUserId);
  }

  private async handleGroupCreate(payload: GroupCreatePayload) {
    // const { phase } = await getPhase(this.env);
    // if (phase !== 'selection') throw new AppError('PHASE_NOT_SELECTION', 'Not in selection phase', 409);

    const subjectId = Number(payload?.subjectId);
    if (!Number.isFinite(subjectId) || subjectId <= 0) throw new AppError('BAD_REQUEST', 'subjectId required', 400);

    await this.refreshEnrollmentIfNeeded();
    if (!(await this.isEnrolled(subjectId))) throw new AppError('NOT_ENROLLED', 'Not enrolled for this subject', 403);

    const db = getDb(this.env);
    const inserted = await db
      .insert(groupTable)
      .values({
        subjectId,
        leaderUserId: this.ident!.userId,
        isLocked: 0,
        createdAtMs: Date.now(),
      })
      .returning({ id: groupTable.id });

    const groupId = inserted[0]?.id;
    if (!groupId) throw new AppError('GROUP_CREATE_FAILED', 'Failed to create group', 500);

    // leader is also member
    await db
      .insert(groupMemberTable)
      .values({
        groupId,
        studentUserId: this.ident!.userId,
        joinedAtMs: Date.now(),
      })
      .onConflictDoNothing();
  }

  private async handleGroupInvite(payload: GroupInvitePayload) {
    // const { phase } = await getPhase(this.env);
    // if (phase !== 'selection') throw new AppError('PHASE_NOT_SELECTION', 'Not in selection phase', 409);

    const groupId = Number(payload?.groupId);
    const count = Number(payload?.count ?? 0);
    const expiresInMs = payload?.expiresInMs ? Number(payload.expiresInMs) : null;

    if (!Number.isFinite(groupId) || groupId <= 0) throw new AppError('BAD_REQUEST', 'groupId required', 400);
    if (!Number.isFinite(count) || count <= 0 || count > 50)
      throw new AppError('BAD_REQUEST', 'count must be 1..50', 400);

    await this.requireGroupUnlocked(groupId);

    const db = getDb(this.env);
    const now = Date.now();
    const expiresAtMs = expiresInMs ? now + Math.max(10_000, expiresInMs) : null;

    const codes = Array.from({ length: count }, () => inviteCode(10));
    await db.insert(groupInviteTable).values(
      codes.map((code) => ({
        code,
        groupId,
        createdAtMs: now,
        expiresAtMs,
        usedByUserId: null,
        usedAtMs: null,
      })),
    );

    // send them to client via status
    sendJsonToAll(this.state, {
      type: 'status',
      nowMs: Date.now(),
      data: { groupInvites: codes },
    });
  }

  private async handleGroupJoin(payload: GroupJoinPayload) {
    // const { phase } = await getPhase(this.env);
    // if (phase !== 'selection') throw new AppError('PHASE_NOT_SELECTION', 'Not in selection phase', 409);

    const code = String(payload?.code ?? '').trim();
    if (!code) throw new AppError('BAD_REQUEST', 'code required', 400);

    const db = getDb(this.env);

    const invites = await db
      .select({
        code: groupInviteTable.code,
        groupId: groupInviteTable.groupId,
        expiresAtMs: groupInviteTable.expiresAtMs,
        usedByUserId: groupInviteTable.usedByUserId,
        groupLocked: groupTable.isLocked,
        subjectId: groupTable.subjectId,
      })
      .from(groupInviteTable)
      .innerJoin(groupTable, eq(groupInviteTable.groupId, groupTable.id))
      .where(eq(groupInviteTable.code, code))
      .limit(1);

    if (!invites.length) throw new AppError('INVITE_NOT_FOUND', 'Invite not found', 404);
    const inv = invites[0];

    if (inv.usedByUserId) throw new AppError('INVITE_USED', 'Invite already used', 409);
    if (inv.expiresAtMs && Date.now() > inv.expiresAtMs) throw new AppError('INVITE_EXPIRED', 'Invite expired', 409);
    if (inv.groupLocked) throw new AppError('GROUP_LOCKED', 'Group is locked', 409);

    await this.refreshEnrollmentIfNeeded();
    if (!(await this.isEnrolled(inv.subjectId)))
      throw new AppError('NOT_ENROLLED', 'Not enrolled for this subject', 403);

    await db
      .insert(groupMemberTable)
      .values({
        groupId: inv.groupId,
        studentUserId: this.ident!.userId,
        joinedAtMs: Date.now(),
      })
      .onConflictDoNothing();

    await db
      .update(groupInviteTable)
      .set({
        usedByUserId: this.ident!.userId,
        usedAtMs: Date.now(),
      })
      .where(eq(groupInviteTable.code, code));
  }

  private async handleGroupLeave(payload: GroupLeavePayload) {
    const groupId = Number(payload?.groupId);
    if (!Number.isFinite(groupId) || groupId <= 0) throw new AppError('BAD_REQUEST', 'groupId required', 400);

    const db = getDb(this.env);

    const rows = await db
      .select({ isLocked: groupTable.isLocked, leaderUserId: groupTable.leaderUserId })
      .from(groupTable)
      .where(eq(groupTable.id, groupId))
      .limit(1);
    if (!rows.length) throw new AppError('GROUP_NOT_FOUND', 'Group not found', 404);
    if (rows[0].isLocked) throw new AppError('GROUP_LOCKED', 'Group is locked', 409);
    if (rows[0].leaderUserId === this.ident!.userId)
      throw new AppError('LEADER_CANNOT_LEAVE', 'Leader must disband', 409);

    await db
      .delete(groupMemberTable)
      .where(and(eq(groupMemberTable.groupId, groupId), eq(groupMemberTable.studentUserId, this.ident!.userId)));
  }

  private async handleGroupDisband(payload: GroupDisbandPayload) {
    const groupId = Number(payload?.groupId);
    if (!Number.isFinite(groupId) || groupId <= 0) throw new AppError('BAD_REQUEST', 'groupId required', 400);

    await this.requireGroupUnlocked(groupId);
    const db = getDb(this.env);
    // cascade deletes invites/members via FK if configured; but D1 FKs aren’t always enforced.
    await db.delete(groupInviteTable).where(eq(groupInviteTable.groupId, groupId));
    await db.delete(groupMemberTable).where(eq(groupMemberTable.groupId, groupId));
    await db.delete(groupTable).where(eq(groupTable.id, groupId));
  }

  private async lockGroup(groupId: number) {
    const db = getDb(this.env);
    await db.update(groupTable).set({ isLocked: 1 }).where(eq(groupTable.id, groupId));
  }
  private async unlockGroup(groupId: number) {
    const db = getDb(this.env);
    await db.update(groupTable).set({ isLocked: 0 }).where(eq(groupTable.id, groupId));
  }

  private async callMemberApply(memberUserId: string, action: ActionName, payload: any, origin: any) {
    const ns = this.env.STUDENT_DO;
    const stub = ns.get(ns.idFromName(memberUserId));
    const resp = await stub.fetch('https://do/internal/apply', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-internal-call': '1' },
      body: JSON.stringify({ action, payload, origin } satisfies InternalApplyBody),
    });
    if (!resp.ok) {
      const t = await resp.text().catch(() => '');
      throw new AppError('MEMBER_APPLY_FAILED', `member ${memberUserId} apply failed: ${t}`, 502);
    }
    return await resp.json().catch(() => ({}));
  }

  private async handleGroupTake(payload: GroupTakePayload) {
    const groupId = Number(payload?.groupId);
    const sectionId = Number(payload?.sectionId);
    if (!Number.isFinite(groupId) || groupId <= 0) throw new AppError('BAD_REQUEST', 'groupId required', 400);
    if (!Number.isFinite(sectionId) || sectionId <= 0) throw new AppError('BAD_REQUEST', 'sectionId required', 400);

    const g = await this.requireGroupUnlocked(groupId);
    await this.lockGroup(groupId);

    try {
      const members = await this.groupMembers(groupId);
      // leader executes for everyone (including leader)
      for (const m of members) {
        await this.callMemberApply(m, 'take', { sectionId }, { leaderUserId: this.ident!.userId, groupId });
      }
    } finally {
      await this.unlockGroup(groupId);
    }
  }

  private async handleGroupDrop(payload: GroupDropPayload) {
    const groupId = Number(payload?.groupId);
    const subjectId = Number(payload?.subjectId);
    if (!Number.isFinite(groupId) || groupId <= 0) throw new AppError('BAD_REQUEST', 'groupId required', 400);
    if (!Number.isFinite(subjectId) || subjectId <= 0) throw new AppError('BAD_REQUEST', 'subjectId required', 400);

    await this.requireGroupUnlocked(groupId);
    await this.lockGroup(groupId);
    try {
      const members = await this.groupMembers(groupId);
      for (const m of members) {
        await this.callMemberApply(m, 'drop', { subjectId }, { leaderUserId: this.ident!.userId, groupId });
      }
    } finally {
      await this.unlockGroup(groupId);
    }
  }

  private async handleGroupChange(payload: GroupChangePayload) {
    const groupId = Number(payload?.groupId);
    const toSectionId = Number(payload?.toSectionId);
    if (!Number.isFinite(groupId) || groupId <= 0) throw new AppError('BAD_REQUEST', 'groupId required', 400);
    if (!Number.isFinite(toSectionId) || toSectionId <= 0)
      throw new AppError('BAD_REQUEST', 'toSectionId required', 400);

    await this.requireGroupUnlocked(groupId);
    await this.lockGroup(groupId);
    try {
      const members = await this.groupMembers(groupId);
      for (const m of members) {
        await this.callMemberApply(m, 'change', { toSectionId }, { leaderUserId: this.ident!.userId, groupId });
      }
    } finally {
      await this.unlockGroup(groupId);
    }
  }

  // ----- Swap (D1-backed) -----
  private async requireSwapLeader(swapId: number) {
    const db = getDb(this.env);
    const rows = await db
      .select({ leaderUserId: swapTable.leaderUserId, status: swapTable.status })
      .from(swapTable)
      .where(eq(swapTable.id, swapId))
      .limit(1);
    if (!rows.length) throw new AppError('SWAP_NOT_FOUND', 'Swap not found', 404);
    if (rows[0].leaderUserId !== this.ident!.userId) throw new AppError('FORBIDDEN', 'Leader only', 403);
    return rows[0];
  }

  private async handleSwapCreate(_payload: SwapCreatePayload) {
    const { phase } = await getPhase(this.env);
    if (phase !== 'swap') throw new AppError('PHASE_NOT_SWAP', 'Not in swap phase', 409);

    const db = getDb(this.env);
    const inserted = await db
      .insert(swapTable)
      .values({
        leaderUserId: this.ident!.userId,
        status: 'open',
        createdAtMs: Date.now(),
        executedAtMs: null,
      })
      .returning({ id: swapTable.id });

    if (!inserted[0]?.id) throw new AppError('SWAP_CREATE_FAILED', 'Failed to create swap', 500);
  }

  private async handleSwapInvite(payload: SwapInvitePayload) {
    const { phase } = await getPhase(this.env);
    if (phase !== 'swap') throw new AppError('PHASE_NOT_SWAP', 'Not in swap phase', 409);

    const swapId = Number(payload?.swapId);
    const count = Number(payload?.count ?? 0);
    const expiresInMs = payload?.expiresInMs ? Number(payload.expiresInMs) : null;

    if (!Number.isFinite(swapId) || swapId <= 0) throw new AppError('BAD_REQUEST', 'swapId required', 400);
    if (!Number.isFinite(count) || count <= 0 || count > 50)
      throw new AppError('BAD_REQUEST', 'count must be 1..50', 400);

    const s = await this.requireSwapLeader(swapId);
    if (s.status !== 'open') throw new AppError('SWAP_NOT_OPEN', 'Swap not open', 409);

    const db = getDb(this.env);
    const now = Date.now();
    const expiresAtMs = expiresInMs ? now + Math.max(10_000, expiresInMs) : null;

    const codes = Array.from({ length: count }, () => inviteCode(10));
    await db.insert(swapInviteTable).values(
      codes.map((code) => ({
        code,
        swapId,
        createdAtMs: now,
        expiresAtMs,
        usedByUserId: null,
        usedAtMs: null,
      })),
    );

    sendJsonToAll(this.state, {
      type: 'status',
      nowMs: Date.now(),
      data: { swapInvites: codes },
    });
  }

  private async handleSwapJoin(payload: SwapJoinPayload) {
    const { phase } = await getPhase(this.env);
    if (phase !== 'swap') throw new AppError('PHASE_NOT_SWAP', 'Not in swap phase', 409);

    const code = String(payload?.code ?? '').trim();
    const giveSectionId = Number(payload?.giveSectionId);
    const wantSectionId = Number(payload?.wantSectionId);
    if (!code) throw new AppError('BAD_REQUEST', 'code required', 400);
    if (!Number.isFinite(giveSectionId) || giveSectionId <= 0)
      throw new AppError('BAD_REQUEST', 'giveSectionId required', 400);
    if (!Number.isFinite(wantSectionId) || wantSectionId <= 0)
      throw new AppError('BAD_REQUEST', 'wantSectionId required', 400);

    const db = getDb(this.env);

    const invRows = await db
      .select({
        swapId: swapInviteTable.swapId,
        expiresAtMs: swapInviteTable.expiresAtMs,
        usedByUserId: swapInviteTable.usedByUserId,
        status: swapTable.status,
      })
      .from(swapInviteTable)
      .innerJoin(swapTable, eq(swapInviteTable.swapId, swapTable.id))
      .where(eq(swapInviteTable.code, code))
      .limit(1);

    if (!invRows.length) throw new AppError('INVITE_NOT_FOUND', 'Invite not found', 404);
    const inv = invRows[0];
    if (inv.status !== 'open') throw new AppError('SWAP_NOT_OPEN', 'Swap not open', 409);
    if (inv.usedByUserId) throw new AppError('INVITE_USED', 'Invite already used', 409);
    if (inv.expiresAtMs && Date.now() > inv.expiresAtMs) throw new AppError('INVITE_EXPIRED', 'Invite expired', 409);

    await db
      .insert(swapParticipantTable)
      .values({
        swapId: inv.swapId,
        userId: this.ident!.userId,
        giveSectionId,
        wantSectionId,
        createdAtMs: Date.now(),
      })
      .onConflictDoUpdate({
        target: [swapParticipantTable.swapId, swapParticipantTable.userId],
        set: { giveSectionId, wantSectionId, createdAtMs: Date.now() },
      });

    await db
      .update(swapInviteTable)
      .set({
        usedByUserId: this.ident!.userId,
        usedAtMs: Date.now(),
      })
      .where(eq(swapInviteTable.code, code));
  }

  private async handleSwapExec(payload: SwapExecPayload) {
    const { phase } = await getPhase(this.env);
    if (phase !== 'swap') throw new AppError('PHASE_NOT_SWAP', 'Not in swap phase', 409);

    const swapId = Number(payload?.swapId);
    if (!Number.isFinite(swapId) || swapId <= 0) throw new AppError('BAD_REQUEST', 'swapId required', 400);

    const db = getDb(this.env);
    const leader = await this.requireSwapLeader(swapId);

    if (leader.status !== 'open') throw new AppError('SWAP_NOT_OPEN', 'Swap not open', 409);

    // Lock swap
    await db.update(swapTable).set({ status: 'locked' }).where(eq(swapTable.id, swapId));

    // Transaction: apply changes to section_selection
    const participants = await db
      .select({
        userId: swapParticipantTable.userId,
        giveSectionId: swapParticipantTable.giveSectionId,
        wantSectionId: swapParticipantTable.wantSectionId,
      })
      .from(swapParticipantTable)
      .where(eq(swapParticipantTable.swapId, swapId));

    if (participants.length < 2) throw new AppError('SWAP_TOO_SMALL', 'Need at least 2 participants', 409);

    // Build mapping user -> wantSectionId
    // We apply per participant: update their subject selection to want section's subject.
    // (Assumption: swaps are within same subject; if cross-subject allowed, you must define rules.)
    // We'll enforce same subject for give/want here.
    const wantInfos = await Promise.all(participants.map((p) => this.getSectionInfo(p.wantSectionId)));
    const giveInfos = await Promise.all(participants.map((p) => this.getSectionInfo(p.giveSectionId)));

    for (let i = 0; i < participants.length; i++) {
      if (wantInfos[i].subjectId !== giveInfos[i].subjectId) {
        throw new AppError('SWAP_INVALID', 'give and want must be in the same subject', 409);
      }
    }

    const subjectId = wantInfos[0].subjectId;

    await db.transaction(async (tx) => {
      // capacity check for each target section (count current + incoming)
      const targets = new Map<number, number>(); // sectionId -> incoming count
      for (const p of participants) targets.set(p.wantSectionId, (targets.get(p.wantSectionId) ?? 0) + 1);

      for (const [targetSectionId, incoming] of targets.entries()) {
        const capRow = await tx
          .select({ maxSeats: sectionTable.maxSeats })
          .from(sectionTable)
          .where(eq(sectionTable.id, targetSectionId))
          .limit(1);
        if (!capRow.length) throw new AppError('SECTION_NOT_FOUND', `section ${targetSectionId} not found`, 404);

        const countRow = await tx
          .select({ c: sectionSelection.studentUserId })
          .from(sectionSelection)
          .where(eq(sectionSelection.sectionId, targetSectionId));

        const currentCount = countRow.length;
        const maxSeats = capRow[0].maxSeats;
        // In swap, those "giving up" seats might be in different sections; we don't net them here.
        // That is conservative; if you want netting within same target, we can compute net flow later.
        if (currentCount + incoming > maxSeats) {
          throw new AppError('SECTION_FULL', `target section ${targetSectionId} lacks capacity`, 409);
        }
      }

      // conflict check for each participant: ensure want timeslot doesn't overlap their other selections
      for (let i = 0; i < participants.length; i++) {
        const p = participants[i];
        const want = wantInfos[i];

        // get all current selections for user
        const sels = await tx
          .select({ subjectId: sectionSelection.subjectId, sectionId: sectionSelection.sectionId })
          .from(sectionSelection)
          .where(eq(sectionSelection.studentUserId, p.userId));

        // join to get masks
        const sectionIds = sels.map((s) => s.sectionId);
        const secRows = sectionIds.length
          ? await tx
              .select({
                id: sectionTable.id,
                timeslotMask: sectionTable.timeslotMask,
                subjectId: sectionTable.subjectId,
              })
              .from(sectionTable)
              .where(inArray(sectionTable.id, sectionIds))
          : [];

        let union = 0;
        for (const r of secRows) {
          if (r.subjectId === subjectId) continue; // ignore same-subject current, since we replace it
          union |= r.timeslotMask;
        }
        if ((union & want.timeslotMask) !== 0) {
          throw new AppError('CONFLICT', `user ${p.userId} has a conflict`, 409);
        }
      }

      // apply updates
      const nowMs = Date.now();
      for (const p of participants) {
        await tx
          .insert(sectionSelection)
          .values({
            studentUserId: p.userId,
            subjectId,
            sectionId: p.wantSectionId,
            selectedAtMs: nowMs,
          })
          .onConflictDoUpdate({
            target: [sectionSelection.studentUserId, sectionSelection.subjectId],
            set: { sectionId: p.wantSectionId, selectedAtMs: nowMs },
          });
      }

      await tx.update(swapTable).set({ status: 'executed', executedAtMs: Date.now() }).where(eq(swapTable.id, swapId));
    });

    // Notify participants to sync internal state from D1
    for (const p of participants) {
      const ns = this.env.STUDENT_DO;
      const stub = ns.get(ns.idFromName(p.userId));
      await stub
        .fetch('https://do/internal/syncFromD1', {
          method: 'POST',
          headers: { 'x-internal-call': '1' },
        })
        .catch(() => {});
    }
  }

  // -------------------- Internal sync --------------------
  private async syncFromD1() {
    if (!this.ident) return;
    const db = getDb(this.env);

    // read student's selections from D1 truth
    const rows = await db
      .select({
        subjectId: sectionSelection.subjectId,
        sectionId: sectionSelection.sectionId,
      })
      .from(sectionSelection)
      .where(eq(sectionSelection.studentUserId, this.ident.userId));

    // load masks
    const sectionIds = rows.map((r) => r.sectionId);
    const secRows = sectionIds.length
      ? await db
          .select({ id: sectionTable.id, subjectId: sectionTable.subjectId, timeslotMask: sectionTable.timeslotMask })
          .from(sectionTable)
          .where(inArray(sectionTable.id, sectionIds))
      : [];

    const maskBySection = new Map(secRows.map((r) => [r.id, r.timeslotMask]));
    for (const r of rows) {
      await this.upsertSelection(r.subjectId, r.sectionId, maskBySection.get(r.sectionId) ?? 0);
    }
  }

  // -------------------- Status push --------------------
  private async pushStatus() {
    if (!this.ident) return;

    const { phase } = await getPhase(this.env);
    const selections = await this.currentSelections();
    const extras = await this.loadExtras();

    // queue summary: last 20
    const sdb = await this.state.storage.sql;
    const q = sdb
      .exec(
        `SELECT id, action, status, createdAtMs, startedAtMs, finishedAtMs, errorCode, errorMessage, payloadJson
         FROM queue
         ORDER BY createdAtMs DESC
         LIMIT 20;`,
      )
      .toArray() as any[];

    const queue = q.reverse().map((row) => ({
      id: row.id,
      action: row.action,
      status: row.status,
      createdAtMs: row.createdAtMs,
      startedAtMs: row.startedAtMs ?? undefined,
      finishedAtMs: row.finishedAtMs ?? undefined,
      error: row.errorCode ? { code: row.errorCode, message: row.errorMessage ?? '' } : undefined,
      payload: row.payloadJson ? JSON.parse(row.payloadJson) : undefined,
    }));

    broadcast(this.state, {
      type: 'status',
      nowMs: Date.now(),
      phase,
      data: { selections, queue, ...extras },
    } as any);
  }

  // inside class StudentDO
  private extraCache: { atMs: number; data: any } | null = null;

  private async loadExtras() {
    const now = Date.now();
    if (this.extraCache && now - this.extraCache.atMs < 5_000) return this.extraCache.data;

    // enrolledSubjectIds from DO storage
    const sdb = await this.state.storage.sql;
    const enrolledRows = sdb.exec(`SELECT subjectId FROM enrolled_subject ORDER BY subjectId;`).toArray() as any[];
    const enrolledSubjectIds = enrolledRows.map((r) => Number(r.subjectId));

    const db = getDb(this.env);

    const groups = await db
      .select({
        groupId: groupTable.id,
        subjectId: groupTable.subjectId,
        leaderUserId: groupTable.leaderUserId,
        isLocked: groupTable.isLocked,
        createdAtMs: groupTable.createdAtMs,
      })
      .from(groupMemberTable)
      .innerJoin(groupTable, eq(groupMemberTable.groupId, groupTable.id))
      .where(eq(groupMemberTable.studentUserId, this.ident!.userId))
      .orderBy(desc(groupTable.createdAtMs));

    const leaderSwapIds = await db
      .select({ id: swapTable.id })
      .from(swapTable)
      .where(eq(swapTable.leaderUserId, this.ident!.userId));
    const partSwapIds = await db
      .select({ id: swapParticipantTable.swapId })
      .from(swapParticipantTable)
      .where(eq(swapParticipantTable.userId, this.ident!.userId));

    const swapIds = Array.from(new Set([...leaderSwapIds.map((x) => x.id), ...partSwapIds.map((x) => x.id)]));

    const swaps = swapIds.length
      ? await db
          .select({
            id: swapTable.id,
            leaderUserId: swapTable.leaderUserId,
            status: swapTable.status,
            createdAtMs: swapTable.createdAtMs,
            executedAtMs: swapTable.executedAtMs,
          })
          .from(swapTable)
          .where(inArray(swapTable.id, swapIds))
          .orderBy(desc(swapTable.createdAtMs))
      : [];

    const swapParticipants = swapIds.length
      ? await db
          .select({
            swapId: swapParticipantTable.swapId,
            userId: swapParticipantTable.userId,
            giveSectionId: swapParticipantTable.giveSectionId,
            wantSectionId: swapParticipantTable.wantSectionId,
            createdAtMs: swapParticipantTable.createdAtMs,
          })
          .from(swapParticipantTable)
          .where(inArray(swapParticipantTable.swapId, swapIds))
      : [];

    const data = {
      enrolledSubjectIds,
      groups,
      swaps: swaps.map((s) => ({
        ...s,
        participants: swapParticipants.filter((p) => p.swapId === s.id),
      })),
    };

    this.extraCache = { atMs: now, data };
    return data;
  }

  private async pushSeatStatus() {
    if (!this.ident) return;
    await this.refreshEnrollmentIfNeeded();

    const sdb = await this.state.storage.sql;
    const rows = sdb.exec(`SELECT subjectId FROM enrolled_subject ORDER BY subjectId;`).toArray() as any[];

    const payload: Record<string, any> = {};
    for (const r of rows) {
      const kv = await getSubjectKv(this.env, r.subjectId);
      payload[String(r.subjectId)] = kv;
    }

    broadcast(this.state, {
      type: 'seat_status',
      nowMs: Date.now(),
      subjects: payload,
    } as any);
  }

  async alarm() {
    try {
      // Only do periodic pushes if someone is connected
      const sockets = this.state.getWebSockets();
      if (sockets.length) {
        await this.pushStatus();
        await this.pushSeatStatus();
      }
      await this.ensureAlarm(1_000);
    } catch {
      await this.ensureAlarm(2_000);
    }
  }

  // -------------------- Queue processor --------------------
  private async processQueueIfNeeded() {
    if (this.processing) return;
    this.processing = true;
    this.log('queue:start');

    try {
      while (true) {
        const next = await this.nextQueued();
        if (!next) break;

        await this.updateQueue(next.id, { status: 'running', startedAtMs: Date.now() });
        this.log('queue:run', { id: next.id, action: next.action, payload: next.payload });

        try {
          await this.applyAction(next.action, next.payload);
          await this.updateQueue(next.id, { status: 'ok', finishedAtMs: Date.now() });
          this.log('queue:ok', { id: next.id, action: next.action });
        } catch (e) {
          const err = asAppError(e);
          await this.updateQueue(next.id, {
            status: 'error',
            finishedAtMs: Date.now(),
            error: { code: err.code, message: err.message },
          });
          this.warn('queue:error', { id: next.id, action: next.action, code: err.code, message: err.message });
        }
      }
    } finally {
      this.processing = false;
      this.log('queue:done');
    }
  }

  private async applyAction(action: ActionName, payload: any) {
    this.ensureStudent();

    switch (action) {
      case 'take':
        return this.handleTake(payload as TakePayload);
      case 'drop':
        return this.handleDrop(payload as DropPayload);
      case 'change':
        return this.handleChange(payload as ChangePayload);

      case 'group_create':
        return this.handleGroupCreate(payload as GroupCreatePayload);
      case 'group_invite':
        return this.handleGroupInvite(payload as GroupInvitePayload);
      case 'group_join':
        return this.handleGroupJoin(payload as GroupJoinPayload);
      case 'group_leave':
        return this.handleGroupLeave(payload as GroupLeavePayload);
      case 'group_disband':
        return this.handleGroupDisband(payload as GroupDisbandPayload);
      case 'group_take':
        return this.handleGroupTake(payload as GroupTakePayload);
      case 'group_drop':
        return this.handleGroupDrop(payload as GroupDropPayload);
      case 'group_change':
        return this.handleGroupChange(payload as GroupChangePayload);

      case 'swap_create':
        return this.handleSwapCreate(payload as SwapCreatePayload);
      case 'swap_invite':
        return this.handleSwapInvite(payload as SwapInvitePayload);
      case 'swap_join':
        return this.handleSwapJoin(payload as SwapJoinPayload);
      case 'swap_exec':
        return this.handleSwapExec(payload as SwapExecPayload);

      // cancel actions are handled before queuing
      case 'cancel':
      case 'cancel_all':
        return;

      case 'message': {
        const p = payload as MessagePayload;
        const toUserId = String(p?.toUserId ?? '');
        const text = String(p?.text ?? '').trim();
        if (!toUserId || !text) throw new AppError('BAD_REQUEST', 'toUserId and text required', 400);

        if (!this.chatBucket.take(1)) throw new AppError('RATE_LIMITED', '1 message per second', 429);

        this.chat.addOut(toUserId, text);
        await deliverMessage(this.env, this.ident!.userId, toUserId, text);

        // echo to client
        broadcast(this.state, {
          type: 'chat',
          nowMs: Date.now(),
          fromUserId: this.ident!.userId,
          toUserId,
          text,
        } as any);
        return;
      }

      case 'status':
        return; // handled by pushStatus
    }
  }

  // -------------------- Fetch endpoints --------------------
  async fetch(req: Request): Promise<Response> {
    try {
      const url = new URL(req.url);

      if (url.pathname === '/ws' && req.method === 'GET') {
        const ident = this.readIdentity(req);
        this.ident = ident;
        this.ensureStudent();
        this.log('ws:connect', { userId: ident.userId, role: ident.role });

        // enrollment cache warmup
        await this.refreshEnrollmentIfNeeded();

        const { response, server } = upgradeToWebSocket(this.state);
        sendJson(
          server as AnyWebSocket,
          { type: 'hello', actor: 'student', userId: ident.userId, role: ident.role, nowMs: Date.now() } as any,
        );

        // immediate push
        await this.pushStatus();
        await this.pushSeatStatus();

        return response;
      }

      // internal: group leader applying to member
      if (url.pathname === '/internal/apply' && req.method === 'POST') {
        if (req.headers.get('x-internal-call') !== '1') throw new AppError('FORBIDDEN', 'internal only', 403);

        // we must have identity to apply; in group/swap internal calls we infer studentId from DO name
        // but DO name isn't accessible; so we require that the DO was already initialized via WS at least once,
        // or we accept a header override (leader can set it) – simplest: require WS first.
        if (!this.ident) throw new AppError('NOT_READY', 'StudentDO not initialized; connect ws once first', 409);

        const body = (await req.json().catch(() => null)) as InternalApplyBody | null;
        if (!body?.action) throw new AppError('BAD_REQUEST', 'action required', 400);

        // log as synthetic queue item (append-only)
        const qid = randomId(16);
        await this.insertQueue({
          id: qid,
          action: body.action,
          status: 'queued',
          createdAtMs: Date.now(),
          payload: body.payload,
        });
        broadcast(this.state, {
          type: 'queue_update',
          item: { id: qid, action: body.action, status: 'queued', createdAtMs: Date.now(), payload: body.payload },
        } as any);

        // process immediately
        await this.processQueueIfNeeded();
        return json({ ok: true });
      }

      if (url.pathname === '/internal/syncFromD1' && req.method === 'POST') {
        if (req.headers.get('x-internal-call') !== '1') throw new AppError('FORBIDDEN', 'internal only', 403);
        if (!this.ident) return json({ ok: true, note: 'not initialized yet' });
        await this.syncFromD1();
        await this.pushStatus();
        return json({ ok: true });
      }

      // receive chat from other DOs
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

      return new Response('Not found', { status: 404 });
    } catch (e) {
      return fromError(e);
    }
  }

  // -------------------- WS message handler --------------------
  async webSocketMessage(ws: WebSocket, message: any) {
    const msg = parseJsonMessage(message);
    if (!msg) return;
    if (!isClientAction(msg)) return;
    this.log('ws:action', { userId: this.ident?.userId, action: msg.action, id: msg.id, payload: msg.payload });

    if (!this.ident) return;
    this.ensureStudent();

    // Cancel actions are immediate (no queue insert)
    if (msg.action === 'cancel') {
      const p = msg.payload as CancelPayload;
      const ok = await this.cancelQueued(String(p?.queueId ?? ''));
      if (!ok)
        sendJson(
          ws as any,
          {
            type: 'error',
            requestId: msg.id,
            code: 'CANCEL_FAILED',
            message: 'Cannot cancel (not found / not queued)',
          } as any,
        );
      return;
    }

    if (msg.action === 'cancel_all') {
      await this.cancelAllQueued();
      return;
    }

    // Enqueue everything else (including message, so it logs too)
    const q: QueueItem = {
      id: msg.id || randomId(16),
      action: msg.action,
      status: 'queued',
      createdAtMs: Date.now(),
      payload: msg.payload,
    };

    await this.insertQueue(q);
    broadcast(this.state, { type: 'queue_update', item: q } as any);

    // kick processor
    await this.processQueueIfNeeded();
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

// small helper to send a server msg to all sockets without importing more
function sendJsonToAll(state: DurableObjectState, msg: any) {
  const sockets = state.getWebSockets() as any[];
  for (const ws of sockets) {
    try {
      ws.send(JSON.stringify(msg));
    } catch {}
  }
}
