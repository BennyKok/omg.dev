// Per-session memory and disk attribution for the Storage & performance panel.
//
// Why this exists: a managed session is not one process. On a 22 GB box with no
// swap, the thing that OOMs us is the SUM of a session's tree — the coding-agent
// harness (~250-380 MB), the bun backend (~40-90 MB), its MCP servers (~165 MB
// each), plus anything the agent started inside its worktree. The dev servers
// are the dangerous ones: `expo start` holds 400-750 MB apiece and SURVIVES
// session teardown, so they accumulate for days with nothing pointing at them.
// Without this breakdown an operator sees "memory 92%" and has no idea which
// session to close, so the only move is SSH + `ps`.
//
// Attribution is deliberately layered, because no single key covers every
// process (verified against a live box, 2026-08-10):
//
//   1. cmdline    — the backend carries `--session <uuid> --managed-name <name>`.
//                   Authoritative, but only marks the backend itself.
//   2. cgroup     — newer sessions run in `lfg-agent-<name>.service` under
//                   lfg-agents.slice. Exact when present, but sessions launched
//                   before that landed have NO scope, so it cannot be the base.
//   3. environ    — `LFG_SESSION_ID` / `AGENT_BROWSER_SESSION` are inherited by
//                   every descendant, which is what still identifies an orphaned
//                   dev server days after its session is gone. This is the one
//                   that catches the leak, so it is the primary key.
//   4. ancestry   — anything unlabelled inherits its nearest labelled ancestor,
//                   covering children that scrub their own environment.
//
// NOTHING here writes, signals, or kills. It is a read-only view; reclaiming is
// the operator's call (and archiveIdleDurableAgentsForMemory's job).

import { existsSync } from "node:fs";
import { readFile, readdir, readlink } from "node:fs/promises";
import { cpus, freemem, loadavg, totalmem } from "node:os";

import { WORKTREE_ROOT } from "./worktree.ts";

/** Which part of a session's footprint a process represents. */
export type UsageComponent = "harness" | "backend" | "mcp" | "devserver" | "browser" | "other";

export const USAGE_COMPONENTS: UsageComponent[] = [
  "harness",
  "backend",
  "mcp",
  "devserver",
  "browser",
  "other",
];

export type UsageProc = {
  pid: number;
  component: UsageComponent;
  /** Sanitised, length-capped command summary. Never the raw cmdline (see labelFor). */
  label: string;
  rssBytes: number;
  /** Proportional set size: shared pages divided by sharers. Null if unreadable. */
  pssBytes: number | null;
  /** Seconds since the process started, or null if the clock could not be read. */
  ageSec: number | null;
};

export type SessionUsageRow = {
  /** Stable identity for the UI list: sessionId when known, else the managed name. */
  key: string;
  sessionId: string | null;
  managedName: string | null;
  title: string | null;
  agent: string | null;
  /** True when a live managed session owns these processes. */
  live: boolean;
  /**
   * Processes attributed to a session that is NOT live — recoverable waste.
   * This is the class we cleaned up by hand: dev servers outliving their agent.
   */
  orphan: boolean;
  procCount: number;
  /** Best available total: PSS when every process reported it, else RSS. */
  memBytes: number;
  memBasis: "pss" | "rss";
  rssBytes: number;
  pssBytes: number | null;
  byComponent: Record<UsageComponent, number>;
  procs: UsageProc[];
  worktreePath: string | null;
  /** Disk used by the session's worktree. Null until the cached `du` lands. */
  diskBytes: number | null;
};

export type SessionUsageHost = {
  memTotalBytes: number;
  /** MemAvailable — what a new allocation can actually get. The OOM-relevant number. */
  memAvailableBytes: number;
  memUsedBytes: number;
  swapTotalBytes: number;
  swapFreeBytes: number;
  cores: number;
  load1: number;
  load5: number;
  load15: number;
};

