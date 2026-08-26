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
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export interface DesktopConfig {
  /** X display number. 99 keeps us clear of any real session on :0. */
  display: number;
  width: number;
  height: number;
  /** RFB port for x11vnc. Bound to loopback only. */
  rfbPort: number;
  /** Chrome DevTools port. Bound to loopback only. */
  cdpPort: number;
  /** Chrome profile directory. Persistent, so logins survive a restart. */
  profileDir: string;
  /** Optional upstream proxy for Chrome, e.g. a webshare endpoint. */
  proxy?: string;
}

/**
 * A port from the environment, or the default when unset or unparseable.
 *
 * The defaults are fine on a box that runs nothing else, but 9222 is the
 * conventional Chrome debugging port, so it is exactly the one a box is most
 * likely to have already spoken for.
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
  cdpPort: envPort("OMG_COMPUTER_CDP_PORT", 9222),
  profileDir: `${process.env.HOME ?? "/tmp"}/.omg/computer/chrome-profile`,
};

type Proc = ReturnType<typeof spawn>;

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
  adoptedPids?: { xvfb?: number; wm?: number; vnc?: number; chrome?: number };
}

// Module-level singleton: one box, one desktop. A second owner of this state
// would mean two stacks fighting over the same display number and ports.
let state: DesktopState | null = null;

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
const STATE_FILE = `${process.env.HOME ?? "/tmp"}/.omg/computer/desktop.json`;

interface PersistedDesktop {
  config: DesktopConfig;
  pids: { xvfb?: number; wm?: number; vnc?: number; chrome?: number };
  startedAt: number;
}

function writeStateFile(next: DesktopState): void {
  try {
    mkdirSync(dirname(STATE_FILE), { recursive: true });
    const record: PersistedDesktop = {
      config: next.config,
      pids: {
        xvfb: next.xvfb?.pid,
        wm: next.wm?.pid,
        vnc: next.vnc?.pid,
        chrome: next.chrome?.pid,
      },
      startedAt: next.startedAt ?? Date.now(),
    };
    writeFileSync(STATE_FILE, JSON.stringify(record));
  } catch {
    // Losing the record only costs us adoption on the next boot; never fail a
    // working start because the file could not be written.
  }
}

function clearStateFile(): void {
  try {
    rmSync(STATE_FILE, { force: true });
  } catch {}
}

function readStateFile(): PersistedDesktop | null {
  try {
    if (!existsSync(STATE_FILE)) return null;
    return JSON.parse(readFileSync(STATE_FILE, "utf8")) as PersistedDesktop;
  } catch {
    return null;
  }
}

function alive(pid: number | undefined): boolean {
  if (!pid) return false;
  try {
    // Signal 0 tests for existence without touching the process.
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

  const { xvfb, vnc } = record.pids;
  // Xvfb and x11vnc are the two that matter: without them there is no screen
  // and nothing to stream, whatever else survived.
  const healthy =
    alive(xvfb) && alive(vnc) && (await waitForPort(record.config.rfbPort, 1500));

  if (!healthy) {
    for (const pid of Object.values(record.pids)) killPid(pid);
    await Bun.sleep(500);
    for (const pid of Object.values(record.pids)) killPid(pid, "SIGKILL");
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
  };
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
  if (state) return;
  await adoptOrReap();
}

/**
 * Start the desktop. Idempotent: a second call while it is up is a no-op and
 * returns the current status, so two sessions racing to open the Computer tab
 * cannot start two stacks.
 */
