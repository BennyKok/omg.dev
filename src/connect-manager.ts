import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PATHS } from "./config.ts";

export const CONNECT_AUTH_REJECTED_EXIT_CODE = 78;

type ManagedConnectChild = {
  pid: number;
  exited: Promise<number>;
  kill(signal?: number | NodeJS.Signals): void;
  stdin: { end(): void } | null;
};

type ConnectManagerDeps = {
  credentialRevision(): string | null;
  spawn(): ManagedConnectChild;
  setInterval(callback: () => void, delayMs: number): ReturnType<typeof setInterval>;
  clearInterval(timer: ReturnType<typeof setInterval>): void;
  log(message: string): void;
};

export type ConnectManagerStatus = {
  state: "unpaired" | "running" | "auth-rejected" | "idle";
  pid: number | null;
};

const CREDENTIALS_PATH = join(PATHS.data, "relay-credentials.json");

function credentialRevision(): string | null {
  try {
    // The full file is the revision. A fresh pairing can produce a token with
    // the same length inside one filesystem timestamp tick, so mtime + size is
    // not sufficient to decide whether an auth rejection should be retried.
    return readFileSync(CREDENTIALS_PATH, "utf8");
  } catch {
    return null;
  }
}

function spawnManagedConnect(): ManagedConnectChild {
  const child = Bun.spawn({
    cmd: [process.execPath, "run", join(PATHS.root, "src", "cli.ts"), "connect", "--foreground"],
    cwd: PATHS.root,
    env: { ...process.env, OMG_CONNECT_MANAGED: "1" },
    stdin: "pipe",
    stdout: "inherit",
    stderr: "inherit",
  });
  return child as unknown as ManagedConnectChild;
}

const defaultDeps: ConnectManagerDeps = {
  credentialRevision,
  spawn: spawnManagedConnect,
  setInterval,
  clearInterval,
  log: (message) => console.log(message),
};

/**
 * Owns the relay worker for the lifetime of `omg serve`.
 *
 * The credential file is the single desired-state owner: present means run;
 * absent means stop. A content change restarts the worker so `omg connect
 * --new` takes effect without restarting the whole control plane.
 */
export class ConnectManager {
  private child: ManagedConnectChild | null = null;
  private runningRevision: string | null = null;
  private rejectedRevision: string | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private stopped = false;

  constructor(private readonly deps: ConnectManagerDeps = defaultDeps) {}

  start(): void {
    if (this.timer) return;
    this.stopped = false;
    void this.reconcile();
    this.timer = this.deps.setInterval(() => void this.reconcile(), 1_000);
    this.timer.unref?.();
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) {
      this.deps.clearInterval(this.timer);
      this.timer = null;
    }
    this.stopChild();
  }

  status(): ConnectManagerStatus {
    if (this.child) return { state: "running", pid: this.child.pid };
    const revision = this.deps.credentialRevision();
    if (!revision) return { state: "unpaired", pid: null };
    if (revision === this.rejectedRevision) return { state: "auth-rejected", pid: null };
    return { state: "idle", pid: null };
  }

  async reconcile(): Promise<ConnectManagerStatus> {
    if (this.stopped) return this.status();

    const revision = this.deps.credentialRevision();
    if (this.child && revision !== this.runningRevision) this.stopChild();
    if (!revision) {
      this.rejectedRevision = null;
      return { state: "unpaired", pid: null };
    }
    if (this.child) return { state: "running", pid: this.child.pid };
    if (revision === this.rejectedRevision) return { state: "auth-rejected", pid: null };

    const child = this.deps.spawn();
    this.child = child;
    this.runningRevision = revision;
    this.deps.log(`[connect] background relay worker started (pid ${child.pid})`);
    void child.exited.then((exitCode) => {
      if (this.child !== child) return;
      this.child = null;
      this.runningRevision = null;
      if (exitCode === CONNECT_AUTH_REJECTED_EXIT_CODE) {
        this.rejectedRevision = revision;
        this.deps.log("[connect] relay rejected the saved binding; run `omg connect <code>` to pair again");
        return;
      }
      if (!this.stopped) {
        this.deps.log(`[connect] background relay worker exited (${exitCode}); restarting`);
      }
    });
    return { state: "running", pid: child.pid };
  }

  private stopChild(): void {
    const child = this.child;
    this.child = null;
    this.runningRevision = null;
    if (!child) return;
    try {
      child.stdin?.end();
    } catch {}
    try {
      child.kill("SIGTERM");
    } catch {}
  }
}

export function createConnectManager(): ConnectManager {
  return new ConnectManager();
}
