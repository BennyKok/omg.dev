// The device side of the device link (`omg device ...`). It runs on the linked
// machine, not on the omg server.
//
// The rules it enforces do not depend on the server:
// - It opens no port. It only calls the server, over HTTPS.
// - The actions it will run come from its OWN config file. The server, and any
//   repository the device builds, cannot add one.
// - Each action is a fixed argument list. Values fill whole placeholders after
//   their rule passes. There is no shell.
// - A run has a grant with a hard end and an idle timeout. The person at the
//   device approves actions here, in this terminal.
// - It sends back files only from the request's own output folder.
//
// Imports stay to node built-ins and the device modules so this file works on a
// device that has only the omg CLI.

import { spawn } from "node:child_process";
import { appendFileSync, chmodSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join, resolve, sep } from "node:path";
import { createInterface } from "node:readline";
import { lockDevice } from "./lock.ts";
import {
  ACTION_RE,
  APPROVALS,
  checkArgs,
  REQUEST_ID_RE,
  FILE_NAME_RE,
  LINK_PREFIX,
  MAX_FILE_BYTES,
  MAX_FILES_PER_REQUEST,
  MAX_LOG_TAIL,
  newKeyPair,
  signRequest,
  type ActionInfo,
  type Approval,
  type ArgSpec,
  type WireRequest,
  type WireUpdate,
} from "./protocol.ts";

export type ArgvItem = string | string[];

export type ActionConfig = {
  description?: string;
  approval: Approval;
  /** argv[0] must be an absolute path. "{name}" is an argument, "{out}" the request's output folder. An inner array is dropped when an optional argument in it is missing. */
  argv: ArgvItem[];
  args?: Record<string, ArgSpec>;
  cwd?: string;
  timeoutSec?: number;
  /** Extra environment variable NAMES to pass through from this shell. Values are never in the config. */
  env?: string[];
};

export type DeviceConfig = {
  server?: string;
  deviceId?: string;
  grant?: { maxMinutes?: number; idleMinutes?: number };
  actions: Record<string, ActionConfig>;
};

export const GRANT_MAX_MINUTES = 240;
const APPROVAL_WAIT_MS = 120_000;
const DEFAULT_TIMEOUT_SEC = 600;
const BASE_ENV = ["PATH", "HOME", "LANG", "USER", "TMPDIR"];

export const deviceHome = () => process.env.OMG_DEVICE_HOME || join(homedir(), ".omg-device");
const configPath = () => join(deviceHome(), "config.json");
const keyPath = () => join(deviceHome(), "key.pem");
export const deviceLogPath = () => join(deviceHome(), "log.jsonl");
const outRoot = () => join(deviceHome(), "out");

// ---- config ---------------------------------------------------------------------

export function validateConfig(raw: unknown): { ok: true; config: DeviceConfig } | { ok: false; error: string } {
  if (!raw || typeof raw !== "object") return { ok: false, error: "config must be an object" };
  const c = raw as DeviceConfig;
  if (!c.actions || typeof c.actions !== "object") return { ok: false, error: "config.actions must be an object" };
  for (const [name, a] of Object.entries(c.actions)) {
    const where = `actions.${name}`;
    if (!/^[a-z][a-z0-9_]{0,39}$/.test(name)) return { ok: false, error: `${where}: name must be lowercase letters, digits and _` };
    if (!APPROVALS.includes(a.approval)) return { ok: false, error: `${where}.approval: one of ${APPROVALS.join(", ")}` };
    if (!Array.isArray(a.argv) || a.argv.length === 0) return { ok: false, error: `${where}.argv: a non-empty list` };
    if (typeof a.argv[0] !== "string" || !isAbsolute(a.argv[0])) return { ok: false, error: `${where}.argv[0]: an absolute path, so PATH cannot swap the program` };
    if (a.argv[0].includes("{")) return { ok: false, error: `${where}.argv[0]: no placeholders in the program path` };
    const declared = new Set(Object.keys(a.args ?? {}));
    for (const item of a.argv.flat()) {
      if (typeof item !== "string") return { ok: false, error: `${where}.argv: strings or lists of strings` };
      for (const m of item.matchAll(/\{([a-z_][a-z0-9_]*)\}/g)) {
        if (m[1] !== "out" && !declared.has(m[1])) return { ok: false, error: `${where}.argv: "{${m[1]}}" is not in args` };
      }
    }
    for (const [arg, spec] of Object.entries(a.args ?? {})) {
      if (!spec.pattern && !spec.enum) return { ok: false, error: `${where}.args.${arg}: needs a pattern or an enum` };
      if (spec.pattern) {
        try {
          new RegExp(spec.pattern);
        } catch {
          return { ok: false, error: `${where}.args.${arg}.pattern: not a valid expression` };
        }
      }
    }
    if (a.cwd !== undefined && !isAbsolute(a.cwd)) return { ok: false, error: `${where}.cwd: an absolute path` };
    if (a.env && (!Array.isArray(a.env) || a.env.some((e) => !/^[A-Z_][A-Z0-9_]*$/.test(e)))) return { ok: false, error: `${where}.env: a list of variable names` };
  }
  return { ok: true, config: c };
}

