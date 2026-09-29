import { existsSync, readFileSync, readlinkSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, join } from "node:path";
import type { ProjectPreview } from "../packages/protocol/src/project-preview.ts";
import type { ExpoAccountSnapshot, ExpoConnectMode, ExpoConnectStatus } from "../packages/protocol/src/expo-account.ts";
import { expoConnectActive } from "../packages/protocol/src/expo-account.ts";
import { PATHS } from "./config.ts";

/**
 * "Connect Expo": sign in this Computer's Expo CLI so Expo Go on an iPhone
 * accepts its previews.
 *
 * Expo Go on a physical iPhone refuses a dev server whose manifest does not
 * name the signed-in Expo CLI account (`extra.expoGo.username`). The card asks
 * this service first. When the CLI is not signed in, "Connect Expo" runs
 * `expo login --browser` here with the xdg-open shim, so expo.dev opens in the
 * Computer's desktop browser. The user signs in there, the localhost callback
 * completes on the Computer, and this service checks the account, restarts
 * Metro when its manifest still has no account, and reports "done".
 *
 * "Create free account" (`mode: "signup"`) first opens expo.dev/signup in the
 * same Computer browser. The user creates their own account there; omg never
 * signs up on their behalf, because Expo's terms forbid automated sign-ups.
 * Once the browser is signed in to expo.dev, the same `expo login --browser`
 * runs, and its page can approve with that browser session.
 *
 * Both pages open in the Computer kiosk (src/computer/kiosk.ts): a phone-width
 * app window that the card shows in a sheet, cut out of the Computer stream.
 * The person types into Expo's real page there. omg never sees the password
 * and never fills in or submits the form.
 *
 * One login runs at a time: the Expo account belongs to the Computer, not to
 * a session.
 */

export const XDG_OPEN_SHIM_DIR = join(PATHS.root, "agents", "bin");
const LOGIN_TIMEOUT_MS = 10 * 60_000;
const SIGNUP_TIMEOUT_MS = 30 * 60_000;
const SIGNUP_POLL_MS = 2_000;
export const EXPO_SIGNUP_URL = "https://expo.dev/signup";
const MAX_BODY = 4 * 1024;

type Session = { id: string; owner: string | null; cwd: string | null };
export type LoginProcess = { exited: Promise<number>; kill(): void; output(): string };

class AccountError extends Error {
  constructor(public code: number, message: string) { super(message); }
}

/**
 * The account in `~/.expo/state.json`, the file `expo login` writes. Reading it
 * is instant and needs no network, so the card can poll it. `expo whoami` is
 * the stronger check and runs once after a login.
 * @internal exported for tests.
 */
export function readExpoStateAccount(home: string): string | null {
  try {
    const state = JSON.parse(readFileSync(join(home, ".expo", "state.json"), "utf8")) as {
      auth?: { username?: unknown; sessionSecret?: unknown } | null;
    };
    const auth = state.auth;
    if (!auth || typeof auth.sessionSecret !== "string" || !auth.sessionSecret) return null;
    return typeof auth.username === "string" && auth.username ? auth.username : null;
  } catch {
    return null;
  }
}

/** The account `expo whoami` prints, or null for "Not logged in". @internal exported for tests. */
export function parseWhoami(stdout: string): string | null {
  const line = stdout.split("\n").map((l) => l.trim()).find(Boolean) ?? "";
  if (!line || /not logged in/i.test(line)) return null;
  // Newer CLIs can append details such as "(robot)". The name is the first word.
  const name = line.split(/\s+/)[0]!;
  return /^[A-Za-z0-9_.-]+$/.test(name) ? name : null;
}

/** The account the Expo Go manifest names, from the JSON Metro serves to iOS. @internal exported for tests. */
export function manifestUsername(body: string): string | null {
  try {
    const value = JSON.parse(body) as { extra?: { expoGo?: { username?: unknown } } };
    const name = value.extra?.expoGo?.username;
    return typeof name === "string" && name ? name : null;
  } catch {
    return null;
  }
}

/** True when some directory on PATH, other than the shim's own, has xdg-open. */
export function systemHasXdgOpen(path = process.env.PATH ?? ""): boolean {
  return path.split(delimiter).some((dir) => dir && dir !== XDG_OPEN_SHIM_DIR && existsSync(join(dir, "xdg-open")));
}

/**
 * Put the shim on PATH for this process and every child it starts, but only
 * when the system has no xdg-open. A laptop keeps its own.
 */
