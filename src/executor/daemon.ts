// The Executor connector daemon this box runs, owned by `omg serve`.
//
// Executor (https://executor.sh) is the one connector gateway per box: every
// third-party integration is configured there once, and agents reach all of
// them through the omg-served `/mcp/executor` endpoint (see ./proxy.ts). The
// daemon is a separate binary with its own SQLite store, so the serve process
// only has to start it, find it again after a restart, and know its port and
// bearer token.
//
// Same lifecycle shape as src/computer/desktop.ts: the pid and port go on
// disk, a restarted serve ADOPTS a daemon that is still healthy instead of
// killing a process that agents may be mid-call against, and a dead one is
// reaped before a new start. The daemon therefore survives serve restarts and
// is stopped only by an explicit stop or by the setting being turned off.
import { spawn, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { join } from "node:path";
import { PATHS, setExecutorMcpAdvertised } from "../config.ts";

export const DEFAULT_EXECUTOR_PORT = 4788;
export const EXECUTOR_INSTALL_COMMAND = "npm install -g executor";

// How long a fresh daemon gets to answer /api/health before the start is
// reported as failed. The binary is ~130 MB and opens a SQLite store, so cold
// start on a loaded box is seconds, not milliseconds.
const BOOT_TIMEOUT_MS = 30_000;
const BOOT_POLL_MS = 250;
// Unsupervised restarts after an unexpected exit. Bounded so a binary that
// crashes on boot does not spin forever; the status carries the last error.
const RESTART_DELAY_MS = 5_000;
const RESTART_LIMIT = 5;

export function executorDataDir(): string {
  return join(PATHS.data, "executor");
}

// Where the running daemon is recorded, so a restarted server can find it.
function stateFile(): string {
  return join(executorDataDir(), "omg-daemon.json");
}

// The bearer token omg mints for the daemon. Kept in its own file so it is
// stable across daemon restarts: the token is what an adopted daemon still
// expects, and minting a new one per start would orphan a healthy process.
function tokenFile(): string {
  return join(executorDataDir(), "omg-token");
}

interface PersistedDaemon {
  pid: number;
  port: number;
  token: string;
  startedAt: number;
}

interface DaemonState {
  pid: number;
  port: number;
  token: string;
  startedAt: number;
  // Present only for a daemon this process spawned. An adopted daemon has a
  // pid and no handle, and is signalled by pid.
  child?: ChildProcess;
}

export interface ExecutorStatus {
  installed: boolean;
  binary: string | null;
  installCommand: string;
  running: boolean;
  origin: string | null;
  pid: number | null;
  startedAt: number | null;
  error: string | null;
}

// Module-level singleton: one box, one daemon.
let state: DaemonState | null = null;
let lastError: string | null = null;
let stopping = false;
let restarts = 0;
let restartTimer: ReturnType<typeof setTimeout> | null = null;
let starting: Promise<ExecutorStatus> | null = null;

function which(bin: string): string | null {
  for (const dir of (process.env.PATH ?? "").split(":")) {
    if (!dir) continue;
    const candidate = `${dir}/${bin}`;
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

/** The `executor` binary, or null when it is not installed. */
export function executorBinary(): string | null {
  const override = process.env.OMG_EXECUTOR_BIN?.trim();
  if (override) return existsSync(override) ? override : null;
  return which("executor");
}

/** The bearer token for this box's daemon, minted on first use. */
export function executorToken(): string {
  const path = tokenFile();
  try {
    const existing = readFileSync(path, "utf8").trim();
    if (existing) return existing;
  } catch {}
  const token = randomBytes(32).toString("base64url");
  mkdirSync(executorDataDir(), { recursive: true });
  writeFileSync(path, token);
  try {
    chmodSync(path, 0o600);
  } catch {}
  return token;
}

function writeStateFile(next: DaemonState): void {
  try {
    mkdirSync(executorDataDir(), { recursive: true });
    const record: PersistedDaemon = {
      pid: next.pid,
      port: next.port,
      token: next.token,
      startedAt: next.startedAt,
    };
    writeFileSync(stateFile(), JSON.stringify(record));
    try {
      chmodSync(stateFile(), 0o600);
    } catch {}
  } catch {
    // Losing the record only costs adoption on the next boot.
  }
}

function clearStateFile(): void {
  try {
    rmSync(stateFile(), { force: true });
  } catch {}
}

function readStateFile(): PersistedDaemon | null {
  try {
    if (!existsSync(stateFile())) return null;
    const parsed = JSON.parse(readFileSync(stateFile(), "utf8")) as Partial<PersistedDaemon>;
    if (
      typeof parsed.pid !== "number" ||
      typeof parsed.port !== "number" ||
      typeof parsed.token !== "string"
    ) {
      return null;
    }
    return {
      pid: parsed.pid,
      port: parsed.port,
      token: parsed.token,
      startedAt: typeof parsed.startedAt === "number" ? parsed.startedAt : Date.now(),
    };
  } catch {
    return null;
  }
}

function alive(pid: number | undefined): boolean {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function killPid(pid: number | undefined, signal: NodeJS.Signals = "SIGTERM"): void {
  if (!pid) return;
  try {
    process.kill(pid, signal);
  } catch {}
}

export function executorOriginFor(port: number): string {
  return `http://127.0.0.1:${port}`;
}

/** True when the daemon on `port` answers its health probe. */
export async function executorHealthy(port: number, timeoutMs = 1_000): Promise<boolean> {
  try {
    const res = await fetch(`${executorOriginFor(port)}/api/health`, {
      signal: AbortSignal.timeout(timeoutMs),
    });
    return res.ok;
  } catch {
    return false;
  }
}

async function waitForHealthy(port: number, timeoutMs: number, stillRunning: () => boolean): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!stillRunning()) return false;
    if (await executorHealthy(port, 800)) return true;
    await Bun.sleep(BOOT_POLL_MS);
  }
  return false;
}

function portFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const probe = createServer();
    probe.once("error", () => resolve(false));
    probe.listen(port, "127.0.0.1", () => {
      probe.close(() => resolve(true));
    });
  });
}