export function loadConfig(): DeviceConfig {
  if (!existsSync(configPath())) return { actions: {} };
  const parsed = validateConfig(JSON.parse(readFileSync(configPath(), "utf8")));
  if (!parsed.ok) throw new Error(`${configPath()}: ${parsed.error}`);
  return parsed.config;
}

function saveConfig(c: DeviceConfig) {
  mkdirSync(deviceHome(), { recursive: true, mode: 0o700 });
  writeFileSync(configPath(), JSON.stringify(c, null, 2) + "\n", { mode: 0o600 });
}

export function actionInfos(c: DeviceConfig): ActionInfo[] {
  return Object.entries(c.actions).map(([name, a]) => ({ name, approval: a.approval, args: a.args ?? {}, description: a.description }));
}

/** The exact argument list for one request, or an error. Values fill placeholders inside one argument; they never split or add arguments. */
export function buildArgv(action: ActionConfig, args: Record<string, string>, outDir: string): string[] {
  const fill = (s: string) => s.replace(/\{([a-z_][a-z0-9_]*)\}/g, (_, k: string) => (k === "out" ? outDir : (args[k] ?? "")));
  const refs = (s: string) => [...s.matchAll(/\{([a-z_][a-z0-9_]*)\}/g)].map((m) => m[1]).filter((k) => k !== "out");
  const out: string[] = [];
  for (const item of action.argv) {
    const group = Array.isArray(item) ? item : [item];
    const missing = group.some((s) => refs(s).some((k) => args[k] === undefined));
    if (missing) {
      if (Array.isArray(item)) continue;
      throw new Error(`argument "${refs(item).find((k) => args[k] === undefined)}" is required here`);
    }
    out.push(...group.map(fill));
  }
  return out;
}

export function audit(entry: Record<string, unknown>) {
  try {
    appendFileSync(deviceLogPath(), JSON.stringify({ at: new Date().toISOString(), ...entry }) + "\n", { mode: 0o600 });
  } catch {
    // Logging must not stop the kill switch or a deny.
  }
}

// ---- grant ------------------------------------------------------------------------

export class Grant {
  readonly endsAt: number;
  private lastActivity: number;
  private readonly approvedOnce = new Set<string>();
  constructor(
    readonly maxMinutes: number,
    readonly idleMinutes: number,
    now = Date.now(),
  ) {
    this.endsAt = now + Math.min(maxMinutes, GRANT_MAX_MINUTES) * 60_000;
    this.lastActivity = now;
  }
  touch(now = Date.now()) {
    this.lastActivity = now;
  }
  over(now = Date.now()): string | null {
    if (now >= this.endsAt) return "the grant ended";
    if (now - this.lastActivity >= this.idleMinutes * 60_000) return `no requests for ${this.idleMinutes} minutes`;
    return null;
  }
  /** Whether this action needs the person to answer now. */
  needsPrompt(name: string, approval: Approval): boolean {
    if (approval === "in-grant") return false;
    if (approval === "once-per-grant") return !this.approvedOnce.has(name);
    return true;
  }
  remember(name: string, approval: Approval) {
    if (approval === "once-per-grant") this.approvedOnce.add(name);
  }
}

