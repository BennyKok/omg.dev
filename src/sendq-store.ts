import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { Database } from "bun:sqlite";
import { PATHS } from "./config.ts";
import type { QueuedMsg } from "./sendq.ts";

type QueueRow = {
  session_id: string;
  id: string;
  text: string;
  status: string;
  error: string | null;
  attempts: number;
  created_at: number;
  updated_at: number;
  queued_behind_turn: number;
};

let db: Database | null = null;
let openedPath: string | null = null;

function database(): Database {
  const path = join(PATHS.data, "lfg.sqlite");
  if (db && openedPath === path) return db;
  db?.close();
  mkdirSync(PATHS.data, { recursive: true });
  const opened = new Database(path, { create: true });
  opened.exec("PRAGMA journal_mode = WAL");
  opened.exec("PRAGMA synchronous = NORMAL");
  opened.exec("PRAGMA busy_timeout = 5000");
  opened.exec(`
    CREATE TABLE IF NOT EXISTS send_queue_messages (
      session_id TEXT NOT NULL,
      id TEXT NOT NULL,
      text TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('pending', 'sending', 'delivered', 'queued', 'failed')),
      error TEXT,
      attempts INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      queued_behind_turn INTEGER NOT NULL DEFAULT 0 CHECK(queued_behind_turn IN (0, 1)),
      PRIMARY KEY (session_id, id)
    );
    CREATE INDEX IF NOT EXISTS send_queue_messages_session_order
      ON send_queue_messages(session_id, created_at, id);
    CREATE INDEX IF NOT EXISTS send_queue_messages_actionable
      ON send_queue_messages(status, session_id);
  `);
  db = opened;
  openedPath = path;
  return opened;
}

function fromRow(row: QueueRow): QueuedMsg | null {
  if (!["pending", "sending", "delivered", "queued", "failed"].includes(row.status)) return null;
  return {
    id: row.id,
    text: row.text,
    status: row.status as QueuedMsg["status"],
    ...(row.error ? { error: row.error } : {}),
    attempts: row.attempts,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ...(row.queued_behind_turn ? { queuedBehindTurn: true } : {}),
  };
}

export function readStoredQueue(sessionId: string): QueuedMsg[] {
  return database()
    .query<QueueRow, [string]>(`
      SELECT session_id, id, text, status, error, attempts, created_at, updated_at, queued_behind_turn
      FROM send_queue_messages
      WHERE session_id = ?
      ORDER BY created_at, id
    `)
    .all(sessionId)
    .map(fromRow)
    .filter((row): row is QueuedMsg => !!row);
}

export function writeStoredQueueMessage(sessionId: string, message: QueuedMsg): void {
  database().query(`
    INSERT INTO send_queue_messages (
      session_id, id, text, status, error, attempts, created_at, updated_at, queued_behind_turn
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(session_id, id) DO UPDATE SET
      text = excluded.text,
      status = excluded.status,
      error = excluded.error,
      attempts = excluded.attempts,
      created_at = excluded.created_at,
      updated_at = excluded.updated_at,
      queued_behind_turn = excluded.queued_behind_turn
  `).run(
    sessionId,
    message.id,
    message.text,
    message.status,
    message.error ?? null,
    message.attempts,
    message.createdAt,
    message.updatedAt,
    message.queuedBehindTurn ? 1 : 0,
  );
}

export function deleteStoredQueueMessages(sessionId: string, ids: readonly string[]): number {
  if (!ids.length) return 0;
  const remove = database().query("DELETE FROM send_queue_messages WHERE session_id = ? AND id = ?");
  return database().transaction((messageIds: readonly string[]) => {
    let deleted = 0;
    for (const id of messageIds) deleted += Number(remove.run(sessionId, id).changes ?? 0);
    return deleted;
  }).immediate(ids);
}

export function actionableStoredQueueSessionIds(): string[] {
  return database()
    .query<{ session_id: string }, []>(`
      SELECT DISTINCT session_id
      FROM send_queue_messages
      WHERE status IN ('pending', 'sending')
    `)
    .all()
    .map((row) => row.session_id);
}

export function resetSendQueueStoreConnectionForTests(): void {
  db?.close();
  db = null;
  openedPath = null;
}