export type SessionUsageReport = {
  sampledAt: number;
  scanMs: number;
  host: SessionUsageHost;
  sessions: SessionUsageRow[];
  /** Total attributed to non-live sessions — the headline "reclaimable" figure. */
  orphanBytes: number;
  /** Sum of every session row. */
  attributedBytes: number;
  /**
   * Memory held by processes belonging to no session (the LFG server itself,
   * system daemons, the operator's own shells). Included so the rows visibly
   * do not have to add up to host usage — an operator who cannot see the
   * remainder will assume the breakdown is lying.
   */
  unattributedBytes: number;
  /** True while at least one worktree size is still being measured. */
  diskPending: boolean;
};

/** The live-session facts this module needs. Keeps it decoupled from sessions.ts. */
export type UsageSessionInput = {
  sessionId: string | null;
  tmuxName: string | null;
  cwd: string | null;
  /** Harness pid, used as the strongest process→session key. */
  pid?: number | null;
  title?: string | null;
  agent?: string | null;
  managed?: boolean;
};

type ProcInfo = {
  pid: number;
  ppid: number;
  argv: string[];
  rssBytes: number;
  pssBytes: number | null;
  ageSec: number | null;
  cgroup: string;
  env: { sessionId?: string; managedName?: string };
  cwd: string | null;
};

// Only these keys are ever read out of /proc/<pid>/environ. The environment of
// an agent process holds proxy tokens and API secrets (LFG_PROXY_TOKEN,
// LFG_ELEVEN_LLM_SECRET, ...), and this report is rendered in a browser, so the
// allowlist is a security boundary — never widen it to a prefix match.
const ENV_SESSION_ID = "LFG_SESSION_ID";
const ENV_BROWSER_SESSION = "AGENT_BROWSER_SESSION";

// Processes that must never lend their identity to a descendant.
//
// The tmux server is the reason this list exists: it is a single long-lived
// process shared by EVERY tmux session, and it keeps the environment of
// whichever session happened to start it. Allowing inheritance through it
// charged an unrelated interactive claude, an ssh, and a login shell to a
// session that had exited days earlier — a fabricated 271 MB "orphan" pointing
// at the wrong thing. Same argument for systemd and the LFG server: they parent
// half the box, so what they own says nothing about what their children own.
const NON_DONOR_BINARIES = new Set(["tmux", "tmux-server", "systemd", "init", "sshd", "login"]);

const AGENT_SCOPE_RE = /lfg-agent-([^/]+)\.service/;
const MANAGED_NAME_RE = /^[A-Za-z0-9._-]+$/;

// `AGENT_BROWSER_SESSION=default` is the sentinel for "no session" — it is what
// the server itself and anything started outside a session inherit. Treating it
// as a name collected 17 unrelated processes into a single fictional 700 MB
// "orphaned session", which is exactly the kind of confident nonsense that
// makes an operator stop trusting the panel.
const RESERVED_NAMES = new Set(["default", "none", "unknown"]);

// Harness binaries (see CODING_AGENT_LABELS). Matched on the executable's base
// name, never on a substring of the command line: the backend's argv contains
// the entire user prompt, and a prompt that merely mentions "codex" must not be
// counted as a harness.
const HARNESS_BINARIES = new Set([
  "claude",
  "codex",
  "grok",
  "cursor",
  "cursor-agent",
  "fx",
  "opencode",
  "copilot",
  "pi",
]);

// Long-lived servers agents start inside a worktree. These are the processes
// that orphan, so the list is about recognising the shape (a dev/preview/build
// server), not about blessing specific tools.
const DEVSERVER_BINARIES = new Set([
  "expo",
  "vite",
  "next",
  "webpack",
  "rollup",
  "parcel",
  "nuxt",
  "astro",
  "remix",
  "ng",
  "caddy",
  "hyperframes",
  "storybook",
  "http-server",
  "serve",
]);

const DEVSERVER_VERBS = new Set([
  "start",
  "dev",
  "serve",
  "preview",
  "present",
  "build",
  "watch",
]);

function baseName(path: string): string {
  const cut = path.lastIndexOf("/");
  return cut === -1 ? path : path.slice(cut + 1);
}

/**
 * Read one process. Returns null for anything that vanished mid-walk: /proc is
 * a live directory and a scan that throws on an exited pid is a scan that fails
 * every time the box is busy — exactly when this panel is being read.
 */
