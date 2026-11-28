// The receiver lifecycle used by both omg serve's local UI and omg device run.
// No grant survives a restart. The installed device config remains authoritative.
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, readSync, fstatSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { actionInfos, audit, call, deviceHome, deviceLogPath, formatMinutes, Grant, GRANT_MAX_MINUTES, grantCeiling, handleRequest, loadConfig, parseIdle, UnlinkedError, type ApprovalPrompt, type Ask, type DeviceConfig } from "./agent.ts";
import { deviceIsLocked, lockDevice } from "./lock.ts";
import { acceptEnrolment, approverList, checkDecision, invitePayload, loadApprovers, newInvite, removeApprover, requestDetail, type Invite } from "./approvers.ts";
import { EXTENSION_ID_RE, FINAL_STATUSES, LINK_PREFIX, MAX_EXTENSION_MINUTES, REQUEST_ID_RE, type WireExtension, type WireGrantReport, type WireMissedRequest, type WireRemoteResult, type WireRequest, type WireRequestState, type WireUpdate } from "./protocol.ts";

export type LocalActivity = { at: number; kind: string; request?: WireRequest; update?: WireUpdate; reason?: string };
type Pending = ApprovalPrompt & { token: string };
/** An agent's request for more time, waiting for the person at this computer. */
export type PendingExtension = WireExtension & { token: string };

const HEARTBEAT_MS = 15_000;
const CONTROL_CHARS = /[\u0000-\u001f\u007f-\u009f\u2028\u2029\u202a-\u202e\u2066-\u2069]/g;
const EXTENSION_WAIT_MS = 2 * 60_000; // a terminal prompt, like action approvals

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

/** The session length and idle stop the person chose last time. Only the device writes it. */
export type StartChoice = { minutes: number; idle: number | null; long: boolean };
export type StartOptions = { minutes?: unknown; idle?: unknown; long?: unknown };

const statePath = () => join(deviceHome(), "state.json");

type DeviceState = { lastStart?: StartChoice; missedSeenAt?: number };

function readState(): DeviceState {
  try {
    const raw = JSON.parse(readFileSync(statePath(), "utf8"));
    return raw && typeof raw === "object" ? raw : {};
  } catch {
    return {};
  }
}

function writeState(change: Partial<DeviceState>) {
  try {
    mkdirSync(deviceHome(), { recursive: true, mode: 0o700 });
    writeFileSync(statePath(), JSON.stringify({ ...readState(), ...change }, null, 2) + "\n", { mode: 0o600 });
  } catch {
    // Remembering is a convenience. It must not block starting or stopping access.
  }
}

export function readStartChoice(): StartChoice | null {
  try {
    const raw = readState().lastStart;
    if (!raw || !Number.isInteger(raw.minutes) || raw.minutes < 1) return null;
    return { minutes: raw.minutes, idle: raw.idle === null ? null : parseIdle(raw.idle), long: raw.long === true };
  } catch {
    return null;
  }
}

function saveStartChoice(choice: StartChoice) {
  writeState({ lastStart: choice });
}

/**
 * Checks one start decision. A session over 4 hours needs `long: true`, which
 * only an explicit choice at the device sends. The default length stays as it was.
 */
export function resolveStart(c: Pick<DeviceConfig, "grant">, options: StartOptions = {}): StartChoice & { ceiling: number } {
  const minutes = Number(options.minutes ?? c.grant?.maxMinutes ?? 120);
  const idle = options.idle !== undefined ? parseIdle(options.idle) : parseIdle(c.grant?.idleMinutes ?? 15);
  const long = options.long === true;
  const ceiling = grantCeiling(c, long);
  const longest = grantCeiling(c, true);
  if (!Number.isInteger(minutes) || minutes < 1) throw new Error("Access duration must be a whole number of minutes.");
  if (minutes > ceiling) {
    if (!long && minutes <= longest) throw new Error(`Sessions longer than ${formatMinutes(GRANT_MAX_MINUTES)} need an explicit long-session choice on this computer.`);
    throw new Error(`Access duration must be 1 to ${longest} minutes on this computer.`);
  }
  return { minutes, idle, long, ceiling };
}

