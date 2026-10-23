// Registry of sessions lfg started itself. `tmuxName` is the historical field
// name for the stable managed-runtime key: native TUI agents still own a tmux
// session with that name, while command-file SDK agents are direct processes.
// The file survives a server restart so lfg can reconnect to either lifecycle.
import {
  appendFileSync,
  closeSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname } from "node:path";
import { PATHS } from "./config.ts";
import { OMG_CAPABILITY_VERSION } from "./omg-capabilities.ts";
import { tmuxHasSession } from "./tmux.ts";
import { recordSessionContainment } from "./session-containment-record.ts";
import type { CodexServiceTier } from "./service-tier.ts";
import type { SandboxMode } from "./sandbox/bwrap.ts";
import { roleEgress, roleSandbox } from "./policy/roles.ts";
import { findEntryByAnyId as findHarnessEntryByAnyId } from "./aisdk-registry.ts";
import { usesCommandFileRuntime } from "./coding-agent-adapters.ts";

function registryPath(): string {
  return `${PATHS.data}/managed-sessions.json`;
}

function lockPath(): string {
  return `${registryPath()}.lock`;
}

// Retired rows. Append-only JSON lines, one { archivedAt, session } object per
// line. Kept apart from the live registry so the hot session scan never walks
// them, and so an older binary that rewrites the registry cannot drop them.
function archivePath(): string {
  return `${PATHS.data}/managed-sessions.archive.jsonl`;
}

export type ManagedSession = {
  tmuxName: string;
  cwd: string;
  createdAt: number;
  agent?: "claude" | "codex" | "aisdk" | "codex-aisdk" | "opencode" | "omg" | "jcode" | "grok" | "cursor" | "fx" | "muse" | "deepseek" | "devin" | "hermes" | "pi" | "copilot";
  /** Explicit runtime for new rows. Missing preserves the legacy kind-based runtime. */
  runtime?: "tmux" | "command-file";
  // Stable id shown to clients for lfg-created sessions. For agents that mint a
  // native transcript id later (Claude/Codex CLI, Codex AI-SDK, Grok), this is
  // the durable control-plane id while nativeSessionId records the provider id.
  sessionId?: string;
  nativeSessionId?: string;
  launchState?: "launching" | "running" | "failed";
  launchError?: string;
  /**
   * True from the moment POST /api/sessions/new answers until its background
   * start (worktree checkout, agent spawn) finishes. The row is listed and
   * addressable during that window even though no pane or harness exists yet.
   */
  hydrating?: boolean;
  /** When the background start began the agent process. Boot grace counts from here. */
  spawnedAt?: number;
  /**
   * Set only when the background start of a new session failed. Recovery
   * failures also write launchState "failed" but stay hidden, as before; this
   * marks the failures the person just caused and must be told about.
   */
  launchFailedAt?: number;
  model?: string;
  /** Reasoning effort selected for subsequent turns, when the agent supports it. */
  thinkingLevel?: string;
  builderPreset?: string;
  /** Codex account service tier selected when this session launched. */
  serviceTier?: CodexServiceTier | null;
  /** Provider-native low-latency mode, independent from reasoning effort. */
  fastMode?: boolean;
  /** Isolated Claude subscription account pinned when this session launched. */
  claudeAccountId?: string;
  title?: string;
  /** Stable UI project label. Empty string means explicitly no project; undefined is legacy. */
  project?: string;
  /**
   * Project this no-project chat created with omg_create_project. The serve
   * sweep moves the session there at its next idle boundary, then clears it.
   */
  pendingProjectMove?: { cwd: string; project: string; requestedAt: number };
  parentSessionId?: string;
  parentNativeSessionId?: string;
  parentAgent?: string;
  spawnedBy?: "subagent" | "fork" | "finding" | "voice" | string;
  /** Durable product conversation. Runtime ids may rotate without changing it. */
  conversationId?: string;
  /** Bot configuration revision loaded when this runtime started. */
  appliedConfigRevision?: number;
  botId?: string;
  persistent?: boolean;
  /** LFG agent capability contract/tool catalog present when this process launched. */
  capabilityVersion?: string;
  /** Main repo checkout when cwd is an auto-provisioned worktree. */
  repoRoot?: string;
  worktreeBranch?: string;
  /** Set when boot reconciliation relaunched a process without replaying its turn. */
  interruptedAt?: number;
  recoveredFromBootId?: string;
  /**
   * Boot id that already attempted recovery for this row. Native TUI agents
   * have no aisdk registry entry to journal against, so the claim lives here
   * to keep a crash-looping relaunch from respawning on every serve restart.
   */
  recoveryClaimBootId?: string;
  /**
   * Role this session runs as at the shared MCP endpoints (src/policy/roles.ts).
   * Missing means owner, which is every row created before roles existed.
   */
  role?: string;
  /**
   * Set on rows created after session tokens landed: the endpoint then only
   * honours this session's id with its token (src/policy/session-token.ts).
   * Missing keeps the pre-token behaviour for rows that were launched
   * without one, so an upgrade does not silently make them anonymous.
   */
  mcpTokenRequired?: boolean;
  /**
   * Containment the first harness spawn used. Every relaunch (a send or resume
   * to a dead harness, boot recovery) reuses it, so a subagent that was OOM
   * killed in its lfg-agent-<name> unit comes back in that unit, not outside
   * it. Missing on rows created before this field: see managedContainment.
   */
  containment?: ManagedContainment;
};