async function readProc(pid: number, uptimeSec: number | null): Promise<ProcInfo | null> {
  let argv: string[];
  let ppid = 0;
  let rssBytes = 0;
  let ageSec: number | null = null;
  try {
    const [cmdlineRaw, statRaw] = await Promise.all([
      readFile(`/proc/${pid}/cmdline`, "utf8"),
      readFile(`/proc/${pid}/stat`, "utf8"),
    ]);
    argv = cmdlineRaw.split("\0").filter(Boolean);
    if (!argv.length) return null; // kernel thread
    // The comm field is parenthesised and may itself contain spaces or ')',
    // so fields are counted from the LAST ')' rather than by splitting the row.
    const afterComm = statRaw.slice(statRaw.lastIndexOf(")") + 2).split(" ");
    ppid = Number(afterComm[1]);
    const rssPages = Number(afterComm[21]);
    if (Number.isFinite(rssPages)) rssBytes = rssPages * 4096;
    const startTicks = Number(afterComm[19]);
    if (uptimeSec != null && Number.isFinite(startTicks)) {
      ageSec = Math.max(0, Math.round(uptimeSec - startTicks / 100));
    }
  } catch {
    return null;
  }

  let pssBytes: number | null = null;
  try {
    const rollup = await readFile(`/proc/${pid}/smaps_rollup`, "utf8");
    const match = rollup.match(/^Pss:\s+(\d+) kB/m);
    if (match) pssBytes = Number(match[1]) * 1024;
  } catch {
    // Unreadable (other uid, or no smaps_rollup on this kernel) — RSS stands in.
  }

  let cgroup = "";
  try {
    const raw = await readFile(`/proc/${pid}/cgroup`, "utf8");
    cgroup = raw.trim().split("::")[1] ?? "";
  } catch {
    // cgroup v1 layout or unreadable: the other attribution layers still apply.
  }

  const env: ProcInfo["env"] = {};
  try {
    const raw = await readFile(`/proc/${pid}/environ`, "utf8");
    for (const entry of raw.split("\0")) {
      const eq = entry.indexOf("=");
      if (eq <= 0) continue;
      const key = entry.slice(0, eq);
      if (key === ENV_SESSION_ID) env.sessionId = entry.slice(eq + 1);
      else if (key === ENV_BROWSER_SESSION) env.managedName = entry.slice(eq + 1);
    }
  } catch {
    // Not our uid, or exited. Fall through to cmdline/cgroup/ancestry.
  }

  let cwd: string | null = null;
  try {
    cwd = await readlink(`/proc/${pid}/cwd`);
  } catch {
    // Requires ptrace access to the target; optional signal.
  }

  return { pid, ppid, argv, rssBytes, pssBytes, ageSec, cgroup, env, cwd };
}

async function readUptime(): Promise<number | null> {
  try {
    const raw = await readFile("/proc/uptime", "utf8");
    const value = Number(raw.split(" ")[0]);
    return Number.isFinite(value) ? value : null;
  } catch {
    return null;
  }
}

async function scanProcs(): Promise<ProcInfo[]> {
  const uptimeSec = await readUptime();
  const entries = await readdir("/proc");
  const pids: number[] = [];
  for (const name of entries) {
    const first = name.charCodeAt(0);
    if (first < 48 || first > 57) continue;
    const pid = Number(name);
    if (Number.isFinite(pid)) pids.push(pid);
  }
  const rows = await Promise.all(pids.map((pid) => readProc(pid, uptimeSec)));
  return rows.filter((row): row is ProcInfo => row !== null);
}

/** Managed name from a worktree path, e.g. /home/dev/lfg-worktrees/lfg-3ea7ba. */
function managedNameFromPath(path: string | null | undefined): string | null {
  if (!path) return null;
  const prefix = `${WORKTREE_ROOT}/`;
  if (!path.startsWith(prefix)) return null;
  const rest = path.slice(prefix.length);
  const name = rest.split("/")[0] ?? "";
  return MANAGED_NAME_RE.test(name) ? name : null;
}

function flagValue(argv: string[], flag: string): string | null {
  // Stop at the `--` separator: everything after it is the user's prompt, and a
  // prompt containing "--session <uuid>" must not be read as a real flag.
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--") return null;
    if (argv[i] === flag) return argv[i + 1] ?? null;
    if (argv[i]?.startsWith(`${flag}=`)) return argv[i]!.slice(flag.length + 1);
  }
  return null;
}