function validMissed(m: WireMissedRequest): boolean {
  return !!m && typeof m.id === "string" && REQUEST_ID_RE.test(m.id) && typeof m.action === "string" && /^[a-z][a-z0-9_]{0,39}$/.test(m.action)
    && Number.isFinite(m.updatedAt) && Number.isFinite(m.createdAt)
    && (m.requestedBy === undefined || (typeof m.requestedBy === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(m.requestedBy)))
    && (m.reason === undefined || typeof m.reason === "string");
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
  private extension: PendingExtension | null = null;
  private extensionTimer: ReturnType<typeof setTimeout> | null = null;
  private extensionAnswer: NonNullable<WireGrantReport["extension"]> | null = null;
  private seenExtensions = new Set<string>();
  private heartbeating = false;
  private heartbeatAgain = false;
  private terminal: Promise<unknown> = Promise.resolve();
  private terminalAsk: Ask | undefined;
  private missed: WireMissedRequest[] = [];
  /** The code a phone scans here to become an approver; made here, shown only here. */
  private invite: Invite | null = null;
  private inviteTimer: ReturnType<typeof setTimeout> | null = null;
  private remoteAbort: AbortController | null = null;
  private remoteResults: WireRemoteResult[] = [];
  private remoteError: string | null = null;
  finished: Promise<void> = Promise.resolve();

  snapshot() {
    const c = this.activeConfig ?? loadConfig();
    return {
      deviceId: c.deviceId ?? null, server: c.server ?? null,
      actions: actionInfos(c), active: this.grant !== null,
      otherProcess: !this.grant && !this.mutating && deviceIsLocked(deviceHome()),
      endsAt: this.grant?.endsAt ?? null, idleMinutes: this.grant?.idleMinutes ?? null,
      grant: this.grant?.status() ?? null, lastChoice: readStartChoice(),
      longestMinutes: grantCeiling(c, true), standardMinutes: grantCeiling(c, false),
      pending: this.pending, extension: this.extension, missed: this.unseenMissed(),
      error: this.error, activity: readLocalActivity(),
      requests: this.requests, queueError: this.queueError,
      approvers: approverList(),
      approverInvite: this.invite && c.deviceId && c.server && Date.now() < this.invite.expiresAt
        ? { payload: invitePayload(this.invite, c.deviceId, c.server), code: this.invite.code, expiresAt: this.invite.expiresAt }
        : null,
      remote: { watching: this.remoteAbort !== null, error: this.remoteError },
    };
  }

  // ---- approvers: the person's phones, added here, answering from anywhere ----------

  /** Shows a code for a phone to scan here. Only this computer's own UI can ask for one. */
  openInvite() {
    const c = loadConfig();
    if (!c.deviceId || !c.server) throw new Error("Connect to a controller first.");
    this.invite = newInvite();
    if (this.inviteTimer) clearTimeout(this.inviteTimer);
    this.inviteTimer = setTimeout(() => { this.invite = null; this.inviteTimer = null; this.emit(); }, this.invite.expiresAt - Date.now());
    this.record({ kind: "approver-invite" });
    this.watchRemote();
  }

  closeInvite() {
    this.invite = null;
    if (this.inviteTimer) clearTimeout(this.inviteTimer);
    this.inviteTimer = null;
    this.emit();
  }

  dropApprover(id: unknown) {
    const a = loadApprovers().find((x) => x.id === id);
    if (!a || !removeApprover(a.id)) throw new Error("That phone is not an approver here.");
    this.record({ kind: "approver-removed", reason: a.name });
  }

  /**
   * While a phone may answer (an approver exists, or an invite is open), keeps one
   * long poll open to the controller for decisions and enrolments, whether or not
   * access is on: a phone can start access. Every decision is checked here, against
   * keys this computer enrolled, before anything happens.
   */
  watchRemote() {
    if (this.remoteAbort) return;
    const linked = () => {
      try { const c = this.activeConfig ?? loadConfig(); return c.deviceId && c.server ? c : null; } catch { return null; }
    };
    const wanted = () => !!linked() && (loadApprovers().length > 0 || (this.invite !== null && Date.now() < this.invite.expiresAt));
    if (!wanted()) return;
    const abort = this.remoteAbort = new AbortController();
    this.emit();
    void (async () => {
      let failures = 0;
      while (!abort.signal.aborted && wanted()) {
        const c = linked()!;
        const results = this.remoteResults.splice(0);
        try {
          const r = await call<{ decisions?: unknown[]; enrolments?: unknown[] }>(c, "POST", `${LINK_PREFIX}remote`, JSON.stringify({ approvers: approverList(), results, invite: this.invite !== null }), abort.signal);
          failures = 0;
          if (this.remoteError) { this.remoteError = null; this.emit(); }
          for (const e of Array.isArray(r?.enrolments) ? r.enrolments.slice(0, 5) : []) this.onEnrolment(c.deviceId!, e);
          for (const d of Array.isArray(r?.decisions) ? r.decisions.slice(0, 20) : []) await this.onDecision(c.deviceId!, d);
        } catch (e) {
          this.remoteResults.unshift(...results);
          if (abort.signal.aborted) break;
          this.remoteError = e instanceof Error ? e.message : String(e);
          this.emit();
          if (e instanceof UnlinkedError) break;
          await new Promise<void>((resolve) => {
            const done = () => { clearTimeout(timer); abort.signal.removeEventListener("abort", done); resolve(); };
            const timer = setTimeout(done, Math.min(60_000, 1000 * 2 ** Math.min(++failures, 6)));
            abort.signal.addEventListener("abort", done, { once: true });
          });
        }
      }
    })().finally(() => {
      if (this.remoteAbort === abort) this.remoteAbort = null;
      this.emit();
    });
  }

  private say(nonce: unknown, ok: boolean, reason?: string) {
    if (typeof nonce === "string" && /^[a-f0-9]{32}$/.test(nonce)) this.remoteResults.push({ nonce, ok, reason });
  }

  private onEnrolment(deviceId: string, raw: unknown) {
    const nonce = (raw as { nonce?: unknown } | null)?.nonce;
    const result = acceptEnrolment(raw, deviceId, this.invite);
    if (!result.ok) {
      this.record({ kind: "approver-refused", reason: result.reason });
      return this.say(nonce, false, result.reason);
    }
    this.closeInvite();
    this.record({ kind: "approver-added", reason: result.approver.name });
    this.say(nonce, true);
  }

  private async onDecision(deviceId: string, raw: unknown) {
    const nonce = (raw as { nonce?: unknown } | null)?.nonce;
    const checked = checkDecision(raw, deviceId);
    if (!checked.ok) {
      this.record({ kind: "remote-refused", reason: checked.reason });
      return this.say(nonce, false, checked.reason);
    }
    const { approver, decision: d } = checked;
    const by = `by ${approver.name}`;
    try {
      switch (d.kind) {
        case "request": {
          const p = this.pending;
          if (!p || p.request.id !== d.target || d.detail !== requestDetail(p.request.action, p.request.args ?? {})) {
            return this.say(nonce, false, "That request is no longer waiting for approval on the device.");
          }
          this.decide(p.token, d.allow);
          this.record({ kind: d.allow ? "remote-approved" : "remote-denied", request: p.request, reason: by });
          return this.say(nonce, true);
        }
        case "extension": {
          const x = this.extension;
          if (!x || x.id !== d.target || d.detail !== String(x.minutes)) return this.say(nonce, false, "That extension is no longer waiting on the device.");
          this.decideExtension(x.token, d.allow);
          this.record({ kind: d.allow ? "remote-approved" : "remote-denied", reason: `extension of ${formatMinutes(x.minutes)} ${by}` });
          return this.say(nonce, true);
        }
        case "start": {
          const m = d.detail.match(/^(\d{1,4}),(never|\d{1,4})$/);
          if (!d.allow || !m) return this.say(nonce, false, "malformed start");
          if (this.grant) return this.say(nonce, false, "Access is already on.");
          // A phone starts a standard session at most; a long one is a choice made here.
          this.start({ minutes: Number(m[1]), idle: m[2] === "never" ? "never" : Number(m[2]), long: false });
          this.record({ kind: "remote-start", reason: `${formatMinutes(Number(m[1]))} ${by}` });
          return this.say(nonce, true);
        }
        case "stop": {
          if (!this.grant) return this.say(nonce, true, "Access was already off.");
          await this.stop();
          this.record({ kind: "remote-stop", reason: by });
          return this.say(nonce, true);
        }
      }
    } catch (e) {
      return this.say(nonce, false, e instanceof Error ? e.message : String(e));
    }
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
      const result = await call<{ requests: WireRequestState[]; missed?: WireMissedRequest[] }>(c, "POST", `${LINK_PREFIX}requests`, "{}", abort.signal);
      if (abort.signal.aborted || revision !== this.revision) return;
      if (!Array.isArray(result.requests) || result.requests.length > 20 || result.requests.some((r) => !r || typeof r.id !== "string" || typeof r.action !== "string" || !["queued", "delivered", "waiting-approval", "running"].includes(r.status))) {
        throw new Error("The controller did not return a valid request list. Update omg.dev on both computers.");
      }
      this.requests = result.requests;
      // An older controller sends no missed list.
      this.missed = Array.isArray(result.missed) ? result.missed.filter(validMissed).slice(0, 20) : [];
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

  start(options: StartOptions = {}, ask?: Ask) {
    if (this.mutating || this.grant) throw new Error("Device access is already active.");
    const c = loadConfig();
    if (!c.deviceId || !c.server) throw new Error("Connect to a controller first.");
    if (!Object.keys(c.actions).length) throw new Error("No actions in ~/.omg-device/config.json. Add actions on this computer first.");
    const choice = resolveStart(c, options);
    const unlock = lockDevice(deviceHome());
    this.release = unlock;
    this.activeConfig = c;
    process.once("exit", this.shutdown);
    const grant = this.grant = new Grant(choice.minutes, choice.idle, Date.now(), choice.ceiling);
    const abort = this.abort = new AbortController();
    this.error = null;
    saveStartChoice({ minutes: choice.minutes, idle: choice.idle, long: choice.long });
    this.record({ kind: "access-started", reason: `${formatMinutes(choice.minutes)}${choice.long ? " (long session)" : ""}, idle stop ${choice.idle === null ? "never" : formatMinutes(choice.idle)}` });
    // The grant knows when an action runs, so a long action never counts as idle.
    const timer = setInterval(() => {
      if (grant.over()) abort.abort();
    }, 250);
    this.terminalAsk = ask;
    this.seenExtensions.clear();
    void this.heartbeat();
    const beat = setInterval(() => void this.heartbeat(), HEARTBEAT_MS);
    this.finished = (async () => {
      let failures = 0;
      while (!abort.signal.aborted) {
        try {
          const { request } = await call<{ request: WireRequest | null }>(c, "POST", `${LINK_PREFIX}poll`, JSON.stringify({ actions: actionInfos(c) }), abort.signal);
          failures = 0;
          this.error = null;
          if (request) await handleRequest(c, grant, request, (question, prompt) => this.ask(question, prompt!, abort.signal, ask && ((q, p, sig) => this.onTerminal(() => ask(q, p, sig)))), {
            signal: abort.signal,
            onUpdate: (request, update) => {
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
      clearInterval(beat);
      const reason = grant.over() ?? "stopped";
      this.dropExtension({ status: "denied", reason: "access ended on the device" });
      // Tell the controller at once, so agents see that access ended. Best effort.
      void call(c, "POST", `${LINK_PREFIX}grant`, JSON.stringify({ grant: null, reason, extension: this.extensionAnswer ?? undefined } satisfies WireGrantReport)).catch(() => {});
      this.extensionAnswer = null;
      this.terminalAsk = undefined;
      this.answer?.(null);
      this.pending = null;
      this.answer = null;
      this.grant = null;
      this.abort = null;
      this.activeConfig = null;
      unlock();
      this.release = null;
      this.record({ kind: "access-stopped", reason });
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

  /** The person at this computer moves the end of the active grant. */
  extend(minutes: unknown) {
    if (!this.grant || this.abort?.signal.aborted) throw new Error("Access is not active. Start access first.");
    const grant = this.grant;
    // Less than a minute of room left means Extend would change nothing the person can see.
    if (Date.now() + grant.ceilingMinutes * 60_000 - grant.endsAt < 60_000) throw new Error(`Access already ends at the longest allowed time (${formatMinutes(grant.ceilingMinutes)} from now).`);
    const endsAt = grant.extendBy(Number(minutes));
    this.record({ kind: "access-extended", reason: `ends at ${new Date(endsAt).toLocaleTimeString()}` });
    void this.heartbeat();
  }

  /** The person at this computer changes the idle stop of the active grant. */
  setIdle(idle: unknown) {
    if (!this.grant || this.abort?.signal.aborted) throw new Error("Access is not active. Start access first.");
    const minutes = parseIdle(idle);
    this.grant.setIdle(minutes);
    this.record({ kind: "idle-changed", reason: minutes === null ? "never while access lasts" : `after ${formatMinutes(minutes)}` });
    void this.heartbeat();
  }

  /**
   * Reports this grant to the controller and fetches an agent's extension
   * request. The report is for display only; the controller cannot change the
   * grant. Runs every 15 seconds while access is active, and after each change.
   */
  async heartbeat() {
    const grant = this.grant;
    const c = this.activeConfig;
    if (!grant || !c || this.abort?.signal.aborted) return;
    if (this.heartbeating) { this.heartbeatAgain = true; return; }
    this.heartbeating = true;
    try {
      const answer = this.extensionAnswer;
      const body: WireGrantReport = { grant: grant.status(), extension: answer ?? undefined };
      const result = await call<{ extension?: WireExtension | null }>(c, "POST", `${LINK_PREFIX}grant`, JSON.stringify(body), this.abort?.signal);
      if (this.extensionAnswer === answer) this.extensionAnswer = null;
      if (this.grant === grant && result?.extension) this.offerExtension(result.extension);
    } catch {
      // An older controller has no grant route, and the poll loop reports outages.
    } finally {
      this.heartbeating = false;
      if (this.heartbeatAgain) { this.heartbeatAgain = false; void this.heartbeat(); }
    }
  }

  private onTerminal<T>(run: () => Promise<T>): Promise<T> {
    // One terminal prompt at a time: an approval and an extension never share stdin.
    const next = this.terminal.then(run, run);
    this.terminal = next.catch(() => {});
    return next;
  }

  private offerExtension(raw: WireExtension) {
    const grant = this.grant;
    if (!grant || !raw || typeof raw.id !== "string" || !EXTENSION_ID_RE.test(raw.id)) return;
    if (this.seenExtensions.has(raw.id) || this.extension) return;
    if (!Number.isInteger(raw.minutes) || raw.minutes < 1 || raw.minutes > MAX_EXTENSION_MINUTES) return;
    this.seenExtensions.add(raw.id);
    const requestedBy = typeof raw.requestedBy === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(raw.requestedBy) ? raw.requestedBy : undefined;
    const reason = typeof raw.reason === "string" ? raw.reason.replace(CONTROL_CHARS, " ").trim().slice(0, 200) || undefined : undefined;
    const expiresAt = Math.min(Number.isFinite(raw.expiresAt) ? raw.expiresAt : 0, grant.endsAt, Date.now() + 30 * 60_000);
    if (expiresAt <= Date.now()) return;
    const x: PendingExtension = { id: raw.id, minutes: raw.minutes, reason, requestedBy, createdAt: Number(raw.createdAt) || Date.now(), expiresAt, token: crypto.randomUUID() };
    this.extension = x;
    this.extensionTimer = setTimeout(() => this.dropExtension({ status: "denied", reason: "no answer" }), expiresAt - Date.now());
    this.record({ kind: "extension-requested", reason: `${formatMinutes(x.minutes)}${requestedBy ? ` by session ${requestedBy.slice(0, 8)}` : ""}${reason ? `: ${reason}` : ""}` });
    const ask = this.terminalAsk;
    if (ask) {
      const question = `\n→ ${requestedBy ? `Session ${requestedBy.slice(0, 8)}` : "An agent"} asks to extend access by ${formatMinutes(x.minutes)}${reason ? ` (${reason})` : ""}. Allow? [y/N] `;
      void this.onTerminal(() => {
        if (this.extension?.token !== x.token) return Promise.resolve(null);
        return Promise.race([ask(question, null, this.abort?.signal), Bun.sleep(EXTENSION_WAIT_MS).then(() => null)]);
      }).then((answer) => {
        if (this.extension?.token !== x.token) return;
        try { this.decideExtension(x.token, answer === "y" || answer === "yes"); } catch { /* access ended meanwhile */ }
      });
    }
  }

  private dropExtension(answer: { status: "denied"; reason: string }) {
    const x = this.extension;
    if (this.extensionTimer) clearTimeout(this.extensionTimer);
    this.extensionTimer = null;
    if (!x) return;
    this.extension = null;
    this.extensionAnswer = { id: x.id, ...answer };
    this.record({ kind: "extension-denied", reason: answer.reason });
    void this.heartbeat();
  }

  /** The person at this computer answers an agent's extension request. The server never answers it. */
  decideExtension(token: string, allow: boolean) {
    const x = this.extension;
    if (!x || x.token !== token || !this.grant || this.abort?.signal.aborted || Date.now() >= x.expiresAt) {
      throw new Error("This extension request is no longer pending. Refresh the page.");
    }
    if (!allow) return this.dropExtension({ status: "denied", reason: "the person at the device said no" });
    if (this.extensionTimer) clearTimeout(this.extensionTimer);
    this.extensionTimer = null;
    const endsAt = this.grant.extendBy(x.minutes); // clamped to this session's limit
    this.extension = null;
    this.extensionAnswer = { id: x.id, status: "approved", endsAt };
    this.record({ kind: "extension-approved", reason: `ends at ${new Date(endsAt).toLocaleTimeString()}` });
    void this.heartbeat();
  }

  private unseenMissed(): WireMissedRequest[] {
    const seen = readState().missedSeenAt ?? 0;
    return this.missed.filter((m) => m.updatedAt > seen);
  }

  /** The person has seen the requests that expired while access was off. */
  dismissMissed() {
    const latest = Math.max(Date.now(), ...this.missed.map((m) => m.updatedAt));
    writeState({ missedSeenAt: latest });
    this.emit();
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
    this.remoteAbort?.abort();
    this.answer?.(null);
    this.release?.();
  };
}

export const deviceRuntime = new DeviceRuntime();
