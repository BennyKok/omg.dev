import { randomUUID } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { delimiter, dirname, join, resolve } from "node:path";

const DEFAULT_RUNTIME_ORIGIN = "http://127.0.0.1:8766";
const READY_PATH = "/api/install?ready=1";

export type DesktopEnvironment = Record<string, string | undefined>;

export type RuntimeFetch = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

export type RuntimeWaitOptions = {
  fetch?: RuntimeFetch;
  intervalMs?: number;
  signal?: AbortSignal;
  timeoutMs?: number;
};

export type OwnedRuntimeProcess = {
  exited: Promise<number>;
  kill(signal?: number | NodeJS.Signals): void;
  pid: number;
};

export type RuntimeConnection = {
  origin: string;
  owner: "desktop";
  process?: OwnedRuntimeProcess;
};

export type RuntimeReadyInfo = {
  bootId: string;
  desktopRuntimeFingerprint: string | null;
  desktopRuntimeId: string | null;
};

export type DesktopRuntimeRecord = {
  fingerprint: string;
  origin: string;
  pid: number;
  runtimeId: string;
};

export type EnsureRuntimeOptions = {
  choosePort?: (preferredPort: number) => Promise<number>;
  fingerprint?: string;
  inspect?: (origin: string) => Promise<RuntimeReadyInfo | null>;
  launch?: (port: number) => OwnedRuntimeProcess | Promise<OwnedRuntimeProcess>;
  origin?: string;
  readyWaitMs?: number;
  runtimeId?: string;
  stateRoot?: string;
  stop?: (pid: number) => Promise<void>;
  wait?: (origin: string, options: RuntimeWaitOptions) => Promise<boolean>;
};

function isLoopbackHostname(hostname: string): boolean {
  return hostname === "127.0.0.1" || hostname === "localhost" || hostname === "[::1]";
}

/**
 * Resolve the preferred loopback origin for the desktop-owned runtime.
 *
 * Only its port is reused. The desktop shell always owns its runtime process.
 * The local control plane has no application-layer authentication, so loopback
 * remains a security boundary and not only a default.
 */
export function runtimeOrigin(env: DesktopEnvironment = process.env): string {
  const configured = env.OMG_DESKTOP_URL?.trim();
  const port = env.OMG_PORT?.trim() || env.LFG_PORT?.trim() || "8766";
  const url = new URL(configured || `http://127.0.0.1:${port}`);

  if (url.protocol !== "http:" || !isLoopbackHostname(url.hostname)) {
    throw new Error("OMG_DESKTOP_URL must be an HTTP loopback URL.");
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new Error("OMG_DESKTOP_URL must contain only an origin and optional path.");
  }

  url.pathname = url.pathname.replace(/\/+$/, "") || "/";
  return url.href.replace(/\/$/, "");
}

export async function runtimeReadyInfo(
  origin: string,
  fetcher: RuntimeFetch = fetch,
): Promise<RuntimeReadyInfo | null> {
  try {
    const response = await fetcher(new URL(READY_PATH, `${origin}/`), {
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(1_500),
    });
    if (!response.ok) return null;
    const body = (await response.json()) as {
      bootId?: unknown;
      desktopRuntimeFingerprint?: unknown;
      desktopRuntimeId?: unknown;
    };
    if (typeof body.bootId !== "string" || !body.bootId) return null;
    return {
      bootId: body.bootId,
      desktopRuntimeFingerprint:
        typeof body.desktopRuntimeFingerprint === "string" &&
        body.desktopRuntimeFingerprint
          ? body.desktopRuntimeFingerprint
          : null,
      desktopRuntimeId:
        typeof body.desktopRuntimeId === "string" && body.desktopRuntimeId
          ? body.desktopRuntimeId
          : null,
    };
  } catch {
    return null;
  }
}

export async function runtimeIsReady(
  origin: string,
  fetcher: RuntimeFetch = fetch,
): Promise<boolean> {
  return (await runtimeReadyInfo(origin, fetcher)) != null;
}

export async function waitForRuntime(
  origin: string,
  options: RuntimeWaitOptions = {},
): Promise<boolean> {
  const fetcher = options.fetch ?? fetch;
  const intervalMs = options.intervalMs ?? 1_500;
  const deadline =
    options.timeoutMs == null ? Number.POSITIVE_INFINITY : Date.now() + options.timeoutMs;

  while (!options.signal?.aborted) {
    if (await runtimeIsReady(origin, fetcher)) return true;
    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) return false;
    await Bun.sleep(Math.min(intervalMs, remainingMs));
  }
  return false;
}

