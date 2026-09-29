// Durable launch containment per session id.
//
// The owner row in managed-sessions.json records the containment a session's
// first spawn used (ManagedSession.containment). Closing the session removes
// that row, and the aisdk registry entry goes with the harness. The resume
// cache row is not a safe home either: the transcript scan rewrites it (a
// claude-transcript row comes back with an empty backend and managed = 0) and
// prunes rows it cannot see. A closed subagent then resumed outside its
// lfg-agent-<name> unit, with no MemoryMax, sandbox or egress proxy.
//
// So this small store keeps the record after the row is gone. addManaged and
// patchManaged are the only writers (src/managed.ts), keyed by both the lfg
// session id and the native id, so any resume branch can find it. Nothing
// prunes it. The close path adds the exit reason ("out_of_memory") so the
// resume picker can say why a session stopped.
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { Database } from "bun:sqlite";
import { PATHS } from "./config";
import type { SandboxMode } from "./sandbox/bwrap.ts";

export type SessionExitReason = "out_of_memory";

export type SessionContainmentRecord = {
  agentSlice: boolean;
  sandbox: SandboxMode;
  egressProxy: boolean;
  role: string | null;
  spawnedBy: string | null;
  /** tmux/unit name of the last launch: lfg-agent-<tmuxName>.service. */
  tmuxName: string | null;
  recordedAt: number;
  exitReason: SessionExitReason | null;
};

type Row = {
  session_id: string;
  agent_slice: number;
  sandbox: string;
  egress_proxy: number;
  role: string | null;
  spawned_by: string | null;
  tmux_name: string | null;
  recorded_at: number;
  exit_reason: string | null;
};

let db: Database | null = null;
let dbPath: string | null = null;

// Reopened when PATHS.data moves (tests point it at a temp dir per case).
function database(): Database {
  const path = join(PATHS.data, "session-containment.sqlite");
  if (db && dbPath === path) return db;
  try {
    db?.close();
  } catch {}
  mkdirSync(dirname(path), { recursive: true });
  const next = new Database(path, { create: true });
  next.exec("PRAGMA journal_mode = WAL");
  next.exec("PRAGMA synchronous = NORMAL");
  next.exec("PRAGMA busy_timeout = 2500");
  next.exec(`
    CREATE TABLE IF NOT EXISTS session_containment (
      session_id TEXT PRIMARY KEY,
      agent_slice INTEGER NOT NULL,
      sandbox TEXT NOT NULL,
      egress_proxy INTEGER NOT NULL,
      role TEXT,
      spawned_by TEXT,
      tmux_name TEXT,
      recorded_at INTEGER NOT NULL,
      exit_reason TEXT
    );
  `);
  db = next;
  dbPath = path;
  return next;
}

function toRecord(row: Row): SessionContainmentRecord {
  return {
    agentSlice: row.agent_slice === 1,
    sandbox: (row.sandbox || "none") as SandboxMode,
    egressProxy: row.egress_proxy === 1,
    role: row.role,
    spawnedBy: row.spawned_by,
    tmuxName: row.tmux_name,
    recordedAt: row.recorded_at,
    exitReason: row.exit_reason === "out_of_memory" ? "out_of_memory" : null,
  };
}

function ids(values: Array<string | null | undefined>): string[] {
  return [...new Set(values.filter((id): id is string => !!id && !!id.trim()))];
}

/**
 * Record the containment of a launch. A new launch clears the previous exit
 * reason: the session is running again. `onlyIfMissing` backfills a row that
 * predates this store (removeManaged) without touching an existing record.
 */
export function recordSessionContainment(
  sessionIds: Array<string | null | undefined>,
  record: Omit<SessionContainmentRecord, "recordedAt" | "exitReason">,
  opts: { onlyIfMissing?: boolean; now?: number } = {},
): void {
  const keys = ids(sessionIds);
  if (!keys.length) return;
  const now = opts.now ?? Date.now();
  const d = database();
  const stmt = opts.onlyIfMissing
    ? d.query(`
    INSERT OR IGNORE INTO session_containment
      (session_id, agent_slice, sandbox, egress_proxy, role, spawned_by, tmux_name, recorded_at, exit_reason)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL)
  `)
    : d.query(`
    INSERT INTO session_containment
      (session_id, agent_slice, sandbox, egress_proxy, role, spawned_by, tmux_name, recorded_at, exit_reason)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL)
    ON CONFLICT(session_id) DO UPDATE SET
      agent_slice = excluded.agent_slice,
      sandbox = excluded.sandbox,
      egress_proxy = excluded.egress_proxy,
      role = excluded.role,
      spawned_by = excluded.spawned_by,
      tmux_name = excluded.tmux_name,
      recorded_at = excluded.recorded_at,
      exit_reason = NULL
  `);
  d.transaction(() => {
    for (const key of keys) {
      stmt.run(
        key,
        record.agentSlice ? 1 : 0,
        record.sandbox,
        record.egressProxy ? 1 : 0,
        record.role,
        record.spawnedBy,
        record.tmuxName,
        now,
      );
    }
  })();
}

/** The newest record for any of the ids, or null when none was kept. */
export function getSessionContainment(
  sessionIds: Array<string | null | undefined>,
): SessionContainmentRecord | null {
  const keys = ids(sessionIds);
  if (!keys.length) return null;
  const rows = database()
    .query<Row, string[]>(
      `SELECT * FROM session_containment WHERE session_id IN (${keys.map(() => "?").join(",")})
       ORDER BY recorded_at DESC LIMIT 1`,
    )
    .all(...keys);
  return rows[0] ? toRecord(rows[0]) : null;
}

/** Why the session last stopped, stored by the close path. */
export function recordSessionExitReason(
  sessionIds: Array<string | null | undefined>,
  reason: SessionExitReason,
): void {
  const keys = ids(sessionIds);
  if (!keys.length) return;
  const d = database();
  const stmt = d.query("UPDATE session_containment SET exit_reason = ? WHERE session_id = ?");
  d.transaction(() => {
    for (const key of keys) stmt.run(reason, key);
  })();
}

/** Exit reasons for a page of resume-picker rows, keyed by session id. */
export function sessionExitReasons(sessionIds: string[]): Map<string, SessionExitReason> {
  const out = new Map<string, SessionExitReason>();
  const keys = ids(sessionIds);
  if (!keys.length) return out;
  const rows = database()
    .query<{ session_id: string; exit_reason: string | null }, string[]>(
      `SELECT session_id, exit_reason FROM session_containment
       WHERE exit_reason IS NOT NULL AND session_id IN (${keys.map(() => "?").join(",")})`,
    )
    .all(...keys);
  for (const row of rows) if (row.exit_reason === "out_of_memory") out.set(row.session_id, "out_of_memory");
  return out;
}

export function resetSessionContainmentForTests(): void {
  try {
    db?.close();
  } catch {}
  db = null;
  dbPath = null;
}
