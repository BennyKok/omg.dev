import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { Database } from "bun:sqlite";
import { PATHS } from "./config.ts";

const pinsDbPath = () => join(PATHS.data, "lfg.sqlite");

/**
 * Rows kept in the table. Pins for ended sessions are no longer deleted on
 * read (see visibleSessionPins), so this is what stops the table growing
 * without bound. It is far above any plausible number of live pins, and the
 * import endpoint already refuses more than 500 ids in one request.
 */
const PIN_LIMIT = 500;
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
    evictBeyondLimit(database);
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
    evictBeyondLimit(database);
  })();
  return listSessionPins();
}

/** Drop the oldest pins once the table passes PIN_LIMIT. */
function evictBeyondLimit(database: Database): void {
  database
    .query(
      `DELETE FROM session_pins WHERE session_id IN (
         SELECT session_id FROM session_pins
         ORDER BY position ASC, pinned_at ASC, session_id ASC
         LIMIT MAX(0, (SELECT COUNT(*) FROM session_pins) - ?)
       )`,
    )
    .run(PIN_LIMIT);
}

/**
 * The pinned ids that are live right now, in pin order. Read-only.
 *
 * This deliberately FILTERS instead of deleting. The live roster is built from
 * a `/proc` scan (`scanProcs` returns an empty list on any readdir failure) and
 * from per-pid session files that can fail to resolve for a session that is
 * genuinely alive. That signal is good enough to decide what to show, and far
 * too weak to delete shared state with: one bad scan would drop every pin on
 * every device, permanently and with no way back. The web client already draws
 * this exact line for itself -- see the `sessionsSeenRef` guard in App.tsx,
 * "an empty liveSessionIds is the boot state as well as the nothing-is-running
 * state".
 *
 * A pin whose session has really ended just stops being returned. It costs one
 * short row until `PIN_LIMIT` evicts it.
 */
export function visibleSessionPins(liveSessionIds: ReadonlySet<string>): string[] {
  return listSessionPins().filter((sessionId) => liveSessionIds.has(sessionId));
}