export function installXdgOpenShim(env: NodeJS.ProcessEnv = process.env, port?: number): boolean {
  if (port) env.OMG_COMPUTER_API ??= `http://127.0.0.1:${port}`;
  const path = env.PATH ?? "";
  if (path.split(delimiter).includes(XDG_OPEN_SHIM_DIR)) return true;
  if (systemHasXdgOpen(path) || !existsSync(join(XDG_OPEN_SHIM_DIR, "xdg-open"))) return false;
  env.PATH = path ? `${XDG_OPEN_SHIM_DIR}${delimiter}${path}` : XDG_OPEN_SHIM_DIR;
  return true;
}

/** The working directory of the Metro process on `port`, from /proc. */
export function metroCwd(port: number): string | null {
  const found = Bun.spawnSync(["pgrep", "-f", `expo start .*--port ${port}`], { stdout: "pipe", stderr: "ignore" });
  for (const pid of new TextDecoder().decode(found.stdout).split("\n").map((s) => s.trim()).filter(Boolean)) {
    try { return readlinkSync(`/proc/${pid}/cwd`); } catch { /* It exited. */ }
  }
  return null;
}

export type ExpoAccountDeps = {
  session(id: string): Promise<Session | null>;
  viewer(req: Request): string;
  preview(sessionId: string): ProjectPreview | null;
  startDesktop(): Promise<unknown>;
  /** Open a page in the Computer's kiosk window, which the card shows in a sheet. */
  openBrowser(url: string): Promise<unknown>;
  /** Close that window. Called once a connect run ends. */
  closeBrowser?(): Promise<unknown>;
  /** True when the Computer browser holds an expo.dev sign-in. */
  webSignedIn(): Promise<boolean>;
  /** Start `expo login --browser`. */
  spawnLogin(expo: string, cwd: string): LoginProcess;
  /** Run a command to completion. */
  run(argv: string[], cwd: string, timeoutMs: number): Promise<{ code: number; stdout: string; stderr: string }>;
  /** The Expo Go manifest body Metro serves for iOS, or null when Metro does not answer. */
  manifest(port: number): Promise<string | null>;
  metroCwd(port: number): string | null;
  /** Ask the session agent for a step this service cannot do itself. */
  tellAgent(sessionId: string, text: string): Promise<void>;
  home?: string;
  now?: () => number;
  loginTimeoutMs?: number;
  signupTimeoutMs?: number;
  signupPollMs?: number;
};