export type ManagedContainment = {
  /** systemd-run unit lfg-agent-<tmuxName> in lfg-agents.slice (MemoryMax, KillMode). */
  agentSlice: boolean;
  sandbox: SandboxMode;
  /**
   * The role's egress allowlist proxy. The URL itself is not stored: it holds
   * a session token and a proxy port that can change across serve restarts.
   */
  egressProxy: boolean;
};

/**
 * The containment a row's first spawn used. New rows record it at creation.
 * Older rows fall back to what the create paths have always done: subagents
 * and bots run in the agent slice, and the role decides sandbox and egress.
 * The caller never chooses this; it comes from the row.
 */
// Keep the launch containment after the row is removed on close
// (src/session-containment-record.ts). A failed write is logged, never thrown:
// the owner row itself is already committed.
const RECORDED_FIELDS = ["sessionId", "nativeSessionId", "containment", "role", "spawnedBy", "tmuxName"] as const;

function keepContainmentRecord(row: ManagedSession, opts?: { onlyIfMissing?: boolean }): void {
  if (!row.sessionId && !row.nativeSessionId) return;
  try {
    const containment = managedContainment(row);
    recordSessionContainment([row.sessionId, row.nativeSessionId], {
      ...containment,
      role: row.role ?? null,
      spawnedBy: row.spawnedBy ?? null,
      tmuxName: row.tmuxName,
    }, opts);
  } catch (error) {
    console.error(`[managed] containment record for ${row.tmuxName} failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export function managedContainment(row: ManagedSession): ManagedContainment {
  if (row.containment) return row.containment;
  return {
    agentSlice: row.spawnedBy === "subagent" || row.spawnedBy === "bot",
    sandbox: roleSandbox(row.role),
    egressProxy: roleEgress(row.role).mode === "allowlist",
  };
}

type ManagedRegistry = {
  version: 2;
  sessions: Record<string, ManagedSession>;
  /** Claims outlive live rows so delayed retries cannot replace closed sessions. */
  creationClaims: Record<string, ManagedSession>;
};

export type AddManagedResult =
  | { created: true; session: ManagedSession }
  | { created: false; session: ManagedSession };

let memory: ManagedRegistry | null = null;
let memoryPath: string | null = null;
let memoryFingerprint = "";

function emptyRegistry(): ManagedRegistry {
  return { version: 2, sessions: {}, creationClaims: {} };
}

function creationClaimKey(idempotencyKey: string): string {
  return `claim:${idempotencyKey}`;
}

function parseRegistry(value: unknown): ManagedRegistry {
  if (value && typeof value === "object" && (value as { version?: unknown }).version === 2) {
    const v2 = value as Partial<ManagedRegistry>;
    return {
      version: 2,
      sessions: v2.sessions && typeof v2.sessions === "object" ? v2.sessions : {},
      creationClaims:
        v2.creationClaims && typeof v2.creationClaims === "object" ? v2.creationClaims : {},
    };
  }
  // Version 1 was the session map itself. Upgrade without dropping live rows.
  return {
    version: 2,
    sessions: value && typeof value === "object" ? value as Record<string, ManagedSession> : {},
    creationClaims: {},
  };
}

function fingerprint(path: string): string {
  try {
    const st = statSync(path);
    return `${st.mtimeMs}:${st.size}`;
  } catch {
    return "";
  }
}

function readAll(force = false): ManagedRegistry {
  const path = registryPath();
  const currentFingerprint = fingerprint(path);
  if (!force && memory && memoryPath === path && memoryFingerprint === currentFingerprint) {
    return memory;
  }
  try {
    const parsed = parseRegistry(JSON.parse(readFileSync(path, "utf8")));
    memory = parsed;
    memoryPath = path;
    memoryFingerprint = currentFingerprint;
    return parsed;
  } catch {
    // Keep the last valid in-memory roster if another process is between
    // durable writes. Atomic rename makes this exceptional, but preserving the
    // last good view is safer than flashing an empty session list.
    if (memory && memoryPath === path) return memory;
    memory = emptyRegistry();
    memoryPath = path;
    memoryFingerprint = currentFingerprint;
    return memory;
  }
}

function writeAll(all: ManagedRegistry): void {
  const path = registryPath();
  const dir = dirname(path);
  mkdirSync(dir, { recursive: true });
  const temp = `${path}.${process.pid}.${crypto.randomUUID()}.tmp`;
  writeFileSync(temp, JSON.stringify(all, null, 2), { mode: 0o600 });
  try {
    const fd = openSync(temp, "r");
    try {
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    renameSync(temp, path);
    // Persist the rename itself where the filesystem supports directory fsync.
    try {
      const dirFd = openSync(dir, "r");
      try {
        fsyncSync(dirFd);
      } finally {
        closeSync(dirFd);
      }
    } catch {}
  } finally {
    try {
      unlinkSync(temp);
    } catch {}
  }
  memory = all;
  memoryPath = path;
  memoryFingerprint = fingerprint(path);
}

const lockWait = new Int32Array(new SharedArrayBuffer(4));

function pidAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function withRegistryLock<T>(fn: () => T): T {
  const path = lockPath();
  mkdirSync(dirname(path), { recursive: true });
  let fd: number | null = null;
  for (let attempt = 0; attempt < 200; attempt++) {
    try {
      const candidate = openSync(path, "wx", 0o600);
      try {
        writeFileSync(candidate, String(process.pid));
      } catch (err) {
        closeSync(candidate);
        try {
          unlinkSync(path);
        } catch {}
        throw err;
      }
      fd = candidate;
      break;
    } catch (err) {
      if ((err as { code?: string }).code !== "EEXIST") throw err;
      let owner = 0;
      let ageMs = 0;
      try {
        owner = Number(readFileSync(path, "utf8"));
      } catch {}
      try {
        ageMs = Date.now() - statSync(path).mtimeMs;
      } catch {}
      // An empty owner can be the tiny window between another process creating
      // the lock and writing its pid, so only reap a known-dead owner or a lock
      // old enough that no registry mutation could still be using it.
      if ((owner > 0 && !pidAlive(owner)) || ageMs > 30_000) {
        try {
          unlinkSync(path);
        } catch {}
        continue;
      }
      Atomics.wait(lockWait, 0, 0, 5);
    }
  }
  if (fd == null) throw new Error("managed session registry is busy");
  try {
    return fn();
  } finally {
    closeSync(fd);
    try {
      unlinkSync(path);
    } catch {}
  }
}

export function listManaged(): ManagedSession[] {
  return Object.values(readAll().sessions).map((row) => ({ ...row }));
}

/** Return the session first committed for a caller-supplied creation key. */
export function getManagedSessionCreation(idempotencyKey: string): ManagedSession | null {
  const claim = readAll().creationClaims[creationClaimKey(idempotencyKey)];
  return claim ? { ...claim } : null;
}

/**
 * Atomically claim an idempotency key and add its managed session. The claim
 * and row share one fsynced rename, so a crash exposes both or neither.
 */
export function addManaged(rec: ManagedSession, idempotencyKey?: string): AddManagedResult {
  return withRegistryLock(() => {
    const current = readAll(true);
    const all: ManagedRegistry = {
      version: 2,
      sessions: { ...current.sessions },
      creationClaims: { ...current.creationClaims },
    };
    const claimKey = idempotencyKey ? creationClaimKey(idempotencyKey) : null;
    const priorClaim = claimKey ? all.creationClaims[claimKey] : null;
    if (priorClaim) return { created: false, session: { ...priorClaim } };

    const identities = new Set(
      [rec.sessionId, rec.nativeSessionId].filter((id): id is string => !!id),
    );
    // A cold/manual resume may use a new runtime name for the same durable
    // conversation. Keep one owner row so later boot reconciliation cannot
    // launch both the stale and current records.
    //
    // That deletion assumed the duplicate it found was always a dead
    // pre-reboot row. It is not: session 7e2ba55a vanished from the fleet —
    // row deleted, tmux pane and worktree left running, untouched, with no
    // error and no trace — because one caller (the jcode resume handler,
    // src/commands/serve.ts) took this same "prior row is dead" assumption
    // on a stale or racing resume while the pane was still alive. That one
    // call site now checks tmuxHasSession() first and refuses (409) instead
    // of calling this function at all (see the comment at its call site).
    // But this dedup is generic — every caller that ever passes a sessionId
    // or nativeSessionId already used by a live pane hits the same delete,
    // and most callers do not, and should not have to, replicate that check
    // themselves. So the liveness check belongs here, not at each site.
    //
    // Deliberately checked by the actual pane, not by agent/runtime label:
    // COMMAND_FILE_AGENT_KINDS (coding-agent-adapters.ts) counts grok and
    // cursor as "command-file" because that is how prompts reach them, but
    // spawnManagedGrokSession/spawnManagedCursorSession (tmux.ts) still launch
    // them with a real `tmux new-session` — the pane exists regardless of what
    // the control protocol is called, so tmuxHasSession is still the right
    // question to ask for them. jcode and legacy claude/codex are the same.
    // Rows for a truly paneless runtime (aisdk, codex-aisdk, opencode, pi —
    // spawned directly via spawnManagedHarness, no tmux involved at all) never
    // have a session under `tmuxName` to find, so tmuxHasSession is always
    // false there and this guard is a no-op, not a gap: every caller that
    // could collide a command-file identity mints a fresh random sessionId
    // per call (client-errors.ts, actions/index.ts) or is itself the record's
    // own row (session-recovery.ts's boot adoption), so none can actually hit
    // this branch for a live paneless duplicate today. If that changes, the
    // check needs a pid-liveness path too.
    //
    // A row surviving here because its pane is alive is left as a duplicate
    // identity, not reconciled away. That is a lesser, already-documented
    // risk (see the boot-reconciliation comment above) — a rare redundant
    // relaunch — not the data-loss failure this guards against. Silently
    // deleting a live session's only pointer is worse than a stale extra row.
    if (identities.size) {
      for (const [name, existing] of Object.entries(all.sessions)) {
        if (name === rec.tmuxName) continue;
        if (![existing.sessionId, existing.nativeSessionId].some((id) => id && identities.has(id))) {
          continue;
        }
        // Check liveness only for an actual delete candidate — tmuxHasSession
        // shells out, and most rows in the registry never reach this line.
        if (tmuxHasSession(name)) continue;
        delete all.sessions[name];
      }
    }
    const stored = {
      ...rec,
      capabilityVersion: rec.capabilityVersion ?? OMG_CAPABILITY_VERSION,
    };
    all.sessions[rec.tmuxName] = stored;
    if (claimKey) all.creationClaims[claimKey] = stored;
    writeAll(all);
    keepContainmentRecord(stored);
    return { created: true, session: { ...stored } };
  });
}

export function patchManaged(tmuxName: string, patch: Partial<ManagedSession>): void {
  withRegistryLock(() => {
    const current = readAll(true);
    const all: ManagedRegistry = {
      version: 2,
      sessions: { ...current.sessions },
      creationClaims: { ...current.creationClaims },
    };
    const cur = all.sessions[tmuxName];
    if (!cur) return;
    all.sessions[tmuxName] = { ...cur, ...patch };
    writeAll(all);
    if (RECORDED_FIELDS.some((field) => field in patch)) keepContainmentRecord(all.sessions[tmuxName]!);
  });
}

/** Replace an automatic title only while the original fallback still owns it. */
export function replaceManagedTitle(
  tmuxName: string,
  expected: string | undefined,
  title: string,
): boolean {
  return withRegistryLock(() => {
    const current = readAll(true);
    const cur = current.sessions[tmuxName];
    if (!cur || cur.title !== expected) return false;
    const updated = { ...cur, title };
    const creationClaims = { ...current.creationClaims };
    for (const [key, claim] of Object.entries(creationClaims)) {
      if (claim.tmuxName === tmuxName) creationClaims[key] = { ...claim, title };
    }
    writeAll({
      version: 2,
      sessions: { ...current.sessions, [tmuxName]: updated },
      creationClaims,
    });
    return true;
  });
}

export function removeManaged(tmuxName: string, opts?: { forgetCreation?: boolean }): void {
  withRegistryLock(() => {
    const current = readAll(true);
    const all: ManagedRegistry = {
      version: 2,
      sessions: { ...current.sessions },
      creationClaims: { ...current.creationClaims },
    };
    if (tmuxName in all.sessions) {
      if (opts?.forgetCreation) {
        for (const [key, claim] of Object.entries(all.creationClaims)) {
          if (claim.tmuxName === tmuxName) delete all.creationClaims[key];
        }
      }
      const removed = all.sessions[tmuxName]!;
      delete all.sessions[tmuxName];
      writeAll(all);
      // Rows created before the record store have none yet. Keep one now,
      // before the owner row is gone.
      keepContainmentRecord(removed, { onlyIfMissing: true });
    }
  });
}

// Is this tmux name one we started? `target` may be a full pane target
// (`name:0.0`) or a bare session name — we compare on the session-name segment.
export function isManagedName(target: string | null): boolean {
  if (!target) return false;
  const name = target.split(":")[0];
  return name in readAll().sessions;
}

// --- Retirement -------------------------------------------------------------
//
// Nothing closes a session that a reboot or a crash killed, so its row used to
// stay forever, and every session list scan walked it (158 rows, 2 alive, on
// one box). Retirement moves a dead old row to the archive file. The lookups
// that a dead session still needs (transcript resolution, resume, feeds, the
// worktree sweeper) read the archive through findManagedById and
// listManagedWithArchive. The live scan reads listManaged and never sees it.

/** A row must be this long past its last launch event before it can retire. */
export const MANAGED_RETIRE_AFTER_MS = 30 * 24 * 60 * 60_000;

type ArchivedManaged = { archivedAt: number; session: ManagedSession };

type ArchiveView = {
  /** Newest archived copy per tmuxName. */
  byName: Map<string, ManagedSession>;
  /** Newest archived copy per sessionId and nativeSessionId. */
  byId: Map<string, ManagedSession>;
};

let archiveMemory: ArchiveView | null = null;
let archiveMemoryPath: string | null = null;
let archiveFingerprint = "";

function readArchive(): ArchiveView {
  const path = archivePath();
  const current = fingerprint(path);
  if (archiveMemory && archiveMemoryPath === path && archiveFingerprint === current) return archiveMemory;
  const view: ArchiveView = { byName: new Map(), byId: new Map() };
  let text = "";
  try {
    text = readFileSync(path, "utf8");
  } catch {}
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    let parsed: ArchivedManaged;
    try {
      parsed = JSON.parse(line) as ArchivedManaged;
    } catch {
      // A torn final line from a crash mid-append. Earlier lines are intact.
      continue;
    }
    const row = parsed?.session;
    if (!row || typeof row !== "object" || typeof row.tmuxName !== "string") continue;
    // Later lines are newer, so they win.
    view.byName.set(row.tmuxName, row);
    if (row.sessionId) view.byId.set(row.sessionId, row);
    if (row.nativeSessionId) view.byId.set(row.nativeSessionId, row);
  }
  archiveMemory = view;
  archiveMemoryPath = path;
  archiveFingerprint = current;
  return view;
}

function appendArchive(rows: ManagedSession[], archivedAt: number): void {
  if (!rows.length) return;
  const path = archivePath();
  mkdirSync(dirname(path), { recursive: true });
  const body = rows
    .map((session) => JSON.stringify({ archivedAt, session } satisfies ArchivedManaged))
    .join("\n") + "\n";
  appendFileSync(path, body, { mode: 0o600 });
  const fd = openSync(path, "r");
  try {
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}

/** Retired rows, newest copy per runtime name. Not for the live scan. */
export function listArchivedManaged(): ManagedSession[] {
  return [...readArchive().byName.values()].map((row) => ({ ...row }));
}

/**
 * Live rows plus the retired rows whose runtime name has no live row. For
 * readers that describe history (feeds, galleries, the worktree sweeper).
 * Never for the live session scan.
 */
export function listManagedWithArchive(): ManagedSession[] {
  const live = readAll().sessions;
  const out = Object.values(live).map((row) => ({ ...row }));
  for (const row of readArchive().byName.values()) {
    if (!(row.tmuxName in live)) out.push({ ...row });
  }
  return out;
}

/** The row for a session id: the live row first, else its retired copy. */
export function findManagedById(id: string | null | undefined): ManagedSession | undefined {
  if (!id) return undefined;
  const live = Object.values(readAll().sessions).find(
    (row) => row.sessionId === id || row.nativeSessionId === id,
  );
  if (live) return { ...live };
  const archived = readArchive().byId.get(id);
  return archived ? { ...archived } : undefined;
}

export type ManagedRetirementProbes = {
  /** A tmux session under the row's runtime name exists. */
  hasTmuxSession?: (tmuxName: string) => boolean;
  /**
   * A command-file harness entry (data/aisdk) exists for the row. Boot
   * recovery relaunches from that entry and needs its owner row, so a row
   * with an entry is never retired, whether the harness is alive or not.
   */
  hasHarnessEntry?: (row: ManagedSession) => boolean;
  /**
   * The session has messages in the direct transcript index. A dead
   * command-file row with messages stays in the live list (managedLaunchRow
   * "explained"), and the resume picker catalogs direct-index sessions from
   * their row (refreshResumableCacheOnce). Either way the row stays.
   */
  hasIndexedMessages: (sessionId: string) => boolean;
};

/** The newest launch event on the row. Retirement age counts from here. */
export function managedLastLaunchEventAt(row: ManagedSession): number {
  return Math.max(row.createdAt ?? 0, row.spawnedAt ?? 0, row.interruptedAt ?? 0, row.launchFailedAt ?? 0);
}

/**
 * The part of the retirement rule that needs no probe. A row that fails this
 * check is kept. A row that passes it still needs the probes in
 * retireDeadManaged before it retires.
 */
export function managedRetirementCandidate(
  row: ManagedSession,
  now: number,
  maxAgeMs = MANAGED_RETIRE_AFTER_MS,
): boolean {
  if (now - managedLastLaunchEventAt(row) < maxAgeMs) return false;
  // Listed while its background start runs, and after that start failed.
  if (row.hydrating) return false;
  // A start failure the person caused stays listed with its reason.
  if (row.launchState === "failed" && row.launchFailedAt !== undefined) return false;
  // managedLaunchRow lists every command-file row that says "launching".
  if (row.launchState === "launching" && usesCommandFileRuntime(row.agent, row.runtime)) return false;
  // Bots own their runtime row and replace it themselves.
  if (row.botId || row.persistent) return false;
  // The project move sweep still has work for this row.
  if (row.pendingProjectMove) return false;
  return true;
}

/**
 * Move dead old rows from the live registry to the archive. Returns the rows
 * it retired. A row retires only when all of these hold:
 *   - managedRetirementCandidate: old enough, not hydrating, not a listed
 *     start failure or command-file launch, not a bot, no pending move;
 *   - no tmux session under its runtime name;
 *   - no command-file harness entry (boot recovery owns those);
 *   - no messages in the direct transcript index under either id;
 *   - no row that stays names it as a parent.
 * The archive line is fsynced before the registry drops the row. A crash in
 * between leaves a duplicate (the live row wins), not a lost row.
 */
export function retireDeadManaged(opts: {
  now?: number;
  maxAgeMs?: number;
  probes: ManagedRetirementProbes;
}): ManagedSession[] {
  const now = opts.now ?? Date.now();
  const maxAgeMs = opts.maxAgeMs ?? MANAGED_RETIRE_AFTER_MS;
  const hasTmuxSession = opts.probes.hasTmuxSession ?? tmuxHasSession;
  const hasHarnessEntry = opts.probes.hasHarnessEntry ?? ((row: ManagedSession) =>
    [row.sessionId, row.nativeSessionId].some((id) => !!id && !!findHarnessEntryByAnyId(id)));
  // Probe outside the lock. The probes shell out or query a database, and a
  // first pass over a long-grown registry would hold the lock long enough for
  // a concurrent create to give up with "registry is busy". Only candidates
  // reach the probes.
  const dead = new Map<string, string>();
  for (const row of Object.values(readAll(true).sessions)) {
    if (!managedRetirementCandidate(row, now, maxAgeMs)) continue;
    if (hasTmuxSession(row.tmuxName)) continue;
    if (hasHarnessEntry(row)) continue;
    if ([row.sessionId, row.nativeSessionId].some((id) => !!id && opts.probes.hasIndexedMessages(id))) continue;
    dead.set(row.tmuxName, JSON.stringify(row));
  }
  if (!dead.size) return [];
  return withRegistryLock(() => {
    const current = readAll(true);
    const rows = Object.values(current.sessions);
    // A row that changed since it was probed (a resume, a patch) stays.
    const retire = new Set<string>(
      rows.filter((row) => dead.get(row.tmuxName) === JSON.stringify(row)).map((row) => row.tmuxName),
    );
    // A kept child keeps its parent, so the session tree stays whole. Repeat
    // until stable, because a kept parent keeps its own parent too.
    for (let changed = true; changed && retire.size > 0;) {
      changed = false;
      const keptParents = new Set<string>();
      for (const row of rows) {
        if (retire.has(row.tmuxName)) continue;
        if (row.parentSessionId) keptParents.add(row.parentSessionId);
        if (row.parentNativeSessionId) keptParents.add(row.parentNativeSessionId);
      }
      for (const row of rows) {
        if (!retire.has(row.tmuxName)) continue;
        if (
          (row.sessionId && keptParents.has(row.sessionId)) ||
          (row.nativeSessionId && keptParents.has(row.nativeSessionId))
        ) {
          retire.delete(row.tmuxName);
          changed = true;
        }
      }
    }
    if (!retire.size) return [];
    const retired = rows.filter((row) => retire.has(row.tmuxName));
    appendArchive(retired, now);
    const sessions = { ...current.sessions };
    for (const name of retire) delete sessions[name];
    writeAll({ version: 2, sessions, creationClaims: { ...current.creationClaims } });
    // Same as removeManaged: keep the launch containment for a later resume.
    for (const row of retired) keepContainmentRecord(row, { onlyIfMissing: true });
    return retired.map((row) => ({ ...row }));
  });
}

export function resetManagedRegistryForTests(): void {
  memory = null;
  memoryPath = null;
  memoryFingerprint = "";
  archiveMemory = null;
  archiveMemoryPath = null;
  archiveFingerprint = "";
  try {
    rmSync(lockPath(), { force: true });
  } catch {}
}
