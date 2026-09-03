import { mkdirSync, readFileSync } from "node:fs";
import { Database } from "bun:sqlite";
import { PATHS } from "./config.ts";
import { join } from "node:path";
import { sanitizeBotCompactionThreshold } from "./bots/rotation.ts";

export type GlobalSettings = {
  timeZone: string;
  // Ceiling on total LIVE agents (main + subagent + fork + voice), 0 =
  // unlimited. SOFT on a self-hosted box, and deliberately so: it is the
  // owner's own preference about their own hardware, so a launch may overrule
  // it in the moment (activationGate's `overLimit`, which still has to clear
  // the memory budget). On a hosted Computer the plan's limit replaces this
  // value outright and cannot be overruled from here.
  maxLiveAgents: number;
  // Per-bot cap on self-scheduled routines (see src/auto/store.ts's
  // AutoAgentOwner). Unlike maxLiveAgents, 0-as-unlimited is not offered — an
  // unlimited bot is exactly the runaway-self-scheduling failure mode this
  // cap exists to bound, so it is always >= 1.
  maxBotSchedules: number;
  // Global transcript rendering preference. The focused mode is experimental
  // and projects the loaded transcript down to user turns + lfg_output.
  transcriptView: TranscriptView;
  // Rotate a persistent bot onto a fresh session before its context window
  // fills, carrying a handoff summary across. Off means a bot only ever
  // rotates when a human applies a configuration change, and a long-lived
  // conversation eventually fails at the wall the way it does today.
  botAutoCompactionEnabled: boolean;
  // Expose the Computer Use MCP to agents on this box. Off by default and
  // deliberately opt-in: its tools drive a real desktop that only exists where
  // someone installed the X stack, and advertising them where there is no
  // screen would offer an agent capabilities it cannot use. Local only -- this
  // never travels to a hosted Computer.
  computerMcpEnabled: boolean;
  // Run the Executor connector daemon and expose it to agents at
  // /mcp/executor. On by default: it is the one connector gateway per box
  // (docs/team-tooling-design.md). Off stops the daemon and answers 404.
  executorEnabled: boolean;
  // Share of the model's context window at which that rotation fires. Bounded
  // well away from both ends: see sanitizeBotCompactionThreshold for why 40 and
  // 95 are the limits. There is no matching setting for the re-arm mark, which
  // is derived, because two independently editable water marks can be crossed
  // over and produce a bot that rotates on every single turn.
  botCompactionThresholdPercent: number;
  // The update the "What's new" drawer's Skip button last dismissed (a
  // version, tag, or sha — whatever /api/install reported as latestVersion /
  // latestTag / latestSha at the time). "" means nothing has been skipped.
  // Durable per-instance rather than localStorage so the dismissal survives
  // across browsers/devices for this box.
  skippedUpdateVersion: string;
  // Free-text standing instructions the owner writes once and every new
  // managed session then carries. Appended to the launch envelope by
  // withOmgRuntimeContract, so it lands in the same preamble region as the
  // runtime contract and is stripped back out of titles and card previews.
  // "" means nothing extra is appended. This is a per-box preference, not a
  // per-project one: repository rules stay in AGENTS.md.
  customInstructions: string;
};

export type TranscriptView = "full" | "user-lfg-output";

// Upper bound on customInstructions. Every managed session pays this many
// characters of context on its first turn, so the cap is a budget, not a
// storage limit. Longer standing rules belong in a repository AGENTS.md.
export const CUSTOM_INSTRUCTIONS_MAX_LENGTH = 4000;

// A soft admission ceiling backed by the systemd slice's hard memory bound.
export const MAX_LIVE_AGENTS_LIMIT = 64;
// On by default: live agents are the memory-intensive ones, so we cap them out
// of the box. 0 means unlimited (opt-out); anything unset falls back to this.
export const DEFAULT_MAX_LIVE_AGENTS = 16;