export function createExpoAccountService(deps: ExpoAccountDeps) {
  const home = deps.home ?? process.env.HOME ?? homedir();
  const now = deps.now ?? Date.now;
  let status: ExpoConnectStatus | undefined;
  let login: LoginProcess | null = null;
  let cancelled = false;
  let cached: { mtimeMs: number; username: string | null } | null = null;
  const owns = (owner: string | null, viewer: string) => !owner || owner.toLowerCase() === viewer.toLowerCase();

  /**
   * End the run. The sign-in sheet shows the kiosk window, and that window
   * has no job once the run is done, failed or cancelled.
   */
  function end(next: ExpoConnectStatus): void {
    status = next;
    void deps.closeBrowser?.().catch(() => {});
  }

  function account(): string | null {
    const path = join(home, ".expo", "state.json");
    let mtimeMs = -1;
    try { mtimeMs = statSync(path).mtimeMs; } catch { /* No file: signed out. */ }
    if (cached?.mtimeMs === mtimeMs) return cached.username;
    const username = mtimeMs < 0 ? null : readExpoStateAccount(home);
    cached = { mtimeMs, username };
    return username;
  }

  function snapshot(): ExpoAccountSnapshot {
    const username = account();
    return { signedIn: username !== null, ...(username ? { username } : {}), ...(status ? { connect: status } : {}) };
  }

  /** The Expo project to run the CLI in: Metro's own directory first, then the session's. */
  function projectDir(session: Session, preview: ProjectPreview | null): string {
    const metro = preview ? deps.metroCwd(preview.port) : null;
    for (const dir of [metro, session.cwd]) {
      if (dir && existsSync(join(dir, "node_modules", ".bin", "expo"))) return dir;
    }
    throw new AccountError(409, "Expo CLI is not installed in this project. Start the Expo preview first.");
  }

  async function finish(session: Session, preview: ProjectPreview | null, dir: string, code: number): Promise<void> {
    if (cancelled) { end({ state: "cancelled", startedAt: status!.startedAt }); return; }
    if (code !== 0) {
      const tail = login?.output().trim().split("\n").filter(Boolean).pop();
      end({ state: "failed", startedAt: status!.startedAt, message: `Expo sign-in did not finish${tail ? `: ${tail.slice(0, 160)}` : "."} Try again.` });
      return;
    }
    // The CLI has its account. The sign-in page has no job any more.
    const started = status!.startedAt;
    end({ state: "verifying", startedAt: started });
    const who = await deps.run([join(dir, "node_modules", ".bin", "expo"), "whoami"], dir, 60_000).catch(() => null);
    const username = who ? parseWhoami(who.stdout) : null;
    cached = null;
    if (!username) {
      end({ state: "failed", startedAt: started, message: "Expo CLI still reports no account. Try again." });
      return;
    }
    const done = { state: "done" as const, startedAt: started, message: `Signed in to Expo as ${username}.` };
    if (!preview?.expoGoUrl) { end(done); return; }
    const before = await deps.manifest(preview.port);
    if (before === null || manifestUsername(before) === username) { end(done); return; }
    // Metro read the signed-out state when it started. Restart it with the
    // same proxy URL so the manifest names the account.
    status = { state: "restarting", startedAt: started };
    const script = join(dir, "scripts", "start-expo-preview.sh");
    const proxyUrl = `https://${preview.expoGoUrl.slice("exps://".length)}`;
    if (existsSync(script)) {
      const restarted = await deps.run(["bash", script, proxyUrl, String(preview.port)], dir, 300_000).catch(() => null);
      const after = restarted?.code === 0 ? await deps.manifest(preview.port) : null;
      if (after !== null && manifestUsername(after) === username) { end(done); return; }
    }
    await deps.tellAgent(session.id, `Expo CLI on this Computer is now signed in as ${username}, but Metro on port ${preview.port} still serves a manifest without that account. Restart Metro for the Expo Go preview (bash scripts/start-expo-preview.sh ${proxyUrl} ${preview.port}) so Expo Go on an iPhone accepts it.`).catch(() => {});
    end({ ...done, message: `Signed in to Expo as ${username}. The agent restarts the preview.` });
  }

  function startLogin(session: Session, preview: ProjectPreview | null, dir: string, started: number): void {
    status = { state: "waiting", startedAt: started };
    const proc = deps.spawnLogin(join(dir, "node_modules", ".bin", "expo"), dir);
    login = proc;
    const timer = setTimeout(() => {
      if (login === proc && status?.state === "waiting") {
        cancelled = true;
        proc.kill();
        end({ state: "failed", startedAt: started, message: "Expo sign-in timed out. Try again." });
      }
    }, deps.loginTimeoutMs ?? LOGIN_TIMEOUT_MS);
    void proc.exited.then(async (code) => {
      clearTimeout(timer);
      if (login !== proc || status?.startedAt !== started || status.state === "failed") return;
      try { await finish(session, preview, dir, code); } catch (error) {
        end({ state: "failed", startedAt: started, message: error instanceof Error ? error.message : "Expo sign-in failed." });
      } finally { if (login === proc) login = null; }
    });
  }

  /**
   * Wait while the user creates their account on expo.dev/signup, then
   * continue into the CLI login. Only a person fills in that form.
   */
  async function awaitSignup(session: Session, preview: ProjectPreview | null, dir: string, started: number): Promise<void> {
    const deadline = now() + (deps.signupTimeoutMs ?? SIGNUP_TIMEOUT_MS);
    const pollMs = deps.signupPollMs ?? SIGNUP_POLL_MS;
    const current = () => status?.state === "signup" && status.startedAt === started;
    while (current()) {
      if (account() !== null) {
        end({ state: "done", startedAt: started, message: `Signed in to Expo as ${account()}.` });
        return;
      }
      if (await deps.webSignedIn().catch(() => false)) {
        if (current()) startLogin(session, preview, dir, started);
        return;
      }
      if (now() >= deadline) {
        if (current()) end({ state: "failed", startedAt: started, message: "Expo sign-up timed out. Try again." });
        return;
      }
      await new Promise((r) => setTimeout(r, pollMs));
    }
  }

  async function connect(session: Session, mode: ExpoConnectMode): Promise<void> {
    if (expoConnectActive(status)) return;
    const preview = deps.preview(session.id);
    const dir = projectDir(session, preview);
    await deps.startDesktop();
    cancelled = false;
    const started = now();
    if (mode === "login") { startLogin(session, preview, dir, started); return; }
    status = { state: "signup", startedAt: started };
    try {
      await deps.openBrowser(EXPO_SIGNUP_URL);
    } catch (error) {
      end({ state: "failed", startedAt: started, message: error instanceof Error ? `Could not open expo.dev: ${error.message}` : "Could not open expo.dev." });
      return;
    }
    void awaitSignup(session, preview, dir, started).catch((error) => {
      end({ state: "failed", startedAt: started, message: error instanceof Error ? error.message : "Expo sign-up failed." });
    });
  }

  function cancel(): void {
    if (status?.state !== "waiting" && status?.state !== "signup") return;
    cancelled = true;
    login?.kill();
    end({ state: "cancelled", startedAt: status.startedAt });
  }

  return async function handle(req: Request): Promise<Response> {
    const json = (value: unknown, code = 200) => Response.json(value, { status: code, headers: { "Cache-Control": "no-store" } });
    try {
      const url = new URL(req.url);
      let mode: ExpoConnectMode = "login";
      if (req.method === "POST") {
        const text = await req.text();
        if (text.length > MAX_BODY) throw new AccountError(413, "Request is too large");
        let body: { mode?: unknown } = {};
        try { body = text ? JSON.parse(text) as { mode?: unknown } : {}; } catch { throw new AccountError(400, "Request body must be JSON"); }
        if (body.mode !== undefined && body.mode !== "signup" && body.mode !== "login") throw new AccountError(400, "mode must be signup or login");
        if (body.mode === "signup") mode = "signup";
      }
      const id = url.searchParams.get("sessionId");
      if (!id) throw new AccountError(400, "sessionId is required");
      const session = await deps.session(id);
      if (!session) throw new AccountError(404, "Session not found");
      if (!owns(session.owner, deps.viewer(req))) throw new AccountError(403, "This session belongs to another user");
      const action = url.pathname.replace(/^\/api\/expo-account\/?/, "");
      if (req.method === "GET" && action === "") return json(snapshot());
      if (req.method !== "POST") throw new AccountError(405, "Method not allowed");
      if (action === "connect") {
        if (account() === null) await connect(session, mode);
        return json(snapshot());
      }
      if (action === "cancel") { cancel(); return json(snapshot()); }
      throw new AccountError(404, "Not found");
    } catch (error) {
      return json({ error: error instanceof Error ? error.message : "Expo account request failed" }, error instanceof AccountError ? error.code : 500);
    }
  };
}