// ---- transport ----------------------------------------------------------------------

function serverUrl(c: DeviceConfig): string {
  if (!c.server || !c.deviceId) throw new Error("This device is not linked. Run `omg device link --server <url> --code <code>`.");
  return c.server;
}

export function checkServerUrl(raw: string): string {
  const u = new URL(raw);
  const loopback = u.hostname === "127.0.0.1" || u.hostname === "localhost";
  if (u.protocol !== "https:" && !(u.protocol === "http:" && loopback)) throw new Error("the server address must use https");
  return u.origin;
}

export async function call<T>(c: DeviceConfig, method: "POST" | "PUT", path: string, body: Uint8Array | string, signal?: AbortSignal): Promise<T> {
  const key = readFileSync(keyPath(), "utf8");
  const headers = {
    ...signRequest(c.deviceId!, key, method, path, body),
    "content-type": typeof body === "string" ? "application/json" : "application/octet-stream",
  };
  // No redirects: a redirect could carry the signed call and files to another origin, or to plain http.
  const timeout = AbortSignal.timeout(35_000);
  const res = await fetch(`${serverUrl(c)}${path}`, { method, headers, body, signal: signal ? AbortSignal.any([signal, timeout]) : timeout, redirect: "error" });
  const data = ((await res.json().catch(() => ({}))) ?? {}) as { error?: string };
  if (res.status === 401) throw new UnlinkedError(data.error || "the server no longer accepts this device");
  if (!res.ok) throw new Error(data.error || `${res.status} ${res.statusText}`);
  return data as T;
}

export class UnlinkedError extends Error {}

const update = (c: DeviceConfig, u: WireUpdate) => call(c, "POST", `${LINK_PREFIX}update`, JSON.stringify(u));

// ---- approval prompt -------------------------------------------------------------

export type ApprovalPrompt = { request: WireRequest; argv: string[]; approval: Approval; expiresAt: number };
export type Ask = (question: string, prompt: ApprovalPrompt, signal?: AbortSignal) => Promise<string | null>;
export type RunObserver = {
  signal?: AbortSignal;
  onUpdate?: (request: WireRequest, update: WireUpdate) => void;
};

function terminalAsk(): Ask {
  return (question, _prompt, signal) =>
    new Promise((resolve) => {
      if (!process.stdin.isTTY || signal?.aborted) return resolve(null);
      const rl = createInterface({ input: process.stdin, output: process.stdout });
      const finish = (answer: string | null) => {
        clearTimeout(timer);
        signal?.removeEventListener("abort", cancel);
        rl.close();
        resolve(answer);
      };
      const cancel = () => finish(null);
      const timer = setTimeout(() => {
        process.stdout.write("\n(no answer in 2 minutes: denied)\n");
        finish(null);
      }, APPROVAL_WAIT_MS);
      signal?.addEventListener("abort", cancel, { once: true });
      // readline swallows Ctrl-C while it waits. Pass it on, so Ctrl-C at a
      // prompt ends the grant like it does everywhere else.
      rl.on("SIGINT", () => {
        finish(null);
        process.emit("SIGINT");
      });
      rl.question(question, (answer) => {
        finish(answer.trim().toLowerCase());
      });
    });
}

// ---- running one request ----------------------------------------------------------

export type RunResult = { exitCode: number; logTail: string; timedOut: boolean };

