// The receiver lifecycle used by both omg serve's local UI and omg device run.
// No grant survives a restart. The installed device config remains authoritative.
import { closeSync, existsSync, openSync, readSync, fstatSync } from "node:fs";
import { actionInfos, audit, call, deviceHome, deviceLogPath, Grant, GRANT_MAX_MINUTES, handleRequest, loadConfig, UnlinkedError, type ApprovalPrompt, type Ask, type DeviceConfig } from "./agent.ts";
import { deviceIsLocked, lockDevice } from "./lock.ts";
import { FINAL_STATUSES, LINK_PREFIX, type WireRequest, type WireRequestState, type WireUpdate } from "./protocol.ts";

export type LocalActivity = { at: number; kind: string; request?: WireRequest; update?: WireUpdate; reason?: string };
type Pending = ApprovalPrompt & { token: string };

/** Bounded tail: opening Settings never reads an unbounded command log. */
export function readLocalActivity(): LocalActivity[] {
  if (!existsSync(deviceLogPath())) return [];
  const fd = openSync(deviceLogPath(), "r");
  try {
    const size = fstatSync(fd).size;
    const start = Math.max(0, size - 256 * 1024);
    const buf = Buffer.alloc(size - start);
    readSync(fd, buf, 0, buf.length, start);
    const lines = buf.toString("utf8").split("\n");
    if (start) lines.shift();
    return lines.flatMap((line) => {
      try {
        const row = JSON.parse(line);
        if (!row || typeof row !== "object") return [];
        return [{
          at: typeof row.at === "number" ? row.at : Date.parse(row.at),
          kind: row.kind ?? row.status ?? row.decision ?? "request",
          request: typeof row.request === "object" ? row.request : row.action ? { id: row.request, action: row.action, args: {} } : undefined,
          update: row.update, reason: row.reason,
        } as LocalActivity];
      } catch { return []; }
    }).slice(-50).reverse();
  } finally { closeSync(fd); }
}

export class DeviceRuntime {
  private grant: Grant | null = null;
  private abort: AbortController | null = null;
  private pending: Pending | null = null;
  private answer: ((value: string | null) => void) | null = null;
  private error: string | null = null;
  private mutating = false;
  private activeConfig: DeviceConfig | null = null;
  private release: (() => void) | null = null;
  private requests: WireRequestState[] = [];
  private queueError: string | null = null;
  private listeners = new Set<() => void>();
  private watchTimer: ReturnType<typeof setInterval> | null = null;
  private watchRequest: AbortController | null = null;
  private revision = 0;
  finished: Promise<void> = Promise.resolve();

  snapshot() {
    const c = this.activeConfig ?? loadConfig();
    return {
      deviceId: c.deviceId ?? null, server: c.server ?? null,
      actions: actionInfos(c), active: this.grant !== null,
      otherProcess: !this.grant && !this.mutating && deviceIsLocked(deviceHome()),
      endsAt: this.grant?.endsAt ?? null, idleMinutes: this.grant?.idleMinutes ?? null,
      pending: this.pending, error: this.error, activity: readLocalActivity(),
      requests: this.requests, queueError: this.queueError,
    };
  }

  private record(entry: Omit<LocalActivity, "at">) {
    audit(entry);
    this.emit();
  }

  private emit() {
    this.revision++;
    for (const listener of this.listeners) {
      try { listener(); } catch { /* A disconnected UI must not stop the worker. */ }
    }
  }

  /** One passive monitor for all local UI subscribers, including background tabs. */
  subscribe(listener: () => void) {
    this.listeners.add(listener);
    if (!this.watchTimer) {
      void this.refreshRequests();
      this.watchTimer = setInterval(() => void this.refreshRequests(), 3000);
    }
    return () => {
      this.listeners.delete(listener);
      if (!this.listeners.size) {
        if (this.watchTimer) clearInterval(this.watchTimer);
        this.watchTimer = null;
        this.watchRequest?.abort();
        this.watchRequest = null;
      }
    };
  }