// The preferred port, or the next free one above it. Executor's own default
// is 4788; a user who also runs Executor by hand keeps it, and we move.
async function pickPort(preferred: number): Promise<number> {
  for (let port = preferred; port < preferred + 20; port += 1) {
    if (await portFree(port)) return port;
  }
  throw new Error(`no free port between ${preferred} and ${preferred + 19}`);
}

function setState(next: DaemonState | null): void {
  state = next;
  setExecutorMcpAdvertised(next !== null);
}

/**
 * Reattach to a daemon this box left running, or clean up its remains.
 *
 * Returns true when a healthy daemon was adopted. Idempotent: a live in-memory
 * state short-circuits, so this is safe to call from every status request.
 */
export async function ensureExecutorAdopted(): Promise<boolean> {
  if (state) return true;
  const record = readStateFile();
  if (!record) return false;
  const healthy = alive(record.pid) && (await executorHealthy(record.port, 1_500));
  if (!healthy) {
    killPid(record.pid);
    await Bun.sleep(300);
    killPid(record.pid, "SIGKILL");
    clearStateFile();
    return false;
  }
  setState({ pid: record.pid, port: record.port, token: record.token, startedAt: record.startedAt });
  return true;
}

/** The daemon's origin and bearer, or null when it is not running. */
export function executorAuth(): { origin: string; token: string } | null {
  if (!state) return null;
  return { origin: executorOriginFor(state.port), token: state.token };
}

/** The URL that opens the Executor dashboard already signed in. */
export function executorDashboardUrl(): string | null {
  const auth = executorAuth();
  if (!auth) return null;
  return `${auth.origin}/?_token=${encodeURIComponent(auth.token)}`;
}

export function executorStatus(): ExecutorStatus {
  const binary = executorBinary();
  return {
    installed: binary !== null,
    binary,
    installCommand: EXECUTOR_INSTALL_COMMAND,
    running: state !== null,
    origin: state ? executorOriginFor(state.port) : null,
    pid: state?.pid ?? null,
    startedAt: state?.startedAt ?? null,
    error: lastError,
  };
}

function scheduleRestart(log: (line: string) => void): void {
  if (stopping) return;
  if (restarts >= RESTART_LIMIT) {
    lastError = `executor exited ${RESTART_LIMIT} times; not restarting. Check the binary with: executor daemon run --foreground`;
    log(`[executor] ${lastError}`);
    return;
  }
  restarts += 1;
  restartTimer = setTimeout(() => {
    restartTimer = null;
    void startExecutor({ log }).catch(() => {});
  }, RESTART_DELAY_MS);
}

/**
 * Start the daemon, or adopt one that is already running.
 *
 * Concurrent callers share one start: the settings toggle, the boot hook and a
 * status poll can all race here, and two spawns would fight over the port.
 */