function isBackend(argv: string[]): boolean {
  return argv.some((arg) => arg.endsWith("aisdk-session.ts"));
}

function classify(proc: ProcInfo): UsageComponent {
  const argv = proc.argv;
  if (isBackend(argv)) return "backend";

  const exeBase = baseName(argv[0] ?? "");
  // Interpreted commands (`bun x.ts`, `node y.js`, `npm exec z`) name the real
  // program in a later argument, so consider the first few argv entries.
  const bases = argv.slice(0, 3).map((arg) => baseName(arg.split("=")[0] ?? ""));

  if (bases.some((b) => HARNESS_BINARIES.has(b))) return "harness";

  if (exeBase.includes("chrome") || exeBase.includes("chromium") || exeBase === "headless_shell") {
    return "browser";
  }

  // MCP servers: matched on a path segment or a standalone `mcp` argument, so a
  // prompt mentioning MCP cannot promote an unrelated process.
  const beforeSeparator = argv.slice(0, argv.indexOf("--") === -1 ? argv.length : argv.indexOf("--"));
  if (
    beforeSeparator.some(
      (arg) => arg === "mcp" || /(^|\/)[\w.-]*mcp[\w.-]*(\/|$)/.test(arg) || arg.endsWith("-mcp"),
    )
  ) {
    return "mcp";
  }

  if (bases.some((b) => DEVSERVER_BINARIES.has(b))) return "devserver";
  // `npm exec <tool> <verb>` / `bun run dev` style invocations.
  if (beforeSeparator.some((arg) => DEVSERVER_VERBS.has(arg)) && bases.some((b) =>
    b === "npm" || b === "npx" || b === "bun" || b === "node" || b === "yarn" || b === "pnpm"
  )) {
    return "devserver";
  }

  return "other";
}

/**
 * A short, safe description of a process.
 *
 * The backend's argv holds the entire prompt (system contract + user task), and
 * other agent processes carry tokens in their flags. This panel is rendered in
 * a browser and read by an operator, so the label is truncated at the `--`
 * prompt separator, stripped of anything that looks like a secret, and capped.
 */
function labelFor(proc: ProcInfo, component: UsageComponent): string {
  const argv = proc.argv;
  if (component === "backend") return "aisdk-session backend";
  if (component === "browser") {
    const type = argv.find((arg) => arg.startsWith("--type="));
    return type ? `chrome ${type.slice("--type=".length)}` : "chrome";
  }

  const separator = argv.indexOf("--");
  const head = (separator === -1 ? argv : argv.slice(0, separator)).slice(0, 6);
  const parts: string[] = [];
  for (const arg of head) {
    if (/^-{1,2}[\w-]*(token|secret|key|password|auth|config)/i.test(arg)) continue;
    if (arg.startsWith("{") || arg.startsWith("[")) continue;
    // Shorten paths BEFORE the length check, or the very thing that names the
    // process is what gets dropped: `expo` lives at the end of a 49-character
    // node_modules path, which left the label reading "node start --web".
    const short = arg.startsWith("/") || arg.startsWith("./") ? baseName(arg) : arg;
    // Drop what is still long: tokens, base64, inline JSON.
    if (short.length > 48) continue;
    parts.push(short);
  }
  const label = parts.join(" ").trim() || baseName(argv[0] ?? "");
  return (label.length > 80 ? `${label.slice(0, 79)}…` : label) || "(unknown)";
}

type Attribution = { sessionId: string | null; managedName: string | null };

/**
 * Resolve which session a process belongs to, using the strongest key it has.
 * Returns null when the process has no relationship to any session.
 */