export async function startDesktop(partial: Partial<DesktopConfig> = {}): Promise<DesktopStatus> {
  if (state) return desktopStatus();

  // A desktop this box left running survives a server restart. Reattach to it
  // rather than starting a second stack on the same display and ports.
  if (await adoptOrReap()) return desktopStatus();

  const deps = ensureDeps();
  if (!deps.ok) throw new Error(deps.hint);

  const config: DesktopConfig = { ...DEFAULT_DESKTOP, ...partial };

  // Anything already holding these ports is not ours: adoption ran above, and
  // it either reattached or reaped. Refuse now rather than starting a stack
  // that cannot work and cannot report that it does not work.
  const busy = await busyPort(config);
  if (busy !== null) {
    // busyPort checks rfbPort first, so attribute a tie to rfb rather than
    // naming the CDP knob for a port the RFB check matched.
    const knob = busy === config.rfbPort ? "OMG_COMPUTER_RFB_PORT" : "OMG_COMPUTER_CDP_PORT";
    throw new Error(
      `port ${busy} is already in use by another process, so the Computer cannot claim it. ` +
        `Stop whatever holds it, or set ${knob} to a free port and restart the server.`,
    );
  }
  const display = `:${config.display}`;
  const env = { ...process.env, DISPLAY: display };
  const next: DesktopState = { config };

  // Xvfb first: everything below needs a display to attach to.
  next.xvfb = spawn(
    "Xvfb",
    [display, "-screen", "0", `${config.width}x${config.height}x24`, "-nolisten", "tcp"],
    { stdio: "ignore", detached: false },
  );
  await Bun.sleep(1200);

  // The desktop session: wallpaper, panel, file manager, a terminal, and a
  // window manager. This is the difference between streaming a browser and
  // streaming a computer.
  const session = desktopSessionCommand();
  if (!session) throw new Error("no desktop session found (install xfce4 or openbox)");
  next.wm = spawn(session.cmd, session.args, { stdio: "ignore", env, detached: false });
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

  const chrome = chromePath();
  if (!chrome) throw new Error("no Chrome binary found");
  const chromeArgs = [
    `--remote-debugging-port=${config.cdpPort}`,
    `--user-data-dir=${config.profileDir}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-gpu",
    // Deliberately NOT full screen. A maximised Chrome hides the desktop and
    // makes the stream look like a browser again; leaving the edges visible is
    // what makes it read as a computer you could open something else on.
    `--window-position=60,40`,
    `--window-size=${Math.round(config.width * 0.82)},${Math.round(config.height * 0.78)}`,
  ];
  // Guus's setup runs each browser behind a webshare proxy; this is that knob.
  if (config.proxy) chromeArgs.push(`--proxy-server=${config.proxy}`);
  next.chrome = spawn(chrome, chromeArgs, { stdio: "ignore", env, detached: false });

  // Publish the state BEFORE waiting on ports. If a wait fails or throws, the
  // processes we just spawned must still be reachable by stopDesktop -- an
  // early return here used to orphan Xvfb, openbox, x11vnc and Chrome.
  next.startedAt = Date.now();
  state = next;
  writeStateFile(next);

  let rfbUp = false;
  let cdpUp = false;
  try {
    [rfbUp, cdpUp] = await Promise.all([
      waitForPort(config.rfbPort, 10_000),
      waitForPort(config.cdpPort, 20_000),
    ]);
  } catch {
    await stopDesktop();
    throw new Error("the computer failed to start");
  }

  if (!rfbUp || !cdpUp) {
    await stopDesktop();
    throw new Error(
      `computer failed to start (rfb=${rfbUp ? "up" : "down"} cdp=${cdpUp ? "up" : "down"})`,
    );
  }
  return desktopStatus();
}

/** Stop the whole stack, top down. Safe to call when nothing is running. */
export async function stopDesktop(): Promise<void> {
  const s = state;
  state = null;
  clearStateFile();
  if (!s) {
    // Nothing in memory, but a previous process may have left a desktop
    // running. Reap it so "stop" means stopped regardless of who started it.
    const record = readStateFile();
    if (record) {
      for (const pid of Object.values(record.pids)) killPid(pid);
      await Bun.sleep(500);
      for (const pid of Object.values(record.pids)) killPid(pid, "SIGKILL");
    }
    return;
  }

  // An adopted desktop has pids but no child handles.
  if (s.adoptedPids) {
    const pids = Object.values(s.adoptedPids);
    for (const pid of pids) killPid(pid);
    await Bun.sleep(600);
    for (const pid of pids) killPid(pid, "SIGKILL");
    return;
  }

  for (const p of [s.chrome, s.vnc, s.wm, s.xvfb]) {
    try {
      p?.kill("SIGTERM");
    } catch {}
  }
  await Bun.sleep(600);
  for (const p of [s.chrome, s.vnc, s.wm, s.xvfb]) {
    try {
      if (p && p.exitCode == null) p.kill("SIGKILL");
    } catch {}
  }
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

export function rfbPort(): number | null {
  return state?.config.rfbPort ?? null;
}
