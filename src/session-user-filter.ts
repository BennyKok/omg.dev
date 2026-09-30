import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { Database } from "bun:sqlite";
import { PATHS } from "./config.ts";

// The session list's owner filter ("whose sessions am I looking at"), saved
// per managed viewer on the box.
//
// The web client also keeps this choice in localStorage. On a managed
// Computer that copy is not reliable: the omg.dev host mounts every machine
// on one origin, so one key is shared by all of them, and the host resets a
// stored person filter when it cannot yet tell that the machine is shared.
// The box is per machine and receives a verified viewer email, so it is the
// one place that can remember "this person, on this machine, chose this".
//
// A view preference only. It never decides what a viewer may see.

const FILTER_MAX_LENGTH = 320;
let db: Database | null = null;

function filtersDb(): Database {
  if (db) return db;
  mkdirSync(PATHS.data, { recursive: true });
  const opened = new Database(join(PATHS.data, "lfg.sqlite"), { create: true });
  opened.exec("PRAGMA journal_mode = WAL");
  opened.exec("PRAGMA busy_timeout = 5000");
  opened.exec(`
    CREATE TABLE IF NOT EXISTS session_user_filters (
      viewer TEXT PRIMARY KEY,
      filter TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `);
  db = opened;
  return opened;
}

export function resetSessionUserFilterDbConnectionForTests(): void {
  db?.close();
  db = null;
}

const viewerKey = (viewer: string) => viewer.trim().toLowerCase();

/** A filter value the client may store: "__all", "__unassigned" or an email. */
export function isStorableUserFilter(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= FILTER_MAX_LENGTH;
}

export function getSessionUserFilter(viewer: string): string | null {
  const key = viewerKey(viewer);
  if (!key) return null;
  return (
    filtersDb()
      .query<{ filter: string }, [string]>(
        "SELECT filter FROM session_user_filters WHERE viewer = ?",
      )
      .get(key)?.filter ?? null
  );
}

export function setSessionUserFilter(viewer: string, filter: string): void {
  const key = viewerKey(viewer);
  if (!key) return;
  filtersDb()
    .query(
      `INSERT INTO session_user_filters (viewer, filter, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(viewer) DO UPDATE SET filter = excluded.filter, updated_at = excluded.updated_at`,
    )
    .run(key, filter, Date.now());
}