function directAttribution(proc: ProcInfo): Attribution | null {
  let sessionId: string | null = null;
  let managedName: string | null = null;

  if (isBackend(proc.argv)) {
    sessionId = flagValue(proc.argv, "--session");
    managedName = flagValue(proc.argv, "--managed-name");
  }

  const scope = AGENT_SCOPE_RE.exec(proc.cgroup);
  if (!managedName && scope) managedName = scope[1] ?? null;
  // `systemd-run --unit=lfg-agent-<name>` supervises the scope from outside it.
  if (!managedName) {
    const unit = proc.argv.find((arg) => arg.startsWith("--unit=lfg-agent-"));
    if (unit) managedName = unit.slice("--unit=lfg-agent-".length).replace(/\.service$/, "");
  }

  if (!sessionId && proc.env.sessionId) sessionId = proc.env.sessionId;
  if (!managedName && proc.env.managedName) managedName = proc.env.managedName;
  // Working directory inside a worktree — the same primitive worktreesInUse()
  // uses to decide a worktree is still occupied. Only the CURRENT cwd counts:
  // OLDPWD would also match a shell that merely visited the worktree once.
  if (!managedName) managedName = managedNameFromPath(proc.cwd);

  if (managedName && (!MANAGED_NAME_RE.test(managedName) || RESERVED_NAMES.has(managedName))) {
    managedName = null;
  }
  if (sessionId && !/^[0-9a-fA-F-]{8,64}$/.test(sessionId)) sessionId = null;
  if (!sessionId && !managedName) return null;
  return { sessionId, managedName };
}

// ---------------------------------------------------------------------------
// Worktree disk sizes.
//
// `du` on one worktree costs ~2.6s cold and ~0.4s warm, and there are 50+ of
// them — far too slow to run inside a request that a 3s poll drives. So sizes
// are cached, refreshed in the background at most every DISK_TTL_MS, and the
// report ships whatever it has (null on the first read). A slow disk must never
// delay or block the memory numbers, which are the urgent ones.
// ---------------------------------------------------------------------------

const DISK_TTL_MS = 10 * 60_000;
const DISK_CONCURRENCY = 2;

const diskCache = new Map<string, { bytes: number | null; at: number }>();
const diskInflight = new Set<string>();
let diskQueue: string[] = [];
let diskWorkers = 0;

async function measureWorktree(path: string): Promise<number | null> {
  try {
    // -s total, -x stay on one filesystem, --block-size=1 for real bytes on disk.
    const proc = Bun.spawn(["du", "-sx", "--block-size=1", path], {
      stdout: "pipe",
      stderr: "ignore",
    });
    const [text] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);
    const bytes = Number(text.trim().split(/\s+/)[0]);
    return Number.isFinite(bytes) ? bytes : null;
  } catch {
    return null;
  }
}

function pumpDiskQueue(): void {
  while (diskWorkers < DISK_CONCURRENCY && diskQueue.length) {
    const path = diskQueue.shift()!;
    diskWorkers++;
    void measureWorktree(path)
      .then((bytes) => {
        diskCache.set(path, { bytes, at: Date.now() });
      })
      .catch(() => {
        diskCache.set(path, { bytes: null, at: Date.now() });
      })
      .finally(() => {
        diskWorkers--;
        diskInflight.delete(path);
        pumpDiskQueue();
      });
  }
}

function worktreeDiskBytes(path: string | null): { bytes: number | null; pending: boolean } {
  if (!path) return { bytes: null, pending: false };
  const hit = diskCache.get(path);
  const stale = !hit || Date.now() - hit.at > DISK_TTL_MS;
  if (stale && !diskInflight.has(path)) {
    diskInflight.add(path);
    diskQueue.push(path);
    pumpDiskQueue();
  }
  return { bytes: hit?.bytes ?? null, pending: diskInflight.has(path) };
}

/** Test seam: drop cached sizes so a fresh measurement is taken. */
export function resetSessionUsageDiskCache(): void {
  diskCache.clear();
  diskInflight.clear();
  diskQueue = [];
}

async function readMeminfo(): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  try {
    const raw = await readFile("/proc/meminfo", "utf8");
    for (const line of raw.split("\n")) {
      const match = line.match(/^(\w+):\s+(\d+) kB$/);
      if (match) out[match[1]!] = Number(match[2]) * 1024;
    }
  } catch {
    // Non-Linux: the caller falls back to os.freemem()/totalmem().
  }
  return out;
}