export function embeddedRuntimeCandidates(entryDir: string = import.meta.dir): string[] {
  return [
    resolve(entryDir, "..", "embedded-runtime"),
    resolve(entryDir, "..", "..", "embedded-runtime"),
    resolve(entryDir, "..", "..", ".."),
  ];
}

export function findEmbeddedRuntimeRoot(
  candidates: string[] = embeddedRuntimeCandidates(),
): string {
  const root = candidates.find(
    (candidate) =>
      existsSync(join(candidate, "src", "cli.ts")) &&
      existsSync(join(candidate, "web", "dist", "index.html")) &&
      existsSync(join(candidate, "node_modules")),
  );
  if (!root) {
    throw new Error("The desktop package does not contain the embedded omg.dev runtime.");
  }
  return root;
}

export function embeddedRuntimeArchiveCandidates(
  entryDir: string = import.meta.dir,
): string[] {
  return [
    resolve(entryDir, "..", "embedded-runtime.tar.gz"),
    resolve(entryDir, "..", "..", "embedded-runtime.tar.gz"),
  ];
}

export function embeddedRuntimeFingerprint(
  archiveCandidates: string[] = embeddedRuntimeArchiveCandidates(),
): string {
  const archive = archiveCandidates.find((candidate) => existsSync(candidate));
  if (!archive) return "source";
  const fingerprint = readFileSync(`${archive}.sha256`, "utf8").trim();
  if (!/^[a-f0-9]{64}$/.test(fingerprint)) {
    throw new Error("The embedded runtime fingerprint is invalid.");
  }
  return fingerprint;
}

export function desktopRuntimeId(stateRoot: string = desktopRuntimeStateRoot()): string {
  const path = join(stateRoot, "runtime-id");
  try {
    const existing = readFileSync(path, "utf8").trim();
    if (/^[a-f0-9-]{20,80}$/.test(existing)) return existing;
  } catch {
    // A first launch has no identity file yet.
  }
  mkdirSync(stateRoot, { recursive: true });
  const created = randomUUID();
  writeFileSync(path, `${created}\n`, { mode: 0o600 });
  return created;
}

function runtimeRecordPath(stateRoot: string): string {
  return join(stateRoot, "runtime.json");
}

export function readDesktopRuntimeRecord(
  stateRoot: string = desktopRuntimeStateRoot(),
): DesktopRuntimeRecord | null {
  try {
    const value = JSON.parse(
      readFileSync(runtimeRecordPath(stateRoot), "utf8"),
    ) as Partial<DesktopRuntimeRecord>;
    if (
      typeof value.fingerprint !== "string" ||
      typeof value.origin !== "string" ||
      typeof value.pid !== "number" ||
      !Number.isSafeInteger(value.pid) ||
      value.pid <= 1 ||
      typeof value.runtimeId !== "string"
    ) {
      return null;
    }
    const origin = runtimeOrigin({ OMG_DESKTOP_URL: value.origin });
    return { ...value, origin } as DesktopRuntimeRecord;
  } catch {
    return null;
  }
}

export function writeDesktopRuntimeRecord(
  record: DesktopRuntimeRecord,
  stateRoot: string = desktopRuntimeStateRoot(),
): void {
  mkdirSync(stateRoot, { recursive: true });
  const path = runtimeRecordPath(stateRoot);
  const temporaryPath = `${path}.${process.pid}.tmp`;
  writeFileSync(temporaryPath, `${JSON.stringify(record)}\n`, { mode: 0o600 });
  renameSync(temporaryPath, path);
}

function removeDesktopRuntimeRecord(stateRoot: string, pid: number): void {
  const record = readDesktopRuntimeRecord(stateRoot);
  if (record?.pid === pid) rmSync(runtimeRecordPath(stateRoot), { force: true });
}

function runtimeTreeIsComplete(root: string): boolean {
  return (
    existsSync(join(root, "src", "cli.ts")) &&
    existsSync(join(root, "web", "dist", "index.html")) &&
    existsSync(join(root, "node_modules"))
  );
}