export function startExecutor(opts: { port?: number; log?: (line: string) => void } = {}): Promise<ExecutorStatus> {
  if (starting) return starting;
  starting = startExecutorOnce(opts).finally(() => {
    starting = null;
  });
  return starting;
}

async function startExecutorOnce(opts: { port?: number; log?: (line: string) => void }): Promise<ExecutorStatus> {
  const log = opts.log ?? ((line: string) => console.log(line));
  stopping = false;
  if (restartTimer) {
    clearTimeout(restartTimer);
    restartTimer = null;
  }
  if (await ensureExecutorAdopted()) {
    lastError = null;
    return executorStatus();
  }
  const binary = executorBinary();
  if (!binary) {
    lastError = `executor is not installed. Install it with: ${EXECUTOR_INSTALL_COMMAND}`;
    return executorStatus();
  }

  let port: number;
  try {
    port = await pickPort(opts.port ?? DEFAULT_EXECUTOR_PORT);
  } catch (e) {
    lastError = e instanceof Error ? e.message : String(e);
    return executorStatus();
  }
  const token = executorToken();
  const dataDir = executorDataDir();
  mkdirSync(dataDir, { recursive: true });

  const child = spawn(
    binary,
    [
      "daemon", "run", "--foreground",
      "--hostname", "127.0.0.1",
      "--port", String(port),
      "--auth-token", token,
    ],
    {
      env: {
        ...process.env,
        EXECUTOR_DATA_DIR: dataDir,
        EXECUTOR_DISABLE_ANALYTICS: "1",
        EXECUTOR_DISABLE_UPDATE_CHECK: "1",
      },
      stdio: ["ignore", "pipe", "pipe"],
      detached: false,
    },
  );
  let exited = false;
  let exitNote = "";
  const relay = (chunk: Buffer) => {
    for (const line of chunk.toString().split("\n")) {
      if (line.trim()) log(`[executor] ${line}`);
    }
  };
  child.stdout?.on("data", relay);
  child.stderr?.on("data", relay);
  child.once("error", (e) => {
    exited = true;
    exitNote = e.message;
  });
  child.once("exit", (code, signal) => {
    exited = true;
    exitNote = signal ? `signal ${signal}` : `exit code ${code}`;
    if (state?.child === child) {
      setState(null);
      clearStateFile();
      if (!stopping) {
        lastError = `executor stopped unexpectedly (${exitNote})`;
        log(`[executor] ${lastError}`);
        scheduleRestart(log);
      }
    }
  });

  const pid = child.pid;
  if (!pid) {
    lastError = `failed to spawn executor: ${exitNote || "no pid"}`;
    return executorStatus();
  }
  const next: DaemonState = { pid, port, token, startedAt: Date.now(), child };
  // Record and advertise only after the daemon answers, so an agent launched
  // during boot is not handed an endpoint that 503s.
  const ready = await waitForHealthy(port, BOOT_TIMEOUT_MS, () => !exited);
  if (!ready) {
    killPid(pid);
    await Bun.sleep(300);
    killPid(pid, "SIGKILL");
    lastError = exited
      ? `executor exited during start (${exitNote})`
      : `executor did not answer on port ${port} within ${BOOT_TIMEOUT_MS / 1000}s`;
    return executorStatus();
  }
  setState(next);
  writeStateFile(next);
  lastError = null;
  restarts = 0;
  log(`[executor] ready on ${executorOriginFor(port)} (pid ${pid})`);
  return executorStatus();
}

/** Stop the daemon. Safe to call when nothing is running. */
export async function stopExecutor(): Promise<ExecutorStatus> {
  stopping = true;
  if (restartTimer) {
    clearTimeout(restartTimer);
    restartTimer = null;
  }
  const current = state ?? (() => {
    const record = readStateFile();
    return record ? { ...record } : null;
  })();
  setState(null);
  clearStateFile();
  if (current) {
    killPid(current.pid);
    const deadline = Date.now() + 3_000;
    while (alive(current.pid) && Date.now() < deadline) await Bun.sleep(100);
    if (alive(current.pid)) killPid(current.pid, "SIGKILL");
  }
  lastError = null;
  restarts = 0;
  return executorStatus();
}

/** Test seam: forget in-memory state without touching any process. */
export function resetExecutorStateForTests(): void {
  if (restartTimer) {
    clearTimeout(restartTimer);
    restartTimer = null;
  }
  setState(null);
  lastError = null;
  stopping = false;
  restarts = 0;
  starting = null;
}