export function runArgv(argv: string[], opts: { cwd?: string; timeoutSec: number; env: Record<string, string>; signal?: AbortSignal }): Promise<RunResult> {
  if (opts.signal?.aborted) return Promise.resolve({ exitCode: 130, logTail: "Stopped", timedOut: false });
  return new Promise((resolve) => {
    let tail = "";
    const keep = (chunk: Buffer) => {
      tail = (tail + chunk.toString("utf8")).slice(-MAX_LOG_TAIL);
    };
    // Its own process group, so a timeout stops everything the action started,
    // not only the first process.
    const child = spawn(argv[0], argv.slice(1), { cwd: opts.cwd, env: opts.env, stdio: ["ignore", "pipe", "pipe"], shell: false, detached: true });
    let timedOut = false;
    let settled = false;
    const killGroup = (sig: NodeJS.Signals) => {
      try {
        if (child.pid) process.kill(-child.pid, sig);
      } catch {
        // Already gone.
      }
    };
    const finish = (code: number | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      opts.signal?.removeEventListener("abort", abort);
      killGroup("SIGKILL"); // nothing the action started outlives it
      resolve({ exitCode: timedOut ? 124 : (code ?? 1), logTail: tail, timedOut });
    };
    const timer = setTimeout(() => {
      timedOut = true;
      killGroup("SIGTERM");
      setTimeout(() => finish(null), 5000).unref();
    }, opts.timeoutSec * 1000);
    const abort = () => {
      killGroup("SIGKILL");
      finish(130);
    };
    opts.signal?.addEventListener("abort", abort, { once: true });
    if (opts.signal?.aborted) abort();
    child.stdout.on("data", keep);
    child.stderr.on("data", keep);
    child.on("error", (e) => {
      keep(Buffer.from(`\n${e.message}\n`));
      finish(127);
    });
    // "exit", then a short wait for the pipes: a grandchild that keeps them
    // open must not hold the device forever.
    child.on("close", (code) => finish(code));
    child.on("exit", (code) => setTimeout(() => finish(code), 2000).unref());
  });
}

/** Regular files in the request's own folder: no links, no folders, no odd names, within the size caps. */
export function collectFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const name of readdirSync(dir).sort()) {
    if (out.length >= MAX_FILES_PER_REQUEST) break;
    if (!FILE_NAME_RE.test(name)) continue;
    const st = lstatSync(join(dir, name));
    if (!st.isFile() || st.size > MAX_FILE_BYTES) continue;
    out.push(name);
  }
  return out;
}

/** Server data shown in this terminal: no control characters, so it cannot hide or fake the prompt. */
export function printable(s: string): string {
  return s.replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029\u202a-\u202e\u2066-\u2069]/g, "?");
}