function removeOldRuntimeTrees(appsRoot: string, currentRoot: string): void {
  let entries;
  try {
    entries = readdirSync(appsRoot, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (!entry.isDirectory() || !/^[a-f0-9]{20}$/.test(entry.name)) continue;
    const candidate = join(appsRoot, entry.name);
    if (candidate === currentRoot) continue;
    rmSync(candidate, { force: true, recursive: true });
  }
}

export async function prepareEmbeddedRuntime(
  stateRoot: string = desktopRuntimeStateRoot(),
  archiveCandidates: string[] = embeddedRuntimeArchiveCandidates(),
): Promise<string> {
  const archive = archiveCandidates.find((candidate) => existsSync(candidate));
  if (!archive) return findEmbeddedRuntimeRoot();

  const fingerprintPath = `${archive}.sha256`;
  const fingerprint = readFileSync(fingerprintPath, "utf8").trim();
  if (!/^[a-f0-9]{64}$/.test(fingerprint)) {
    throw new Error("The embedded runtime fingerprint is invalid.");
  }

  const appsRoot = join(stateRoot, "apps");
  const runtimeRoot = join(appsRoot, fingerprint.slice(0, 20));
  if (runtimeTreeIsComplete(runtimeRoot)) {
    removeOldRuntimeTrees(appsRoot, runtimeRoot);
    return runtimeRoot;
  }

  mkdirSync(appsRoot, { recursive: true });
  const temporaryRoot = join(appsRoot, `.extract-${process.pid}-${Date.now()}`);
  mkdirSync(temporaryRoot, { recursive: true });
  try {
    const extraction = Bun.spawn({
      cmd: ["/usr/bin/tar", "-xzf", archive, "-C", temporaryRoot],
      stderr: "inherit",
      stdout: "inherit",
    });
    const code = await extraction.exited;
    if (code !== 0 || !runtimeTreeIsComplete(temporaryRoot)) {
      throw new Error(`The embedded runtime archive could not be extracted (exit code ${code}).`);
    }
    try {
      renameSync(temporaryRoot, runtimeRoot);
    } catch (error) {
      if (!runtimeTreeIsComplete(runtimeRoot)) throw error;
      rmSync(temporaryRoot, { force: true, recursive: true });
    }
    removeOldRuntimeTrees(appsRoot, runtimeRoot);
    return runtimeRoot;
  } catch (error) {
    rmSync(temporaryRoot, { force: true, recursive: true });
    throw error;
  }
}

export function desktopRuntimeStateRoot(
  platform: NodeJS.Platform = process.platform,
  env: DesktopEnvironment = process.env,
  home: string = homedir(),
): string {
  if (platform === "darwin") {
    return join(home, "Library", "Application Support", "dev.omg.desktop", "runtime");
  }
  const dataHome = env.XDG_DATA_HOME?.trim();
  const dataRoot =
    dataHome && dataHome.startsWith("/") ? dataHome : join(home, ".local", "share");
  return join(dataRoot, "dev.omg.desktop", "runtime");
}

export async function chooseAvailableRuntimePort(preferredPort: number): Promise<number> {
  const reserve = (port: number) =>
    Bun.serve({
      hostname: "127.0.0.1",
      port,
      fetch: () => new Response("reserved"),
    });

  try {
    const server = reserve(preferredPort);
    const port = server.port;
    server.stop(true);
    if (port == null) throw new Error("Bun did not assign the preferred runtime port.");
    return port;
  } catch {
    const server = reserve(0);
    const port = server.port;
    server.stop(true);
    if (port == null) throw new Error("Bun did not assign a fallback runtime port.");
    return port;
  }
}

export async function launchEmbeddedRuntime(
  port: number,
  runtimeRoot?: string,
  stateRoot: string = desktopRuntimeStateRoot(),
  identity: {
    fingerprint?: string;
    runtimeId?: string;
  } = {},
): Promise<OwnedRuntimeProcess> {
  const preparedRuntimeRoot = runtimeRoot ?? (await prepareEmbeddedRuntime(stateRoot));
  mkdirSync(join(stateRoot, "data"), { recursive: true });
  const executableDir = dirname(process.execPath);
  const commonPaths = [
    join(homedir(), ".local", "bin"),
    join(homedir(), ".bun", "bin"),
    "/opt/homebrew/bin",
    "/usr/local/bin",
    "/usr/bin",
    "/bin",
    executableDir,
  ];
  const inheritedPaths = (process.env.PATH ?? "").split(delimiter).filter(Boolean);
  const path = [...new Set([...commonPaths, ...inheritedPaths])].join(delimiter);
  const env: DesktopEnvironment = {
    ...process.env,
    PATH: path,
    OMG_DATA_DIR: join(stateRoot, "data"),
    OMG_ENV_FILE: join(stateRoot, ".env"),
    OMG_DESKTOP_RUNTIME_ID: identity.runtimeId ?? desktopRuntimeId(stateRoot),
    OMG_DESKTOP_RUNTIME_FINGERPRINT:
      identity.fingerprint ?? embeddedRuntimeFingerprint(),
    OMG_HOST: "127.0.0.1",
    OMG_PORT: String(port),
  };
  delete env.OMG_DESKTOP_PARENT_PID;
  delete env.LFG_DESKTOP_PARENT_PID;

  const child = Bun.spawn({
    cmd: [process.execPath, "run", join(preparedRuntimeRoot, "src", "cli.ts"), "serve"],
    cwd: stateRoot,
    detached: true,
    env,
    stderr: "ignore",
    stdin: "ignore",
    stdout: "ignore",
  });
  child.unref();
  return child;
}

function portFromOrigin(origin: string): number {
  const url = new URL(origin);
  if (url.port) return Number(url.port);
  return url.protocol === "http:" ? 80 : 443;
}

export async function ensureRuntime(
  options: EnsureRuntimeOptions = {},
): Promise<RuntimeConnection> {
  const stateRoot = options.stateRoot ?? desktopRuntimeStateRoot();
  const runtimeId = options.runtimeId ?? desktopRuntimeId(stateRoot);
  const fingerprint = options.fingerprint ?? embeddedRuntimeFingerprint();
  const inspect = options.inspect ?? runtimeReadyInfo;
  const record = readDesktopRuntimeRecord(stateRoot);

  if (record?.runtimeId === runtimeId) {
    const existing = await inspect(record.origin);
    if (existing?.desktopRuntimeId === runtimeId) {
      if (
        record.fingerprint === fingerprint &&
        existing.desktopRuntimeFingerprint === fingerprint
      ) {
        return { origin: record.origin, owner: "desktop" };
      }
      await (options.stop ?? stopPersistentRuntime)(record.pid);
      const deadline = Date.now() + 5_000;
      while ((await inspect(record.origin))?.desktopRuntimeId === runtimeId) {
        if (Date.now() >= deadline) {
          throw new Error("The previous embedded omg.dev runtime did not stop for an update.");
        }
        await Bun.sleep(100);
      }
    }
  }

  const preferredOrigin = options.origin ?? runtimeOrigin();
  const wait = options.wait ?? waitForRuntime;
  const choosePort = options.choosePort ?? chooseAvailableRuntimePort;
  const port = await choosePort(portFromOrigin(preferredOrigin));
  const embeddedOrigin = `http://127.0.0.1:${port}`;
  const launch =
    options.launch ??
    ((selectedPort: number) =>
      launchEmbeddedRuntime(selectedPort, undefined, stateRoot, {
        fingerprint,
        runtimeId,
      }));
  const child = await launch(port);
  writeDesktopRuntimeRecord(
    {
      fingerprint,
      origin: embeddedOrigin,
      pid: child.pid,
      runtimeId,
    },
    stateRoot,
  );

  const result = await Promise.race([
    wait(embeddedOrigin, {
      intervalMs: 250,
      timeoutMs: options.readyWaitMs ?? 60_000,
    }).then((ready) => ({ type: "ready" as const, ready })),
    child.exited.then((code) => ({ type: "exit" as const, code })),
  ]);

  if (result.type === "ready" && result.ready) {
    return { origin: embeddedOrigin, owner: "desktop", process: child };
  }

  try {
    child.kill();
  } catch {
    // The child can exit between the readiness result and cleanup.
  }
  removeDesktopRuntimeRecord(stateRoot, child.pid);
  const reason = result.type === "exit" ? `exit code ${result.code}` : "startup timeout";
  throw new Error(`The embedded omg.dev runtime failed to start (${reason}).`);
}

async function stopPersistentRuntime(pid: number): Promise<void> {
  try {
    process.kill(pid, "SIGTERM");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
  }
}

export const DEFAULT_DESKTOP_RUNTIME_ORIGIN = DEFAULT_RUNTIME_ORIGIN;