// Hard ceiling on the per-bot schedule cap, same role as MAX_LIVE_AGENTS_LIMIT.
export const BOT_SCHEDULE_LIMIT = 20;
// A normal working set for a bot (a morning check, an EOD summary, a weekly
// report, one or two ad hoc watches) without needing to scroll its Schedules
// pane. The cap's job is bounding how many concerns a bot tracks at once, not
// primarily rate-limiting — a single 5-minute cron is worse than eight daily
// ones, and that is handled separately by the minimum-interval floor.
export const DEFAULT_MAX_BOT_SCHEDULES = 5;

// Lazy (function, not a top-level const): PATHS.data can be a test isolation
// hook (see src/auto/store.ts's agentsPath() for the same pattern), and a
// path baked in at module-eval time would keep pointing at whatever PATHS.data
// was when this module first got pulled in by some unrelated static import —
// silently ignoring a test's later reassignment and hitting the real on-disk
// database instead of a temp one.
const legacySettingsPath = () => join(PATHS.data, "settings.json");
const settingsDbPath = () => join(PATHS.data, "lfg.sqlite");
export const DEFAULT_TIME_ZONE = "Asia/Hong_Kong";
let db: Database | null = null;

function envTimeZone(): string {
  return process.env.LFG_SCHED_TZ || DEFAULT_TIME_ZONE;
}

export function validTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone }).format(new Date());
    return true;
  } catch {
    return false;
  }
}

export function validTranscriptView(value: unknown): value is TranscriptView {
  return value === "full" || value === "user-lfg-output";
}

// input may still carry agentsPaused / idleAgentArchiveMinutes: an install
// upgraded from before both features were removed still has those two keys
// sitting in app_settings, and readStoredSettings() reads every row without
// filtering. Simply never reading them here is what makes that safe — an
// unrecognized stored key is just ignored, never a crash or a validation
// failure, satisfying AGENTS.md's backward-compatible migration rule.
function sanitize(input: Partial<GlobalSettings> | null | undefined): GlobalSettings {
  const timeZone = typeof input?.timeZone === "string" && validTimeZone(input.timeZone)
    ? input.timeZone
    : envTimeZone();
  const requestedLive = Number(input?.maxLiveAgents);
  const maxLiveAgents = Number.isInteger(requestedLive) && requestedLive >= 0
    ? Math.min(requestedLive, MAX_LIVE_AGENTS_LIMIT)
    : DEFAULT_MAX_LIVE_AGENTS;
  const requestedBotSchedules = Number(input?.maxBotSchedules);
  const maxBotSchedules = Number.isInteger(requestedBotSchedules) && requestedBotSchedules >= 1
    ? Math.min(requestedBotSchedules, BOT_SCHEDULE_LIMIT)
    : DEFAULT_MAX_BOT_SCHEDULES;
  const transcriptView = validTranscriptView(input?.transcriptView)
    ? input.transcriptView
    : "full";
  const skippedUpdateVersion = typeof input?.skippedUpdateVersion === "string"
    ? input.skippedUpdateVersion
    : "";
  const customInstructions = typeof input?.customInstructions === "string"
    ? input.customInstructions.trim().slice(0, CUSTOM_INSTRUCTIONS_MAX_LENGTH)
    : "";
  const botAutoCompactionEnabled = input?.botAutoCompactionEnabled !== false;
  // Note the polarity: unlike bot auto-compaction, this defaults OFF.
  const computerMcpEnabled = input?.computerMcpEnabled === true;
  const executorEnabled = input?.executorEnabled !== false;
  const botCompactionThresholdPercent = sanitizeBotCompactionThreshold(
    input?.botCompactionThresholdPercent,
  );
  return {
    timeZone,
    maxLiveAgents,
    maxBotSchedules,
    transcriptView,
    botAutoCompactionEnabled,
    computerMcpEnabled,
    executorEnabled,
    botCompactionThresholdPercent,
    skippedUpdateVersion,
    customInstructions,
  };
}