  async refreshRequests() {
    if (this.watchRequest || this.mutating) return;
    const abort = this.watchRequest = new AbortController();
    const revision = this.revision;
    try {
      const c = this.activeConfig ?? loadConfig();
      if (!c.deviceId || !c.server) return;
      const result = await call<{ requests: WireRequestState[] }>(c, "POST", `${LINK_PREFIX}requests`, "{}", abort.signal);
      if (abort.signal.aborted || revision !== this.revision) return;
      if (!Array.isArray(result.requests) || result.requests.length > 20 || result.requests.some((r) => !r || typeof r.id !== "string" || typeof r.action !== "string" || !["queued", "delivered", "waiting-approval", "running"].includes(r.status))) {
        throw new Error("The controller did not return a valid request list. Update omg.dev on both computers.");
      }
      this.requests = result.requests;
      this.queueError = null;
      this.emit();
    } catch (e) {
      if (abort.signal.aborted || revision !== this.revision) return;
      this.queueError = `Cannot refresh incoming requests: ${e instanceof Error ? e.message : String(e)}`;
      this.emit();
    } finally {
      if (this.watchRequest === abort) this.watchRequest = null;
    }
  }

  private resetOverview() {
    this.watchRequest?.abort();
    this.watchRequest = null;
    this.requests = [];
    this.queueError = null;
  }

  async changeLink(change: () => void | Promise<void>) {
    if (this.mutating || this.grant) throw new Error("Stop access before changing the connection.");
    this.mutating = true;
    try { await change(); this.resetOverview(); }
    finally { this.mutating = false; this.emit(); }
    if (this.listeners.size) void this.refreshRequests();
  }

  start(options: { minutes?: unknown; idle?: unknown } = {}, ask?: Ask) {
    if (this.mutating || this.grant) throw new Error("Device access is already active.");
    const c = loadConfig();
    if (!c.deviceId || !c.server) throw new Error("Connect to a controller first.");
    if (!Object.keys(c.actions).length) throw new Error("No actions in ~/.omg-device/config.json. Add actions on this computer first.");
    const minutes = Number(options.minutes ?? c.grant?.maxMinutes ?? 120);
    const idle = Number(options.idle ?? c.grant?.idleMinutes ?? 15);
    if (!Number.isFinite(minutes) || minutes < 1 || minutes > GRANT_MAX_MINUTES) throw new Error(`Access duration must be 1 to ${GRANT_MAX_MINUTES} minutes.`);
    if (!Number.isFinite(idle) || idle < 1 || idle > minutes) throw new Error("Idle timeout must be 1 minute or more and no longer than access duration.");
    const unlock = lockDevice(deviceHome());
    this.release = unlock;
    this.activeConfig = c;
    process.once("exit", this.shutdown);
    const grant = this.grant = new Grant(minutes, idle);
    const abort = this.abort = new AbortController();
    this.error = null;
    this.record({ kind: "access-started" });
    let executing = false;
    const timer = setInterval(() => {
      if (Date.now() >= grant.endsAt || (!executing && grant.over())) abort.abort();
    }, 250);
    this.finished = (async () => {
      let failures = 0;
      while (!abort.signal.aborted) {
        try {
          const { request } = await call<{ request: WireRequest | null }>(c, "POST", `${LINK_PREFIX}poll`, JSON.stringify({ actions: actionInfos(c) }), abort.signal);
          failures = 0;
          this.error = null;
          if (request) await handleRequest(c, grant, request, (question, prompt) => this.ask(question, prompt, abort.signal, ask), {
            signal: abort.signal,
            onUpdate: (request, update) => {
              if (executing && (update.status === "done" || update.status === "failed")) grant.touch();
              executing = update.status === "running";
              this.requests = this.requests.filter((r) => r.id !== request.id);
              if (!FINAL_STATUSES.has(update.status)) this.requests.unshift({ ...request, status: update.status });
              this.record({ kind: update.status, request, update });
            },
          });
        } catch (e) {
          if (abort.signal.aborted) break;
          this.error = e instanceof Error ? e.message : String(e);
          console.log(`Device connection: ${this.error}`);
          this.record({ kind: "connection-error", reason: this.error });
          if (e instanceof UnlinkedError) break;
          await new Promise<void>((resolve) => {
            const done = () => { clearTimeout(timer); abort.signal.removeEventListener("abort", done); resolve(); };
            const timer = setTimeout(done, Math.min(30_000, 1000 * 2 ** Math.min(++failures, 5)));
            abort.signal.addEventListener("abort", done, { once: true });
            if (abort.signal.aborted) done();
          });
        }
      }
    })().finally(() => {
      clearInterval(timer);
      this.answer?.(null);
      this.pending = null;
      this.answer = null;
      this.grant = null;
      this.abort = null;
      this.activeConfig = null;
      unlock();
      this.release = null;
      this.record({ kind: "access-stopped", reason: grant.over() ?? "stopped" });
      process.removeListener("exit", this.shutdown);
    });
  }