export async function handleRequest(c: DeviceConfig, grant: Grant, r: WireRequest, ask: Ask, observer: RunObserver = {}): Promise<void> {
  const report = async (u: WireUpdate) => {
    observer.onUpdate?.(r, u);
    await update(c, u);
  };
  // Everything below prints server data in the approval prompt and uses the id
  // as a folder name. A server that sends anything else gets no answer at all.
  if (typeof r?.id !== "string" || !REQUEST_ID_RE.test(r.id) || typeof r.action !== "string" || !ACTION_RE.test(r.action)) {
    audit({ decision: "ignored", reason: "malformed request from the server" });
    console.log("\n→ ignored a malformed request from the server");
    return;
  }
  if (r.requestedBy !== undefined && (typeof r.requestedBy !== "string" || !/^[A-Za-z0-9_-]{1,64}$/.test(r.requestedBy))) r.requestedBy = undefined;
  const deny = async (reason: string) => {
    audit({ request: r.id, action: r.action, decision: "denied", reason });
    console.log(`  denied: ${printable(reason)}`);
    await report({ id: r.id, status: "denied", reason });
  };
  const action = Object.hasOwn(c.actions, r.action) ? c.actions[r.action] : undefined;
  console.log(`\n${printable(`→ ${r.action} ${JSON.stringify(r.args)}${r.requestedBy ? ` (from session ${r.requestedBy.slice(0, 8)})` : ""}`)}`);
  const ended = grant.over();
  if (observer.signal?.aborted) return deny("access stopped on this device");
  if (ended) return deny(`no active grant: ${ended}`);
  if (!action) return deny(`"${r.action}" is not in this device's config`);
  if (!Number.isFinite(r.expiresAt)) return deny("invalid request expiry");
  if (Date.now() > r.expiresAt) return deny("the request expired before it reached this device");
  const checked = checkArgs(r.args, action.args ?? {});
  if (!checked.ok) return deny(checked.error);

  const out = join(outRoot(), r.id);
  let argv: string[];
  try {
    argv = buildArgv(action, checked.args, out);
  } catch (e) {
    return deny(e instanceof Error ? e.message : String(e));
  }

  if (grant.needsPrompt(r.action, action.approval)) {
    await report({ id: r.id, status: "waiting-approval" });
    const scope = action.approval === "once-per-grant" ? " (yes allows it with any arguments for the rest of this grant)" : "";
    console.log(printable(`  will run: ${argv.map((a) => JSON.stringify(a)).join(" ")}`));
    const answer = await ask(`  Allow ${r.action}${scope}? [y/N] `, {
      request: r, argv, approval: action.approval,
      expiresAt: Math.min(r.expiresAt, grant.endsAt, Date.now() + APPROVAL_WAIT_MS),
    });
    if (answer !== "y" && answer !== "yes") return deny(answer === null ? "no answer" : "the person at the device said no");
    // The grant may have ended while the person read the prompt.
    const endedWhileAsking = grant.over();
    if (endedWhileAsking) return deny(`no active grant: ${endedWhileAsking}`);
    if (Date.now() >= r.expiresAt || observer.signal?.aborted) return deny("request expired or access stopped before approval");
    grant.remember(r.action, action.approval);
    audit({ request: r.id, action: r.action, decision: "approved", argv });
  } else {
    audit({ request: r.id, action: r.action, decision: "allowed by grant", argv });
  }

  if (observer.signal?.aborted) return deny("access stopped on this device");
  if (Date.now() >= r.expiresAt) return deny("the request expired before approval");
  // Only an approved or allowed run counts as activity, so a server cannot keep an idle grant alive.
  grant.touch();
  // REQUEST_ID_RE already rules out "..", this keeps the delete inside out/ even if that rule ever changes.
  if (!resolve(out).startsWith(resolve(outRoot()) + sep)) return deny("bad output folder");
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true, mode: 0o700 });
  await report({ id: r.id, status: "running" });
  const env: Record<string, string> = {};
  for (const k of [...BASE_ENV, ...(action.env ?? [])]) if (process.env[k] !== undefined) env[k] = process.env[k]!;
  env.OMG_DEVICE_OUT = out;
  const result = await runArgv(argv, { cwd: action.cwd, timeoutSec: action.timeoutSec ?? DEFAULT_TIMEOUT_SEC, env, signal: observer.signal });

  const sent: string[] = [];
  for (const name of collectFiles(out)) {
    if (observer.signal?.aborted) break;
    try {
      await call(c, "PUT", `${LINK_PREFIX}file/${r.id}/${encodeURIComponent(name)}`, new Uint8Array(readFileSync(join(out, name))));
      sent.push(name);
    } catch (e) {
      result.logTail = (result.logTail + `\n[omg device] could not send ${name}: ${e instanceof Error ? e.message : e}`).slice(-MAX_LOG_TAIL);
    }
  }
  const status = result.exitCode === 0 ? "done" : "failed";
  audit({ request: r.id, action: r.action, status, exitCode: result.exitCode, files: sent });
  console.log(`  ${status} (exit ${result.exitCode}${result.timedOut ? ", timed out" : ""}${sent.length ? `, ${sent.length} file(s)` : ""})`);
  await report({ id: r.id, status, exitCode: result.exitCode, logTail: result.logTail, reason: observer.signal?.aborted ? "access stopped on this device" : result.timedOut ? "timed out" : undefined });
}

// ---- commands -------------------------------------------------------------------------