async function hostSnapshot(): Promise<SessionUsageHost> {
  const info = await readMeminfo();
  const memTotalBytes = info.MemTotal ?? totalmem();
  const memAvailableBytes = info.MemAvailable ?? freemem();
  const [load1, load5, load15] = loadavg();
  return {
    memTotalBytes,
    memAvailableBytes,
    memUsedBytes: Math.max(0, memTotalBytes - memAvailableBytes),
    swapTotalBytes: info.SwapTotal ?? 0,
    swapFreeBytes: info.SwapFree ?? 0,
    cores: cpus().length,
    load1,
    load5,
    load15,
  };
}

/**
 * Walk from `proc` up through its ancestry to the nearest process with a
 * direct attribution, stopping at shared infrastructure (see NON_DONOR_
 * BINARIES). Shared by the full report and by findSessionDevServerPids below,
 * so both ever answer "whose process is this" the same way — two callers
 * quietly drifting apart here is exactly how a dev server either survives a
 * close it should not, or a bystander process gets swept up in one.
 */
function resolveViaAncestry(
  proc: ProcInfo,
  byPid: Map<number, ProcInfo>,
  direct: Map<number, Attribution>,
): Attribution | null {
  let cursor: ProcInfo | undefined = proc;
  const seen = new Set<number>();
  while (cursor && !seen.has(cursor.pid)) {
    seen.add(cursor.pid);
    // Stop AT shared infrastructure, before reading its identity: an ancestor
    // like the tmux server neither owns this process nor speaks for whatever
    // is above it (see NON_DONOR_BINARIES).
    if (cursor !== proc && NON_DONOR_BINARIES.has(baseName(cursor.argv[0] ?? ""))) break;
    const hit = direct.get(cursor.pid);
    if (hit) return hit;
    cursor = cursor.ppid > 1 ? byPid.get(cursor.ppid) : undefined;
  }
  return null;
}

/**
 * Devserver-classified processes attributed to one managed session, by the
 * exact same env/cgroup/cwd inheritance chain the Storage panel uses (see the
 * module doc above) — never a second rule for "whose process is this".
 *
 * Read-only, like the rest of this module: this only answers "which pids",
 * it does not signal them. The caller (session close teardown, src/commands/
 * serve.ts) decides whether and how to stop them.
 *
 * Why this exists: closing a session stops its agent, tmux pane, and browser,
 * but a dev server the agent started inside its worktree (`expo start`, `vite
 * dev`, ...) is none of those three — nothing else was reaping it, so it
 * accumulated for days (the Storage panel's "N closed sessions" line). The
 * attribution here is the same one already proven for that panel's "orphan"
 * detection: LFG_SESSION_ID / AGENT_BROWSER_SESSION inheritance is the
 * primary key precisely because it is set by lfg itself on every descendant
 * of a session's harness, and a process the user started by hand (or a
 * server already running on a shared port) never carries it. The weaker cwd
 * fallback (directAttribution's last resort) still requires the process's
 * CURRENT cwd to sit inside this exact managed name's worktree, so a
 * hand-started server in the same directory is the one case this can still
 * mis-attribute — accepted here for the same reason the panel accepts it:
 * every stronger signal takes priority over it.
 */
export async function findSessionDevServerPids(
  managedName: string,
): Promise<{ pid: number; label: string }[]> {
  const procs = await scanProcs();
  const byPid = new Map<number, ProcInfo>();
  for (const proc of procs) byPid.set(proc.pid, proc);

  const direct = new Map<number, Attribution>();
  for (const proc of procs) {
    if (NON_DONOR_BINARIES.has(baseName(proc.argv[0] ?? ""))) continue;
    const attribution = directAttribution(proc);
    if (attribution) direct.set(proc.pid, attribution);
  }

  const hits: { pid: number; label: string }[] = [];
  for (const proc of procs) {
    const component = classify(proc);
    if (component !== "devserver") continue;
    const attribution = resolveViaAncestry(proc, byPid, direct);
    if (attribution?.managedName === managedName) {
      hits.push({ pid: proc.pid, label: labelFor(proc, component) });
    }
  }
  return hits;
}

/**
 * Build the per-session memory/disk breakdown.
 *
 * `sessions` is the live managed-session list (from listSessionsCached). Groups
 * that match none of them are reported with `orphan: true` — that is the
 * recoverable waste, and the whole point of the view.
 */