  private ask(question: string, prompt: ApprovalPrompt, signal: AbortSignal, ask?: Ask): Promise<string | null> {
    if (signal.aborted || Date.now() >= prompt.expiresAt) return Promise.resolve(null);
    return new Promise((resolve) => {
      let settled = false;
      const finish = (value: string | null) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        signal.removeEventListener("abort", cancel);
        this.pending = null;
        this.answer = null;
        this.emit();
        resolve(value);
      };
      const cancel = () => finish(null);
      const timer = setTimeout(cancel, Math.max(0, prompt.expiresAt - Date.now()));
      signal.addEventListener("abort", cancel, { once: true });
      this.pending = { ...prompt, token: crypto.randomUUID() };
      this.answer = finish;
      this.emit();
      if (ask) void ask(question, prompt, signal).then(finish, cancel);
    });
  }

  decide(token: string, allow: boolean) {
    if (!this.pending || this.pending.token !== token || !this.answer || this.abort?.signal.aborted || this.grant?.over() || Date.now() >= this.pending.expiresAt) {
      throw new Error("This approval is no longer pending. Refresh the page.");
    }
    this.record({ kind: allow ? "approved" : "denied", request: this.pending.request });
    this.answer(allow ? "yes" : "no");
  }

  async stop() {
    this.abort?.abort();
    this.answer?.(null);
    await this.finished;
  }

  async stopAndClear() {
    if (this.mutating) throw new Error("Device access is being changed. Try again.");
    if (!this.grant && deviceIsLocked(deviceHome())) throw new Error("Stop the other device process before clearing requests here.");
    this.mutating = true;
    let unlock: (() => void) | undefined;
    try {
      await this.stop();
      unlock = lockDevice(deviceHome());
      this.resetOverview();
      try {
        await call(loadConfig(), "POST", `${LINK_PREFIX}clear`, "{}");
        this.record({ kind: "requests-cleared" });
      } catch (e) {
        this.queueError = `Access is stopped, but requests could not be cleared: ${e instanceof Error ? e.message : String(e)}`;
        throw new Error(this.queueError);
      }
    } finally {
      unlock?.();
      this.mutating = false;
      this.emit();
      if (this.listeners.size) void this.refreshRequests();
    }
  }

  /** Synchronous process-exit cleanup: kill the action group before exiting. */
  shutdown = () => {
    if (this.watchTimer) clearInterval(this.watchTimer);
    this.watchTimer = null;
    this.watchRequest?.abort();
    this.watchRequest = null;
    this.abort?.abort();
    this.answer?.(null);
    this.release?.();
  };
}

export const deviceRuntime = new DeviceRuntime();