function flag(args: string[], name: string): string | undefined {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
}

async function cmdLink(args: string[]) {
  const server = flag(args, "server");
  const code = flag(args, "code");
  if (!server || !code) throw new Error("usage: omg device link --server https://<omg host> --code <CODE>");
  await linkDevice(server, code);
}

export async function linkDevice(server: string, code: string) {
  const unlock = lockDevice(deviceHome());
  try {
    const c = loadConfig();
    if (c.deviceId) throw new Error(`Already linked as "${c.deviceId}". Run \`omg device unlink\` first.`);
    const origin = checkServerUrl(server);
    const keys = newKeyPair();
    const res = await fetch(`${origin}${LINK_PREFIX}pair`, {
      method: "POST",
      redirect: "error",
      signal: AbortSignal.timeout(15_000),
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code, publicKey: keys.publicKey, actions: actionInfos(c) }),
    });
    const data = (await res.json().catch(() => ({}))) as { deviceId?: string; tailnetIp?: string | null; error?: string };
    if (!res.ok || !data.deviceId) throw new Error(data.error || `pairing failed: ${res.status}`);
    mkdirSync(deviceHome(), { recursive: true, mode: 0o700 });
    writeFileSync(keyPath(), keys.privateKey, { mode: 0o600 });
    chmodSync(keyPath(), 0o600);
    saveConfig({ ...c, server: origin, deviceId: data.deviceId });
    audit({ kind: "linked", server: origin, deviceId: data.deviceId });
    console.log(`Linked as "${data.deviceId}" to ${origin}${data.tailnetIp ? ` (address ${data.tailnetIp})` : ""}.`);
    console.log(`Actions come only from ${configPath()}. Start a grant with: omg device run`);
  } finally {
    unlock();
  }
}

async function cmdRun(args: string[]) {
  const { DeviceRuntime } = await import("./runtime.ts");
  const runtime = new DeviceRuntime();
  runtime.start({ minutes: flag(args, "minutes"), idle: flag(args, "idle") }, terminalAsk());
  const stop = () => { void runtime.stop(); process.exitCode = 130; };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  try {
    const state = runtime.snapshot();
    console.log(`Grant for "${state.deviceId}" until ${new Date(state.endsAt!).toLocaleTimeString()}; ends after ${state.idleMinutes} idle minutes. Ctrl-C stops it.`);
    for (const a of state.actions) console.log(`  ${a.name.padEnd(16)} ${a.approval}`);
    if (!process.stdin.isTTY) console.log("No terminal attached: only in-grant actions can run.");
    await runtime.finished;
    const error = runtime.snapshot().error;
    console.log(error ? `Device access stopped: ${error}` : "Device access stopped.");
    if (error && !process.exitCode) process.exitCode = 1;
  } finally {
    process.removeListener("SIGINT", stop);
    process.removeListener("SIGTERM", stop);
  }
}

function cmdStatus() {
  const c = loadConfig();
  console.log(c.deviceId ? `Linked as "${c.deviceId}" to ${c.server}` : "Not linked.");
  console.log(`Config: ${configPath()}`);
  const infos = actionInfos(c);
  if (infos.length === 0) console.log("No actions.");
  for (const a of infos) console.log(`  ${a.name.padEnd(16)} ${a.approval.padEnd(15)} ${a.description ?? ""}`);
}

function cmdCheck(args: string[]) {
  const [name, ...pairs] = args;
  const c = loadConfig();
  const action = name && Object.hasOwn(c.actions, name) ? c.actions[name] : undefined;
  if (!action) throw new Error(`usage: omg device check <action> [name=value ...]. Actions: ${Object.keys(c.actions).join(", ") || "none"}`);
  const given: Record<string, string> = {};
  for (const p of pairs) {
    const i = p.indexOf("=");
    if (i > 0) given[p.slice(0, i)] = p.slice(i + 1);
  }
  const checked = checkArgs(given, action.args ?? {});
  if (!checked.ok) throw new Error(checked.error);
  console.log(buildArgv(action, checked.args, join(outRoot(), "<request>")).map((a) => JSON.stringify(a)).join(" "));
  console.log(`approval: ${action.approval}`);
}

