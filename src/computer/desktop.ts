// The Computer: one shared desktop this box owns, and the browser that runs on
// it.
//
// This is deliberately ONE desktop, not one per session. The Settings UI already
// calls this box "the Computer", and a person has one screen, one mouse and one
// keyboard. Sessions take turns on it (see holder/claim below) rather than each
// spawning a display nobody watches.
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
import { existsSync } from "node:fs";

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

export const DEFAULT_DESKTOP: DesktopConfig = {
  display: 99,
  width: 1280,
  height: 800,
  rfbPort: 5900,
  cdpPort: 9222,
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
  /** Session id currently holding the input lock, if any. */
  holder?: string | null;
}

// Module-level singleton: one box, one desktop. A second owner of this state
// would mean two stacks fighting over the same display number and ports.
let state: DesktopState | null = null;

export interface DepReport {
  ok: boolean;
  missing: string[];
  hint: string;
}

const DEPS = [
  { bin: "Xvfb", pkg: "xvfb" },
  { bin: "openbox", pkg: "openbox" },
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
  holder: string | null;
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
      holder: null,
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
    holder: state.holder ?? null,
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
          if (Date.now() > deadline) resolve(false);
          else setTimeout(attempt, 150);
        });
    };
    attempt();
  });
}

/**
 * Start the desktop. Idempotent: a second call while it is up is a no-op and
 * returns the current status, so two sessions racing to open the Computer tab
 * cannot start two stacks.
 */
export async function startDesktop(partial: Partial<DesktopConfig> = {}): Promise<DesktopStatus> {
  if (state) return desktopStatus();

  const deps = ensureDeps();
  if (!deps.ok) throw new Error(deps.hint);

  const config: DesktopConfig = { ...DEFAULT_DESKTOP, ...partial };
  const display = `:${config.display}`;
  const env = { ...process.env, DISPLAY: display };
  const next: DesktopState = { config, holder: null };

  // Xvfb first: everything below needs a display to attach to.
  next.xvfb = spawn(
    "Xvfb",
    [display, "-screen", "0", `${config.width}x${config.height}x24`, "-nolisten", "tcp"],
    { stdio: "ignore", detached: false },
  );
  await Bun.sleep(1200);

  // A window manager, or Chrome opens undecorated and nothing can be focused,
  // moved or raised -- which is most of what "control my desktop" means.
  next.wm = spawn("openbox", [], { stdio: "ignore", env, detached: false });
  await Bun.sleep(400);

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
    `--window-position=0,0`,
    `--window-size=${config.width},${config.height - 40}`,
  ];
  // Guus's setup runs each browser behind a webshare proxy; this is that knob.
  if (config.proxy) chromeArgs.push(`--proxy-server=${config.proxy}`);
  next.chrome = spawn(chrome, chromeArgs, { stdio: "ignore", env, detached: false });

  // Publish the state BEFORE waiting on ports. If a wait fails or throws, the
  // processes we just spawned must still be reachable by stopDesktop -- an
  // early return here used to orphan Xvfb, openbox, x11vnc and Chrome.
  next.startedAt = Date.now();
  state = next;

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
  if (!s) return;
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

/**
 * The input lock. A shared desktop has one cursor, so two agents clicking at
 * once produce garbage. A session claims the computer, acts, then releases.
 * Returns false when someone else holds it.
 */
export function claimComputer(sessionId: string): boolean {
  if (!state) return false;
  if (state.holder && state.holder !== sessionId) return false;
  state.holder = sessionId;
  return true;
}

export function releaseComputer(sessionId: string): void {
  if (state && state.holder === sessionId) state.holder = null;
}

export function computerHolder(): string | null {
  return state?.holder ?? null;
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