export async function buildSessionUsageReport(
  sessions: UsageSessionInput[],
): Promise<SessionUsageReport> {
  const startedAt = Date.now();
  const [procs, host] = await Promise.all([scanProcs(), hostSnapshot()]);

  const byPid = new Map<number, ProcInfo>();
  for (const proc of procs) byPid.set(proc.pid, proc);

  // Live sessions index. A session is reachable by either key, and by its
  // harness pid — the strongest signal there is, and the one that identifies an
  // unmanaged session (a plain tmux `claude`) that carries no LFG env at all.
  const liveBySessionId = new Map<string, UsageSessionInput>();
  const liveByManagedName = new Map<string, UsageSessionInput>();
  const liveByPid = new Map<number, UsageSessionInput>();
  for (const session of sessions) {
    if (session.sessionId) liveBySessionId.set(session.sessionId, session);
    const managedName = session.tmuxName ?? managedNameFromPath(session.cwd);
    if (managedName) liveByManagedName.set(managedName, session);
    if (session.pid) liveByPid.set(session.pid, session);
  }

  // Pass 1: direct keys. Pass 2: inherit from the nearest labelled ancestor, so
  // a child that scrubbed its environment still lands on its owner.
  const direct = new Map<number, Attribution>();
  for (const proc of procs) {
    const live = liveByPid.get(proc.pid);
    if (live) {
      const managedName = live.tmuxName ?? managedNameFromPath(live.cwd);
      if (live.sessionId || managedName) {
        direct.set(proc.pid, { sessionId: live.sessionId, managedName });
        continue;
      }
    }
    // Shared infrastructure is never attributed from its own environment: the
    // tmux server's env belongs to whichever session first started it, which is
    // stale by definition. Only an explicit pid match (above) can claim these.
    if (NON_DONOR_BINARIES.has(baseName(proc.argv[0] ?? ""))) continue;
    const attribution = directAttribution(proc);
    if (attribution) direct.set(proc.pid, attribution);
  }

  const resolved = new Map<number, Attribution>();
  for (const proc of procs) {
    const hit = resolveViaAncestry(proc, byPid, direct);
    if (hit) resolved.set(proc.pid, hit);
  }

  // Session id and managed name are two names for one session, but a given
  // process may only carry one of them. Reconcile them first, so a group keyed
  // by name cannot end up as a second row beside the same session keyed by id.
  const nameToId = new Map<string, string>();
  const idToName = new Map<string, string>();
  const learn = (sessionId: string | null, managedName: string | null): void => {
    if (!sessionId || !managedName) return;
    if (!nameToId.has(managedName)) nameToId.set(managedName, sessionId);
    if (!idToName.has(sessionId)) idToName.set(sessionId, managedName);
  };
  for (const session of sessions) {
    learn(session.sessionId, session.tmuxName ?? managedNameFromPath(session.cwd));
  }
  for (const attribution of direct.values()) learn(attribution.sessionId, attribution.managedName);

  const reconcile = (attribution: Attribution): Attribution => ({
    sessionId: attribution.sessionId ?? (attribution.managedName ? nameToId.get(attribution.managedName) ?? null : null),
    managedName: attribution.managedName ?? (attribution.sessionId ? idToName.get(attribution.sessionId) ?? null : null),
  });

  type Group = {
    sessionId: string | null;
    managedName: string | null;
    live: UsageSessionInput | null;
    procs: Array<{ proc: ProcInfo; component: UsageComponent }>;
  };
  const groups = new Map<string, Group>();

  for (const proc of procs) {
    const raw = resolved.get(proc.pid);
    if (!raw) continue;
    const attribution = reconcile(raw);
    const live =
      (attribution.sessionId ? liveBySessionId.get(attribution.sessionId) : undefined) ??
      (attribution.managedName ? liveByManagedName.get(attribution.managedName) : undefined) ??
      null;
    // Prefer the live session's identity so groups keyed differently converge.
    const sessionId = live?.sessionId ?? attribution.sessionId;
    const managedName =
      live?.tmuxName ?? managedNameFromPath(live?.cwd) ?? attribution.managedName;
    // Key on the managed name first: it maps 1:1 to the worktree and the
    // systemd unit, whereas a session can hold several ids over its life (a
    // resume mints a new one, and a relaunching row briefly coexists with the
    // old one). Keying on the id split those into two rows that each claimed
    // the SAME worktree, double-counting its disk.
    const key = managedName ?? sessionId ?? `pid:${proc.pid}`;
    let group = groups.get(key);
    if (!group) {
      group = { sessionId, managedName, live, procs: [] };
      groups.set(key, group);
    }
    if (!group.managedName && managedName) group.managedName = managedName;
    if (!group.sessionId && sessionId) group.sessionId = sessionId;
    group.procs.push({ proc, component: classify(proc) });
  }

  // A live session with no surviving processes still deserves a row: "0 MB" is
  // a real answer, and a vanishing row would read as a rendering bug.
  for (const session of sessions) {
    const managedName = session.tmuxName ?? managedNameFromPath(session.cwd);
    const key = managedName ?? session.sessionId;
    if (!key || groups.has(key)) continue;
    groups.set(key, { sessionId: session.sessionId, managedName, live: session, procs: [] });
  }

  let diskPending = false;
  const rows: SessionUsageRow[] = [];

  for (const [key, group] of groups) {
    const byComponent: Record<UsageComponent, number> = {
      harness: 0,
      backend: 0,
      mcp: 0,
      devserver: 0,
      browser: 0,
      other: 0,
    };
    let rssBytes = 0;
    let pssTotal = 0;
    let pssComplete = group.procs.length > 0;
    const procRows: UsageProc[] = [];

    for (const { proc, component } of group.procs) {
      rssBytes += proc.rssBytes;
      if (proc.pssBytes == null) pssComplete = false;
      else pssTotal += proc.pssBytes;
      // Split by the same basis as the total, so the parts always sum to it.
      byComponent[component] += proc.pssBytes ?? proc.rssBytes;
      procRows.push({
        pid: proc.pid,
        component,
        label: labelFor(proc, component),
        rssBytes: proc.rssBytes,
        pssBytes: proc.pssBytes,
        ageSec: proc.ageSec,
      });
    }

    if (!pssComplete) {
      // Mixed basis would make the component split inconsistent with the total,
      // so fall back to RSS wholesale and say so.
      for (const row of procRows) byComponent[row.component] = 0;
      for (const row of procRows) byComponent[row.component] += row.rssBytes;
    }

    procRows.sort((a, b) => (b.pssBytes ?? b.rssBytes) - (a.pssBytes ?? a.rssBytes));

    // Only claim a worktree that actually exists. A group can be keyed by an
    // agent-browser session name that never had one (a transient e2e run), and
    // measuring a non-existent path would spend a `du` to learn nothing.
    const candidate = group.managedName ? `${WORKTREE_ROOT}/${group.managedName}` : null;
    const worktreePath = candidate && existsSync(candidate) ? candidate : null;
    const disk = worktreeDiskBytes(worktreePath);
    if (disk.pending) diskPending = true;

    rows.push({
      key,
      sessionId: group.sessionId,
      managedName: group.managedName,
      title: group.live?.title ?? null,
      agent: group.live?.agent ?? null,
      live: group.live != null,
      orphan: group.live == null && group.procs.length > 0,
      procCount: group.procs.length,
      memBytes: pssComplete ? pssTotal : rssBytes,
      memBasis: pssComplete ? "pss" : "rss",
      rssBytes,
      pssBytes: pssComplete ? pssTotal : null,
      byComponent,
      procs: procRows,
      worktreePath,
      diskBytes: disk.bytes,
    });
  }

  rows.sort((a, b) => b.memBytes - a.memBytes);

  const attributedBytes = rows.reduce((sum, row) => sum + row.memBytes, 0);
  const scannedBytes = procs.reduce((sum, proc) => sum + (proc.pssBytes ?? proc.rssBytes), 0);

  return {
    sampledAt: startedAt,
    scanMs: Date.now() - startedAt,
    host,
    sessions: rows,
    orphanBytes: rows.filter((row) => row.orphan).reduce((sum, row) => sum + row.memBytes, 0),
    attributedBytes,
    unattributedBytes: Math.max(0, scannedBytes - attributedBytes),
    diskPending,
  };
}