export function unlinkDevice() {
  const unlock = lockDevice(deviceHome());
  try {
    const c = loadConfig();
    rmSync(keyPath(), { force: true });
    const { server: _s, deviceId: _d, ...rest } = c;
    saveConfig(rest as DeviceConfig);
    audit({ kind: "unlinked", deviceId: c.deviceId });
    console.log(`Removed this device's key. Also remove "${c.deviceId ?? "it"}" on the server: omg device remove ${c.deviceId ?? "<name>"}`);
  } finally {
    unlock();
  }
}

// Server-side helpers: talk to the local omg serve, like the MCP tools do.
async function local<T>(path: string, init?: RequestInit): Promise<T> {
  const port = process.env.OMG_PORT || process.env.LFG_PORT || process.env.PORT || "8766";
  const res = await fetch(`http://127.0.0.1:${port}${path}`, init);
  const data = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) throw new Error(data.error || `${res.status} ${res.statusText}`);
  return data as T;
}

async function cmdPair(args: string[]) {
  const name = args[0];
  if (!name) throw new Error("usage: omg device pair <name>   (for example: omg device pair test-mac)");
  const p = await local<{ code: string; name: string; expiresAt: number; server: string | null }>("/api/devices/pairing", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name }),
  });
  const server = p.server || "https://<this computer's tailnet name>";
  console.log(`Pairing code for "${p.name}", valid until ${new Date(p.expiresAt).toLocaleTimeString()}, one use:`);
  console.log(`\n  omg device link --server ${server} --code ${p.code}\n`);
  console.log("Run that on the device, after you write its action config.");
}

async function cmdList() {
  const data = await local<{ devices: Array<{ id: string; lastSeenAt?: number; actions: ActionInfo[] }> }>("/api/devices");
  if (data.devices.length === 0) return console.log("No linked devices.");
  for (const d of data.devices) {
    const seen = d.lastSeenAt ? new Date(d.lastSeenAt).toLocaleString() : "never";
    console.log(`${d.id}  last seen ${seen}  actions: ${d.actions.map((a) => `${a.name}(${a.approval})`).join(", ") || "none"}`);
  }
}

async function cmdRemove(args: string[]) {
  if (!args[0]) throw new Error("usage: omg device remove <name>");
  await local(`/api/devices/${encodeURIComponent(args[0])}`, { method: "DELETE" });
  console.log(`Removed "${args[0]}". Its next call is refused.`);
}

export const DEVICE_HELP = `omg device — link another machine and let agents ask it to run fixed actions

On the omg computer:
  omg device pair <name>        Make a one-use pairing code (10 minutes)
  omg device list               Show linked devices
  omg device remove <name>      Unlink a device now (kill switch)

On the device:
  omg device link --server <url> --code <CODE>
                                Make this device's key and link it
  omg device run [--minutes 120] [--idle 15]
                                Start a grant: fetch requests, ask here, run them
  omg device check <action> [name=value ...]
                                Show the exact command an action would run
  omg device status             Show the link and the actions in the config
  omg device unlink             Delete this device's key

Actions come only from ~/.omg-device/config.json on the device. See docs/device-link.md.`;

export async function cmdDevice(args: string[]) {
  const [verb, ...rest] = args;
  switch (verb) {
    case "pair":
      return cmdPair(rest);
    case "list":
      return cmdList();
    case "remove":
      return cmdRemove(rest);
    case "link":
      return cmdLink(rest);
    case "run":
      return cmdRun(rest);
    case "check":
      return cmdCheck(rest);
    case "status":
      return cmdStatus();
    case "unlink":
      return unlinkDevice();
    default:
      console.log(DEVICE_HELP);
      if (verb && verb !== "help" && verb !== "--help") process.exitCode = 1;
  }
}