/** The live dependencies. `serve.ts` supplies the session, viewer and desktop parts. */
export function liveExpoAccountDeps(): Pick<ExpoAccountDeps, "spawnLogin" | "run" | "manifest" | "metroCwd"> {
  const env = () => {
    const next = { ...process.env };
    installXdgOpenShim(next);
    // Expo's opener honours BROWSER first. Leave the choice to xdg-open.
    delete next.BROWSER;
    return next;
  };
  return {
    spawnLogin(expo, cwd) {
      // OMG_COMPUTER_KIOSK: the xdg-open shim opens the login page in the
      // kiosk window, which the card shows in its sign-in sheet.
      const proc = Bun.spawn([expo, "login", "--browser"], { cwd, env: { ...env(), OMG_COMPUTER_KIOSK: "1" }, stdin: "ignore", stdout: "pipe", stderr: "pipe" });
      let out = "";
      const drain = async (stream: ReadableStream<Uint8Array>) => {
        const decoder = new TextDecoder();
        for await (const chunk of stream) out = (out + decoder.decode(chunk)).slice(-4000);
      };
      void drain(proc.stdout);
      void drain(proc.stderr);
      return { exited: proc.exited, kill: () => proc.kill(), output: () => out };
    },
    async run(argv, cwd, timeoutMs) {
      const proc = Bun.spawn(argv, { cwd, env: env(), stdin: "ignore", stdout: "pipe", stderr: "pipe" });
      const timer = setTimeout(() => proc.kill(), timeoutMs);
      const [stdout, stderr, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
      clearTimeout(timer);
      return { code, stdout, stderr };
    },
    async manifest(port) {
      try {
        const response = await fetch(`http://127.0.0.1:${port}/`, {
          headers: { "expo-platform": "ios", Accept: "application/expo+json,application/json" },
          signal: AbortSignal.timeout(30_000),
        });
        return response.ok ? await response.text() : null;
      } catch {
        return null;
      }
    },
    metroCwd,
  };
}
