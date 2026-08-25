import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { Database } from "bun:sqlite";
import { PATHS } from "./config.ts";

const pinsDbPath = () => join(PATHS.data, "lfg.sqlite");
let db: Database | null = null;

function pinsDb(): Database {
  if (db) return db;
  mkdirSync(PATHS.data, { recursive: true });
  const opened = new Database(pinsDbPath(), { create: true });
  opened.exec("PRAGMA journal_mode = WAL");
  opened.exec("PRAGMA busy_timeout = 5000");
  opened.exec(`
    CREATE TABLE IF NOT EXISTS session_pins (
      session_id TEXT PRIMARY KEY,
      position INTEGER NOT NULL,
      pinned_at INTEGER NOT NULL
    )
  `);
  db = opened;
  return opened;
}

export function resetSessionPinsDbConnectionForTests(): void {
  db?.close();
  db = null;
}

export function listSessionPins(): string[] {
  return pinsDb()
    .query<{ session_id: string }, []>(
      "SELECT session_id FROM session_pins ORDER BY position ASC, pinned_at ASC, session_id ASC",
    )
    .all()
    .map((row) => row.session_id);
}

export function setSessionPinned(sessionId: string, pinned: boolean): string[] {
  const database = pinsDb();
  if (!pinned) {
    database.query("DELETE FROM session_pins WHERE session_id = ?").run(sessionId);
    return listSessionPins();
  }
  database.transaction(() => {
    const next = database
      .query<{ position: number }, []>(
        "SELECT COALESCE(MAX(position), -1) + 1 AS position FROM session_pins",
      )
      .get()?.position ?? 0;
    database
      .query(
        "INSERT OR IGNORE INTO session_pins (session_id, position, pinned_at) VALUES (?, ?, ?)",
      )
      .run(sessionId, next, Date.now());
  })();
  return listSessionPins();
}

export function importSessionPins(sessionIds: readonly string[]): string[] {
  const database = pinsDb();
  database.transaction(() => {
    const insert = database.query(
      "INSERT OR IGNORE INTO session_pins (session_id, position, pinned_at) VALUES (?, ?, ?)",
    );
    let next = database
      .query<{ position: number }, []>(
        "SELECT COALESCE(MAX(position), -1) + 1 AS position FROM session_pins",
      )
      .get()?.position ?? 0;
    const now = Date.now();
    for (const sessionId of new Set(sessionIds)) {
      const result = insert.run(sessionId, next, now + next);
      if (result.changes) next += 1;
    }
  })();
  return listSessionPins();
}

export function pruneSessionPins(liveSessionIds: ReadonlySet<string>): string[] {
  const database = pinsDb();
  database.transaction(() => {
    const remove = database.query("DELETE FROM session_pins WHERE session_id = ?");
    for (const sessionId of listSessionPins()) {
      if (!liveSessionIds.has(sessionId)) remove.run(sessionId);
    }
  })();
  return listSessionPins();
}