function settingsDb(): Database {
  if (db) return db;
  mkdirSync(PATHS.data, { recursive: true });
  const opened = new Database(settingsDbPath(), { create: true });
  opened.exec("PRAGMA journal_mode = WAL");
  opened.exec("PRAGMA busy_timeout = 5000");
  opened.exec(`
    CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY,
      value_json TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS settings_migrations (
      name TEXT PRIMARY KEY,
      applied_at INTEGER NOT NULL
    );
  `);

  const migrated = opened
    .query<{ found: number }, []>(
      "SELECT 1 AS found FROM settings_migrations WHERE name = 'legacy-settings-json-v1'",
    )
    .get();
  if (!migrated) {
    let legacy: Partial<GlobalSettings> | null = null;
    try {
      legacy = JSON.parse(readFileSync(legacySettingsPath(), "utf8")) as Partial<GlobalSettings>;
    } catch {}
    const initial = sanitize(legacy);
    const write = opened.query(
      "INSERT OR IGNORE INTO app_settings (key, value_json, updated_at) VALUES (?, ?, ?)",
    );
    const migrate = opened.transaction(() => {
      const now = Date.now();
      write.run("timeZone", JSON.stringify(initial.timeZone), now);
      write.run("maxLiveAgents", JSON.stringify(initial.maxLiveAgents), now);
      write.run("maxBotSchedules", JSON.stringify(initial.maxBotSchedules), now);
      write.run("transcriptView", JSON.stringify(initial.transcriptView), now);
      write.run("skippedUpdateVersion", JSON.stringify(initial.skippedUpdateVersion), now);
      opened
        .query("INSERT INTO settings_migrations (name, applied_at) VALUES (?, ?)")
        .run("legacy-settings-json-v1", now);
    });
    migrate();
  }
  db = opened;
  return opened;
}

function readStoredSettings(): Partial<GlobalSettings> {
  const rows = settingsDb()
    .query<{ key: string; value_json: string }, []>("SELECT key, value_json FROM app_settings")
    .all();
  const stored: Record<string, unknown> = {};
  for (const row of rows) {
    try {
      stored[row.key] = JSON.parse(row.value_json);
    } catch {}
  }
  return stored as Partial<GlobalSettings>;
}

/**
 * Drop the cached db handle so the next call to settingsDb() reopens against
 * the current PATHS.data. Needed alongside the lazy settingsDbPath() above: a
 * test that reassigns PATHS.data after some earlier test already opened the
 * real on-disk database (any static import chain can trigger that) would
 * otherwise keep reading/writing that same handle regardless.
 */
export function resetSettingsDbConnectionForTests(): void {
  db?.close();
  db = null;
}

export function getGlobalSettingsSync(): GlobalSettings {
  return sanitize(readStoredSettings());
}

export async function getGlobalSettings(): Promise<GlobalSettings> {
  return getGlobalSettingsSync();
}

export async function setGlobalSettings(patch: Partial<GlobalSettings>): Promise<GlobalSettings> {
  const current = getGlobalSettingsSync();
  const next = sanitize({ ...current, ...patch });
  const database = settingsDb();
  const write = database.query(`
    INSERT INTO app_settings (key, value_json, updated_at) VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at
  `);
  database.transaction(() => {
    const now = Date.now();
    write.run("timeZone", JSON.stringify(next.timeZone), now);
    write.run("maxLiveAgents", JSON.stringify(next.maxLiveAgents), now);
    write.run("maxBotSchedules", JSON.stringify(next.maxBotSchedules), now);
    write.run("transcriptView", JSON.stringify(next.transcriptView), now);
    write.run("botAutoCompactionEnabled", JSON.stringify(next.botAutoCompactionEnabled), now);
    write.run("computerMcpEnabled", JSON.stringify(next.computerMcpEnabled), now);
    write.run("executorEnabled", JSON.stringify(next.executorEnabled), now);
    write.run("botCompactionThresholdPercent", JSON.stringify(next.botCompactionThresholdPercent), now);
    write.run("skippedUpdateVersion", JSON.stringify(next.skippedUpdateVersion), now);
    write.run("customInstructions", JSON.stringify(next.customInstructions), now);
  })();
  return next;
}
