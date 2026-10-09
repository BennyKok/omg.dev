// The Computer: one shared desktop this box owns, and the browser that runs on
// it.
//
// This is deliberately ONE desktop, not one per session. The Settings UI already
// calls this box "the Computer", and a person has one screen, one mouse and one
// keyboard, so a display per session would mostly mean displays nobody watches.
//
// There is deliberately no input lock. Agents drive the browser over CDP, into
// a specific tab; a person drives over RFB, at the X level. Those are separate
// channels, so a desktop-wide lock would mostly block the person from their own
// machine. The contention that IS real is agents sharing one browser tab (see
// browser.ts), and the fix for that is a tab per session rather than a mutex
// over the whole screen.
//
// The stack, bottom to top:
//   Xvfb     a virtual X display with no physical screen
//   openbox  a window manager, so windows have decorations and focus
//   x11vnc   exposes that display over RFB on 127.0.0.1 (never the network)
//   chrome   HEADFUL on the display, with remote debugging for the agent
//
// Chrome is headful on purpose. Headless Chrome announces itself in the user
// agent ("HeadlessChrome") and is trivially fingerprinted; headful-under-Xvfb
// is a real browser that happens to have no monitor. Bun.WebView cannot give us
// this by itself -- it spawns headless and throws on `headless: false` -- so we
// launch Chrome ourselves and let Bun.WebView ATTACH over the DevTools socket.
// See browser.ts.
//
// Nothing here is installed by `omg setup`. Chrome is ~134 MB and the X stack a
// few MB more, and v0.1.321 removed the last browser feature precisely because
// every install paid for something most people never ran. `ensureDeps()` reports
// what is missing and the command that fixes it, and the desktop only starts
// when someone asks for it.

