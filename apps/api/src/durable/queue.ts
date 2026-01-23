import type { DurableObjectState } from '@cloudflare/workers-types';

import type { ActionName, QueueItem } from './utils/protocol';
import { broadcast } from './utils/ws';

/**
 * Reusable Queue logic backed by SQLite in Durable Objects.
 */
export class DurableQueue {
  constructor(private state: DurableObjectState) {}

  async initSchema(db: any) {
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
  }

  async insert(item: QueueItem) {
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

  async update(id: string, patch: Partial<QueueItem>) {
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

  async next(): Promise<{ id: string; action: ActionName; payload: any } | null> {
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

  async cancel(id: string): Promise<boolean> {
    const db = await this.state.storage.sql;
    const rows = db.exec(`SELECT status FROM queue WHERE id=? LIMIT 1;`, id).toArray() as any[];
    if (!rows.length) return false;
    if (rows[0].status !== 'queued') return false;
    db.exec(`UPDATE queue SET status='cancelled', finishedAtMs=? WHERE id=?;`, Date.now(), id);
    await this.update(id, { status: 'cancelled' });
    return true;
  }

  async cancelAll(): Promise<number> {
    const db = await this.state.storage.sql;
    const rows = db.exec(`SELECT id FROM queue WHERE status='queued';`).toArray() as any[];
    for (const r of rows) {
      db.exec(`UPDATE queue SET status='cancelled', finishedAtMs=? WHERE id=?;`, Date.now(), r.id);
      await this.update(r.id, { status: 'cancelled' });
    }
    return rows.length;
  }
}