import { spawn } from "node:child_process";
import { accessSync, constants, existsSync, mkdirSync, readFileSync, readlinkSync, rmSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { hostname } from "node:os";

export interface DesktopConfig {
  /** X display number. 99 keeps us clear of any real session on :0. */
  display: number;
  width: number;
  height: number;
  /** RFB port for x11vnc. Bound to loopback only. */
  rfbPort: number;
  /** Chrome DevTools port. Zero lets Chrome claim an isolated loopback port. */
  cdpPort: number;
  /** Chrome profile directory. Persistent, so logins survive a restart. */
  profileDir: string;
  /** Optional upstream proxy for Chrome, e.g. a webshare endpoint. */
  proxy?: string;
}

/**
 * A port from the environment, or the default when unset or unparseable.
 *
 * Chrome chooses its own port by default. An explicit nonzero CDP port is
 * retained for installations that require a fixed endpoint.
 */
export function envPort(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 && n < 65536 ? n : fallback;
}

export const DEFAULT_DESKTOP: DesktopConfig = {
  display: envPort("OMG_COMPUTER_DISPLAY", 99),
  width: 1280,
  height: 800,
  rfbPort: envPort("OMG_COMPUTER_RFB_PORT", 5900),
  cdpPort: envPort("OMG_COMPUTER_CDP_PORT", 0),
  // The preferred location. startDesktop() uses computerDir(), which falls
  // back when this one is not writable.
  profileDir: `${process.env.HOME ?? "/tmp"}/.omg/computer/chrome-profile`,
};

/**
 * Where the Computer keeps its desktop record and Chrome profile.
 *
 * ~/.omg/computer when this user can write it. Some hosts create ~/.omg as
 * root (omg.dev Computers baked up to agent-lfg v279 did), and then serve,
 * which runs as the user, cannot create anything under it. Without a record
 * a restarted serve cannot adopt the running desktop and orphans it. So fall
 * back to the XDG state directory and say so once in the log, instead of
 * failing quietly.
 *
 * Exported with injectable probes for tests.
 */
export function resolveComputerDir(
  env: NodeJS.ProcessEnv = process.env,
  writable: (dir: string) => boolean = ensureWritableDir,
  warn: (line: string) => void = (line) => console.warn(line),
): string {
  const home = env.HOME ?? "/tmp";
  const preferred = join(home, ".omg", "computer");
  if (writable(preferred)) return preferred;
  const fallback = join(env.XDG_STATE_HOME || join(home, ".local", "state"), "omg", "computer");
  if (writable(fallback)) {
    warn(
      `[computer] ${preferred} is not writable (check the owner of ${join(home, ".omg")}); ` +
        `using ${fallback} for the desktop record and browser profile`,
    );
    return fallback;
  }
  warn(
    `[computer] neither ${preferred} nor ${fallback} is writable; ` +
      "a restarted server will not find the running desktop",
  );
  return preferred;
}

function ensureWritableDir(dir: string): boolean {
  try {
    mkdirSync(dir, { recursive: true });
    accessSync(dir, constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

let resolvedComputerDir: string | null = null;
/** resolveComputerDir(), once per process. */
export function computerDir(): string {
  resolvedComputerDir ??= resolveComputerDir();
  return resolvedComputerDir;
}

type Proc = ReturnType<typeof spawn>;
const PROCESS_ROLES = ["xvfb", "wm", "vnc", "chrome"] as const;
type ProcessRole = typeof PROCESS_ROLES[number];
type DesktopPids = Partial<Record<ProcessRole, number>>;
interface ProcessIdentity {
  bootId: string;
  startTime: string;
}
type DesktopIdentities = Partial<Record<ProcessRole, ProcessIdentity>>;

interface DesktopState {
  config: DesktopConfig;
  xvfb?: Proc;
  wm?: Proc;
  vnc?: Proc;
  chrome?: Proc;
  startedAt?: number;
  /**
   * Pids of a desktop we adopted after a restart. Set only when this process
   * did not spawn the stack itself, so it has no child handles to kill.
   */
  adoptedPids?: DesktopPids;
  identities: DesktopIdentities;
}

// Module-level singleton: one box, one desktop. A second owner of this state
// would mean two stacks fighting over the same display number and ports.
let state: DesktopState | null = null;

// Adoption, start and stop all mutate the same desktop. In particular, state
// is not ready until the start finishes. Queue callers through this one owner.
let lifecycle: Promise<unknown> = Promise.resolve();
function desktopOperation<T>(action: () => Promise<T>): Promise<T> {
  const result = lifecycle.then(action);
  lifecycle = result.catch(() => {});
  return result;
}

// Where the running desktop is recorded, so a RESTARTED server can find it.
//
// The lifecycle used to live only in this module's memory. When serve exited --
// a crash, a deploy, a systemctl restart -- Xvfb, the session, x11vnc and
// Chrome all kept running, but nothing knew about them: the Computer tab went
// dead while the desktop was still up, and the next start failed because ports
// 5900 and 9222 were taken by processes we no longer had a handle on.
//
// So the pids go on disk. On the next start we ADOPT a desktop that is still
// healthy rather than killing it, which is what makes a server restart
// invisible to whoever is watching the screen and to an agent mid-task.
const stateFile = () => join(computerDir(), "desktop.json");

interface PersistedDesktop {
  config: DesktopConfig;
  pids: DesktopPids;
  /** Absent only in records written before process identity tracking. */
  identities?: DesktopIdentities;
  startedAt: number;
}

function writeStateFile(next: DesktopState): void {
  try {
    const record: PersistedDesktop = {
      config: next.config,
      pids: next.adoptedPids ?? {
        xvfb: next.xvfb?.pid,
        wm: next.wm?.pid,
        vnc: next.vnc?.pid,
        chrome: next.chrome?.pid,
      },
      identities: next.identities,
      startedAt: next.startedAt ?? Date.now(),
    };
    writeFileSync(stateFile(), JSON.stringify(record));
  } catch (error) {
    // Losing the record only costs us adoption on the next boot; never fail a
    // working start because the file could not be written. Say so, because a
    // missing record is what orphans the desktop on the next restart.
    console.warn(`[computer] cannot record the desktop at ${stateFile()}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function clearStateFile(): void {
  try {
    rmSync(stateFile(), { force: true });
  } catch {}
}

function readStateFile(): PersistedDesktop | null {
  try {
    const file = stateFile();
    if (!existsSync(file)) return null;
    const record = JSON.parse(readFileSync(file, "utf8")) as PersistedDesktop;
    if (!record?.config || !record.pids || typeof record.pids !== "object") return null;
    return record;
  } catch {
    return null;
  }
}

/** Linux start ticks plus boot ID distinguish a process from a reused PID. */
function processIdentity(pid: number | undefined): ProcessIdentity | undefined {
  if (!Number.isSafeInteger(pid) || !pid || pid <= 0) return;
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
    // comm can contain spaces and parentheses. Field 22 follows the last ')'.
    const fields = stat.slice(stat.lastIndexOf(")") + 2).trim().split(/\s+/);
    const startTime = fields[19];
    const bootId = readFileSync("/proc/sys/kernel/random/boot_id", "utf8").trim();
    if (fields[0] === "Z" || !startTime || !/^\d+$/.test(startTime) || !bootId) return;
    return { bootId, startTime };
  } catch { return; }
}

function sameProcess(pid: number | undefined, expected: ProcessIdentity | undefined): boolean {
  if (!expected) return false;
  const actual = processIdentity(pid);
  return !!actual && actual.bootId === expected.bootId && actual.startTime === expected.startTime;
}

/** Whether this desktop's process for `role` is still the one it started. */
function roleAlive(s: DesktopState, role: ProcessRole): boolean {
  const pid = s.adoptedPids ? s.adoptedPids[role] : s[role]?.pid;
  return sameProcess(pid, s.identities[role]);
}

// Counts Chrome launches in this process. A cached DevTools attachment from an
// earlier launch points at a browser that no longer exists; consumers compare
// this number to know when to drop it.
let browserLaunches = 0;

/** Changes every time this process launches the desktop's Chrome. */
export function browserGeneration(): number {
  return browserLaunches;
}

/** Legacy PIDs have no start ticks. Require this role's executable and config. */
function legacyProcessMatches(pid: number, role: ProcessRole, config: DesktopConfig): boolean {
  try {
    const executable = basename(readlinkSync(`/proc/${pid}/exe`));
    const args = readFileSync(`/proc/${pid}/cmdline`, "utf8").split("\0").filter(Boolean);
    const display = `:${config.display}`;
    const option = (name: string, value: string) => args[args.indexOf(name) + 1] === value && args.includes(name);
    if (role === "xvfb") return executable === "Xvfb" && args.includes(display);
    const env = readFileSync(`/proc/${pid}/environ`, "utf8").split("\0");
    if (!env.includes(`DISPLAY=${display}`)) return false;
    if (role === "wm") {
      return ["openbox", "xfce4-session", "startxfce4"].includes(executable) ||
        (executable === "dbus-launch" && args.includes("--exit-with-session") && args.some(a => basename(a) === "startxfce4"));
    }
    if (role === "vnc") {
      return executable === "x11vnc" && option("-display", display) &&
        option("-rfbport", String(config.rfbPort)) && args.includes("-localhost");
    }
    return ["chrome", "google-chrome", "google-chrome-stable", "chromium", "chromium-browser"].includes(executable) &&
      args.includes(`--user-data-dir=${config.profileDir}`) && !args.some(a => a.startsWith("--type=")) &&
      (args.includes(`--remote-debugging-port=${config.cdpPort}`) || args.includes("--remote-debugging-port=0"));
  } catch { return false; }
}

/** Normalize legacy records once. Never replace a mismatched saved identity. */
function verifiedIdentities(record: PersistedDesktop): DesktopIdentities {
  const identities: DesktopIdentities = {};
  for (const role of PROCESS_ROLES) {
    const pid = record.pids?.[role];
    const actual = processIdentity(pid);
    if (!actual) continue;
    if (record.identities === undefined
      ? legacyProcessMatches(pid!, role, record.config)
      : sameProcess(pid, record.identities?.[role])) identities[role] = actual;
  }
  return identities;
}

function killPid(pid: number | undefined, identity: ProcessIdentity | undefined, signal: NodeJS.Signals = "SIGTERM"): void {
  // Recheck before EACH signal, including escalation after the grace period.
  if (!sameProcess(pid, identity)) return;
  try { process.kill(pid!, signal); } catch {}
}

async function reapProcesses(pids: DesktopPids, identities: DesktopIdentities): Promise<void> {
  for (const role of [...PROCESS_ROLES].reverse()) killPid(pids[role], identities[role]);
  await Bun.sleep(600);
  for (const role of [...PROCESS_ROLES].reverse()) killPid(pids[role], identities[role], "SIGKILL");
}

/**
 * Reattach to a desktop this box left running, or clean up its remains.
 *
 * Returns true when a healthy desktop was adopted. Called before we consider
 * starting a new one, so a restarted server neither orphans the old stack nor
 * trips over the ports it still holds.
 */
async function adoptOrReap(): Promise<boolean> {
  const record = readStateFile();
  if (!record) return false;

  const identities = verifiedIdentities(record);
  // An interrupted start can leave a record with cdpPort=0. It is not ready
  // for adoption until Chrome's assigned endpoint has been persisted.
  const healthy =
    !!identities.xvfb && !!identities.vnc && !!identities.chrome &&
    PROCESS_ROLES.every(role => record.pids?.[role] === undefined || !!identities[role]) && record.config.cdpPort > 0 &&
    (await waitForPort(record.config.rfbPort, 1500)) && (await waitForPort(record.config.cdpPort, 1500)) &&
    // The probes await I/O. Recheck every role immediately before adoption.
    PROCESS_ROLES.every(role => record.pids[role] === undefined || sameProcess(record.pids[role], identities[role]));

  if (!healthy) {
    await reapProcesses(record.pids ?? {}, identities);
    clearStateFile();
    // kill() returns before the kernel finishes tearing the process down, and
    // a listening socket keeps accepting until it does. startDesktop() checks
    // for busy ports immediately after this returns, so without this wait a
    // reap could make the very next start refuse a port it had just freed
    // itself -- worst on a loaded box, which is exactly when a stack is found
    // unhealthy in the first place.
    await waitForPortsFree([record.config.rfbPort, record.config.cdpPort], 3000);
    return false;
  }

  // Adopt. We have pids but no child handles, so stopDesktop() works off the
  // persisted pids for an adopted desktop -- see the adoptedPids branch there.
  state = {
    config: record.config,
    startedAt: record.startedAt,
    adoptedPids: record.pids,
    identities,
  };
  // Upgrade a verified legacy record so later restarts also detect PID reuse.
  if (record.identities === undefined) writeStateFile(state);
  return true;
}

export interface DepReport {
  ok: boolean;
  missing: string[];
  hint: string;
}

const DEPS = [
  { bin: "Xvfb", pkg: "xvfb" },
  // A full desktop session, not just a window manager. openbox alone draws a
  // title bar and nothing else, so a single maximised Chrome looks like a
  // kiosk browser rather than a computer -- no wallpaper, no panel, no way to
  // launch anything else. xfce4 gives a desktop you can actually use; openbox
  // stays as a fallback so a box without xfce still gets a usable screen.
  { bin: "startxfce4", pkg: "xfce4", alt: ["startxfce4", "xfce4-session", "openbox"] },
  { bin: "x11vnc", pkg: "x11vnc" },
  { bin: "google-chrome", pkg: "google-chrome-stable", alt: ["chromium", "chromium-browser", "google-chrome-stable"] },
];

function which(bin: string): string | null {
  const dirs = (process.env.PATH ?? "").split(":");
  for (const d of dirs) {
    if (!d) continue;
    const p = `${d}/${bin}`;
    if (existsSync(p)) return p;
  }
  return null;
}

/** Which parts of the stack are installed. Never throws. */
export function ensureDeps(): DepReport {
  const missing: string[] = [];
  for (const dep of DEPS) {
    const candidates = dep.alt ?? [dep.bin];
    if (!candidates.some((c) => which(c))) missing.push(dep.pkg);
  }
  return {
    ok: missing.length === 0,
    missing,
    hint: missing.length
      ? `Install the computer dependencies: sudo apt-get install -y ${missing.join(" ")}`
      : "",
  };
}

/**
 * How to start the desktop session, best first.
 *
 * xfce4 wants a session D-Bus; `dbus-launch` provides one when we are not
 * already inside a session bus, and without it the panel and settings daemon
 * die on startup leaving a blank root window.
 */
export function desktopSessionCommand(): { cmd: string; args: string[] } | null {
  const startxfce4 = which("startxfce4");
  if (startxfce4) {
    const dbus = which("dbus-launch");
    return dbus
      ? { cmd: dbus, args: ["--exit-with-session", startxfce4] }
      : { cmd: startxfce4, args: [] };
  }
  const xfceSession = which("xfce4-session");
  if (xfceSession) return { cmd: xfceSession, args: [] };
  const openbox = which("openbox");
  if (openbox) return { cmd: openbox, args: [] };
  return null;
}

/** The Chrome binary to drive, or null when none is installed. */
export function chromePath(): string | null {
  for (const c of ["google-chrome", "google-chrome-stable", "chromium", "chromium-browser"]) {
    const p = which(c);
    if (p) return p;
  }
  return null;
}

export interface DesktopStatus {
  running: boolean;
  display: string | null;
  rfbPort: number | null;
  cdpPort: number | null;
  width: number;
  height: number;
  startedAt: number | null;
  /** False when the desktop is up but its Chrome has exited. Start relaunches it. */
  browserRunning: boolean;
  deps: DepReport;
}

export function desktopStatus(): DesktopStatus {
  const deps = ensureDeps();
  if (!state) {
    return {
      running: false,
      display: null,
      rfbPort: null,
      cdpPort: null,
      width: DEFAULT_DESKTOP.width,
      height: DEFAULT_DESKTOP.height,
      startedAt: null,
      browserRunning: false,
      deps,
    };
  }
  return {
    running: true,
    display: `:${state.config.display}`,
    rfbPort: state.config.rfbPort,
    cdpPort: state.config.cdpPort,
    width: state.config.width,
    height: state.config.height,
    startedAt: state.startedAt ?? null,
    browserRunning: roleAlive(state, "chrome"),
    deps,
  };
}

function waitForPort(port: number, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve) => {
    const attempt = () => {
      Bun.connect({
        hostname: "127.0.0.1",
        port,
        socket: {
          // Bun requires at least a `data` or `drain` handler; we only care
          // that the connection was accepted, so this is a no-op.
          data() {},
          open(s) {
            s.end();
            resolve(true);
          },
          error() {},
        },
      })
        .then((s) => {
          s.end();
          resolve(true);
        })
        .catch(() => {
          // `>=`, not `>`: a refused connect returns inside the same
          // millisecond, so with timeoutMs 0 a strict `>` compared equal and
          // scheduled a pointless 150ms retry. Zero now means one attempt,
          // which is what every busy-port probe here asks for.
          if (Date.now() >= deadline) resolve(false);
          else setTimeout(attempt, 150);
        });
    };
    attempt();
  });
}

/**
 * Block until nothing answers on `ports`, or until `timeoutMs` runs out.
 *
 * Returns true when every port went quiet. A false return is not fatal on its
 * own: the caller reports the busy port normally, which is the honest outcome
 * when something really is still holding it.
 */
async function waitForPortsFree(ports: number[], timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    let busy = false;
    for (const port of ports) {
      if (await waitForPort(port, 0)) {
        busy = true;
        break;
      }
    }
    if (!busy) return true;
    if (Date.now() >= deadline) return false;
    await Bun.sleep(100);
  }
}

/**
 * The first configured port already answering, or null when both are free.
 *
 * `waitForPort` only proves that *something* accepted a connection; it cannot
 * tell our own Chrome from a stranger's. So a box that already has a browser on
 * 9222 used to get a start that reported success: Chrome failed to bind its
 * debugging port and exited, `waitForPort` saw the other process listening and
 * called it healthy, and every agent then drove that browser instead of the one
 * on the screen being watched -- with an empty desktop as the only symptom.
 *
 * Checking before we spawn anything turns that into an error you can act on.
 */
export async function busyPort(config: DesktopConfig): Promise<number | null> {
  for (const port of [config.rfbPort, config.cdpPort]) {
    if (port === 0) continue;
    if (await waitForPort(port, 0)) return port;
  }
  return null;
}

/**
 * Reattach to a desktop left by a previous server process, if there is one.
 *
 * `desktopStatus()` is synchronous and adoption needs to probe a port, so the
 * read paths call this first. Without it a restarted server reports "stopped"
 * for a desktop that is plainly still running, and the person watching has to
 * press Start on something already started.
 */
export async function ensureDesktopAdopted(): Promise<void> {
  await desktopOperation(async () => {
    if (!state) await adoptOrReap();
  });
}

/**
 * Start the desktop. Idempotent: a second call while it is up is a no-op and
 * returns the current status, so two sessions racing to open the Computer tab
 * cannot start two stacks.
 */
export async function startDesktop(partial: Partial<DesktopConfig> = {}): Promise<DesktopStatus> {
  return desktopOperation(() => startDesktopOwned(partial));
}

async function startDesktopOwned(partial: Partial<DesktopConfig>): Promise<DesktopStatus> {
  if (state) {
    const screenUp = roleAlive(state, "xvfb") && roleAlive(state, "vnc");
    if (screenUp && roleAlive(state, "chrome")) return desktopStatus();
    if (screenUp) {
      await relaunchBrowser(state);
      return desktopStatus();
    }
    // The display or the stream is gone, so nothing on it can be reused.
    await stopDesktopOwned();
  }

  // A desktop this box left running survives a server restart. Reattach to it
  // rather than starting a second stack on the same display and ports.
  if (await adoptOrReap()) return desktopStatus();

  const deps = ensureDeps();
  if (!deps.ok) throw new Error(deps.hint);

  const config: DesktopConfig = { ...DEFAULT_DESKTOP, profileDir: join(computerDir(), "chrome-profile"), ...partial };

  // Anything already holding these ports is not ours: adoption ran above, and
  // it either reattached or reaped. Refuse now rather than starting a stack
  // that cannot work and cannot report that it does not work.
  const busy = await busyPort(config);
  if (busy !== null) {
    console.warn(`[computer] configured port ${busy} is in use`);
    throw new Error("The Computer cannot open its browser. Try again or contact support.");
  }
  const next: DesktopState = { config, identities: {} };
  state = next;
  try {
    return await launchDesktop(next);
  } catch (error) {
    if (state === next) await stopDesktopOwned();
    throw error;
  }
}

async function launchDesktop(next: DesktopState): Promise<DesktopStatus> {
  const config = next.config;
  const display = `:${config.display}`;
  const env = { ...process.env, DISPLAY: display };
  // Xvfb first: everything below needs a display to attach to.
  next.xvfb = spawn(
    "Xvfb",
    [display, "-screen", "0", `${config.width}x${config.height}x24`, "-nolisten", "tcp"],
    { stdio: "ignore", detached: false },
  );
  next.identities.xvfb = processIdentity(next.xvfb.pid);
  await Bun.sleep(1200);

  // The desktop session: wallpaper, panel, file manager, a terminal, and a
  // window manager. This is the difference between streaming a browser and
  // streaming a computer.
  const session = desktopSessionCommand();
  if (!session) throw new Error("no desktop session found (install xfce4 or openbox)");
  disableScreenLock(process.env.XDG_CONFIG_HOME || join(process.env.HOME ?? "/tmp", ".config"));
  next.wm = spawn(session.cmd, session.args, { stdio: "ignore", env, detached: false });
  next.identities.wm = processIdentity(next.wm.pid);
  // xfce4 has a panel, a settings daemon and a desktop to bring up, so it needs
  // longer than a bare window manager before anything else should appear.
  await Bun.sleep(3500);

  // -localhost is the security boundary: the RFB port never leaves this box.
  // The browser reaches it through our own websocket bridge in serve.ts, which
  // is already authenticated, so x11vnc itself needs no password of its own.
  next.vnc = spawn(
    "x11vnc",
    [
      "-display", display,
      "-localhost",
      "-rfbport", String(config.rfbPort),
      "-nopw",
      "-forever",
      "-shared",
      "-noxdamage",
      "-repeat",
    ],
    { stdio: "ignore", env, detached: false },
  );

  next.identities.vnc = processIdentity(next.vnc.pid);

  await spawnBrowser(next);
  // Publish the state BEFORE waiting on ports. If a wait fails or throws, the
  // processes we just spawned must still be reachable by stopDesktop -- an
  // early return here used to orphan Xvfb, openbox, x11vnc and Chrome.
  next.startedAt = Date.now();
  state = next;
  writeStateFile(next);

  const [rfbUp, cdpUp] = await Promise.all([
    waitForPort(config.rfbPort, 10_000),
    waitForBrowser(next),
  ]);
  if (!rfbUp || !cdpUp) throw new Error("The Computer could not start its browser. Try again.");
  // The Chrome-assigned port is the runtime endpoint. Persist it for adoption
  // and use it for every browser/kiosk consumer, without changing the profile.
  writeStateFile(next);
  return desktopStatus();
}

/** Match only a kiosk launcher that took over this Computer's own profile. */
export function isOrphanKioskBrowser(executable: string, args: string[], config: DesktopConfig): boolean {
  // Chrome rewrites /proc/cmdline to one space-separated process title.
  const title = ` ${args.join(" ").trim()} `;
  return ["chrome", "google-chrome", "google-chrome-stable", "chromium", "chromium-browser"].includes(basename(executable)) &&
    title.includes(` --user-data-dir=${config.profileDir} `) && title.includes(" --app=") &&
    !title.includes(" --type=") && !title.includes(" --remote-debugging-port=");
}

async function reapOrphanKioskBrowsers(config: DesktopConfig): Promise<void> {
  if (process.platform !== "linux") return;
  let pid: number;
  let identity: ProcessIdentity | undefined;
  try {
    const lock = readlinkSync(join(config.profileDir, "SingletonLock"));
    const prefix = `${hostname()}-`;
    if (!lock.startsWith(prefix) || !/^\d+$/.test(lock.slice(prefix.length))) return;
    pid = Number(lock.slice(prefix.length));
    if (statSync(`/proc/${pid}`).uid !== process.getuid?.()) return;
    const args = readFileSync(`/proc/${pid}/cmdline`, "utf8").split("\0");
    if (!isOrphanKioskBrowser(readlinkSync(`/proc/${pid}/exe`), args, config)) return;
    identity = processIdentity(pid);
    if (!identity) return;
  } catch { return; }
  console.warn("[computer] recovering orphan kiosk browser holding the Computer profile");
  killPid(pid, identity);
  await Bun.sleep(600);
  killPid(pid, identity, "SIGKILL");
}

/** Spawn the desktop's Chrome on its display. Does not wait for readiness. */
async function spawnBrowser(next: DesktopState): Promise<void> {
  const config = next.config;
  const env = { ...process.env, DISPLAY: `:${config.display}` };
  const chrome = chromePath();
  if (!chrome) throw new Error("no Chrome binary found");
  await reapOrphanKioskBrowsers(config);
  disablePasswordSaving(config.profileDir);
  // Chrome writes this file only with --remote-debugging-port=0. Remove an
  // old endpoint before launching, so a failed start cannot attach elsewhere.
  if (config.cdpPort === 0) rmSync(join(config.profileDir, "DevToolsActivePort"), { force: true });
  const chromeArgs = [
    `--remote-debugging-port=${config.cdpPort}`,
    "--remote-debugging-address=127.0.0.1",
    `--user-data-dir=${config.profileDir}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-gpu",
    // Firecracker guests booted from an older rootfs have no /dev/shm. Chrome
    // aborts at start without it ("Unable to access /dev/shm"), which reads as
    // "rfb=up cdp=down". Keep Chrome's shared memory in /tmp instead.
    "--disable-dev-shm-usage",
    // Deliberately NOT full screen. A maximised Chrome hides the desktop and
    // makes the stream look like a browser again; leaving the edges visible is
    // what makes it read as a computer you could open something else on.
    `--window-position=60,40`,
    `--window-size=${Math.round(config.width * 0.82)},${Math.round(config.height * 0.78)}`,
  ];
  // Guus's setup runs each browser behind a webshare proxy; this is that knob.
  if (config.proxy) chromeArgs.push(`--proxy-server=${config.proxy}`);
  next.chrome = spawn(chrome, chromeArgs, { stdio: "ignore", env, detached: false });
  next.identities.chrome = processIdentity(next.chrome.pid);
  browserLaunches++;
}

function waitForBrowser(next: DesktopState): Promise<boolean> {
  return next.config.cdpPort === 0 ? waitForChromePort(next, 20_000) : waitForPort(next.config.cdpPort, 20_000);
}

/**
 * Bring back a Chrome that exited under a desktop that is still up.
 *
 * Chrome can die on its own while Xvfb, the session and x11vnc keep running.
 * On 2026-10-04 its browser process took a SIGSEGV right after a raw CDP
 * Emulation call. Start used to see the desktop and report it running, so
 * every browser tool failed with "cannot reach the desktop browser's DevTools
 * endpoint" until someone stopped the whole desktop by hand. Relaunch only
 * Chrome: the screen, the stream and the person watching it stay put. The
 * profile keeps its sign-ins.
 */
async function relaunchBrowser(s: DesktopState): Promise<void> {
  // A Chrome-assigned port died with the old browser. Ask for a new one.
  // Keep only a fixed port that the installation configured.
  if (DEFAULT_DESKTOP.cdpPort === 0 || s.config.cdpPort !== DEFAULT_DESKTOP.cdpPort) s.config.cdpPort = 0;
  else if (await waitForPort(s.config.cdpPort, 0)) {
    console.warn(`[computer] configured port ${s.config.cdpPort} is in use`);
    throw new Error("The Computer cannot open its browser. Try again or contact support.");
  }
  await spawnBrowser(s);
  // An adopted desktop is stopped through its recorded pids.
  if (s.adoptedPids) s.adoptedPids.chrome = s.chrome?.pid;
  writeStateFile(s);
  if (!(await waitForBrowser(s))) {
    killPid(s.chrome?.pid, s.identities.chrome, "SIGKILL");
    throw new Error("The Computer could not start its browser. Try again.");
  }
  writeStateFile(s);
}

async function waitForChromePort(next: DesktopState, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (next.chrome?.exitCode !== null) return false;
    try {
      const [portText, path] = readFileSync(join(next.config.profileDir, "DevToolsActivePort"), "utf8").trim().split("\n");
      const port = Number(portText);
      if (Number.isInteger(port) && port > 0 && port < 65536 && path?.startsWith("/devtools/browser/")) {
        const response = await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(1000) });
        const body = await response.json() as { webSocketDebuggerUrl?: string };
        if (response.ok && body.webSocketDebuggerUrl === `ws://127.0.0.1:${port}${path}`) {
          next.config.cdpPort = port;
          return true;
        }
      }
    } catch { /* Chrome has not published its endpoint yet. */ }
    await Bun.sleep(100);
  }
  return false;
}

/** Stop the whole stack, top down. Safe to call when nothing is running. */
export async function stopDesktop(): Promise<void> {
  await desktopOperation(stopDesktopOwned);
}

async function stopDesktopOwned(): Promise<void> {
  const s = state;
  const record = s ? null : readStateFile();
  state = null;
  clearStateFile();
  if (!s) {
    // Only verified processes from a previous owner may be stopped.
    if (record) await reapProcesses(record.pids ?? {}, verifiedIdentities(record));
    return;
  }

  const pids = s.adoptedPids ?? Object.fromEntries(PROCESS_ROLES.map(role => [role, s[role]?.pid]));
  await reapProcesses(pids, s.identities);
}

/** The DevTools websocket URL Bun.WebView attaches to, or null when down. */
export async function cdpWebSocketUrl(): Promise<string | null> {
  if (!state) return null;
  try {
    const res = await fetch(`http://127.0.0.1:${state.config.cdpPort}/json/version`);
    if (!res.ok) return null;
    const body = (await res.json()) as { webSocketDebuggerUrl?: string };
    return body.webSocketDebuggerUrl ?? null;
  } catch {
    return null;
  }
}

/**
 * Turn off Chrome's "Save password?" offer in the Computer's browser.
 *
 * People type passwords into this browser from an omg sheet (the Expo
 * sign-in, see kiosk.ts). omg never keeps those passwords, so the browser
 * must not keep them either, and Chrome's bubble must not cover the page the
 * person is signing in on. Chrome reads the profile's Preferences file at
 * start, so this runs before Chrome does.
 * @internal exported for tests.
 */
export function disablePasswordSaving(profileDir: string): void {
  const file = `${profileDir}/Default/Preferences`;
  try {
    let prefs: Record<string, any> = {};
    try { prefs = JSON.parse(readFileSync(file, "utf8")); } catch { /* A new profile. */ }
    if (prefs.credentials_enable_service === false && prefs.profile?.password_manager_enabled === false) return;
    prefs.credentials_enable_service = false;
    prefs.profile = { ...(prefs.profile ?? {}), password_manager_enabled: false };
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify(prefs));
  } catch {
    // A profile Chrome cannot use would fail the start anyway, with a clearer error.
  }
}

/**
 * xfce4-screensaver settings with the saver and the lock off. Written as the
 * xfconf channel file because the screensaver also starts through D-Bus
 * activation (org.xfce.ScreenSaver), so turning off its autostart entry is
 * not enough. Every launch path reads this channel.
 */
export const SCREEN_LOCK_OFF_XML = `<?xml version="1.0" encoding="UTF-8"?>
<channel name="xfce4-screensaver" version="1.0">
  <property name="saver" type="empty">
    <property name="enabled" type="bool" value="false"/>
    <property name="idle-activation" type="empty">
      <property name="enabled" type="bool" value="false"/>
    </property>
  </property>
  <property name="lock" type="empty">
    <property name="enabled" type="bool" value="false"/>
    <property name="saver-activation" type="empty">
      <property name="enabled" type="bool" value="false"/>
    </property>
  </property>
</channel>
`;

/**
 * Keep the desktop session from locking the screen.
 *
 * xfce4-screensaver locks the screen after a few idle minutes and asks for the
 * Linux user's password. Nobody who watches the Computer has that password,
 * and the screen is already behind omg sign-in, so the lock only shuts the
 * person out. xfconfd reads the channel file at start, so this runs before
 * the session does.
 * @internal exported for tests.
 */
export function disableScreenLock(configHome: string): void {
  const dir = join(configHome, "xfce4", "xfconf", "xfce-perchannel-xml");
  try {
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "xfce4-screensaver.xml"), SCREEN_LOCK_OFF_XML);
  } catch {
    // A read-only config directory leaves the session as it was. It still starts.
  }
}

/** The running desktop's configuration, or null when it is down. */
export function desktopConfig(): DesktopConfig | null {
  return state ? { ...state.config } : null;
}

export function rfbPort(): number | null {
  return state?.config.rfbPort ?? null;
}
