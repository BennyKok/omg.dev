import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ProjectPreview } from "../packages/protocol/src/project-preview.ts";
import type { ExpoAccountSnapshot } from "../packages/protocol/src/expo-account.ts";
import {
  createExpoAccountService,
  installXdgOpenShim,
  manifestUsername,
  parseWhoami,
  readExpoStateAccount,
  XDG_OPEN_SHIM_DIR,
  type ExpoAccountDeps,
  type LoginProcess,
} from "./expo-account.ts";
import { expoWebSignedInFrom } from "./computer/browser.ts";

const tmpRoot = join(process.env.HOME ?? ".", ".cache", "lfg", "tmp");
let dir: string;
let home: string;
let project: string;

const PREVIEW: ProjectPreview = {
  sessionId: "s1", title: "App", url: "https://p.example", port: 8081, kind: "sandbox-preview",
  visibility: "owner", temporary: true, createdAt: 1, expoGoUrl: "exps://box-8081-abc-sig.preview.omgs.app",
};

function signIn(username: string) {
  mkdirSync(join(home, ".expo"), { recursive: true });
  writeFileSync(join(home, ".expo", "state.json"), JSON.stringify({ auth: { sessionSecret: "{\"id\":\"x\"}", username } }));
}

function fakeLogin(): LoginProcess & { finish(code: number): void; killed: boolean } {
  let resolve!: (code: number) => void;
  const exited = new Promise<number>((r) => { resolve = r; });
  const proc = { exited, killed: false, kill() { proc.killed = true; resolve(143); }, output: () => "", finish: (code: number) => resolve(code) };
  return proc;
}

function service(over: Partial<ExpoAccountDeps> = {}) {
  const calls: string[][] = [];
  const told: string[] = [];
  let login = fakeLogin();
  let manifestUser: string | null = null;
  const web = { signedIn: false };
  const deps: ExpoAccountDeps = {
    session: async (id) => id === "s1" ? { id: "s1", owner: "a@x.dev", cwd: project } : null,
    viewer: (req) => new URL(req.url).searchParams.get("user") ?? "",
    preview: () => PREVIEW,
    startDesktop: async () => { calls.push(["desktop"]); },
    openBrowser: async (url) => { calls.push(["open", url]); },
    closeBrowser: async () => { calls.push(["close"]); },
    webSignedIn: async () => web.signedIn,
    spawnLogin: (expo) => { calls.push([expo, "login", "--browser"]); login = fakeLogin(); return login; },
    run: async (argv) => {
      calls.push(argv);
      if (argv[1] === "whoami") return { code: 0, stdout: "expo-e2e-test\n", stderr: "" };
      manifestUser = "expo-e2e-test";
      return { code: 0, stdout: "", stderr: "" };
    },
    manifest: async () => JSON.stringify({ extra: { expoGo: manifestUser ? { username: manifestUser } : {} } }),
    metroCwd: () => project,
    tellAgent: async (_id, text) => { told.push(text); },
    home,
    signupPollMs: 2,
    ...over,
  };
  const handle = createExpoAccountService(deps);
  const call = async (path: string, method = "GET", user = "a@x.dev", body = "{}") => {
    const res = await handle(new Request(`http://x${path}${path.includes("?") ? "&" : "?"}sessionId=s1&user=${user}`, { method, ...(method === "POST" ? { body } : {}) }));
    return { status: res.status, body: await res.json() as ExpoAccountSnapshot & { error?: string } };
  };
  return { call, calls, told, web, login: () => login, setManifestUser: (u: string | null) => { manifestUser = u; } };
}

const settle = () => new Promise((r) => setTimeout(r, 10));

beforeEach(() => {
  mkdirSync(tmpRoot, { recursive: true });
  dir = mkdtempSync(join(tmpRoot, "expo-account-"));
  home = join(dir, "home");
  project = join(dir, "app");
  mkdirSync(join(project, "node_modules", ".bin"), { recursive: true });
  mkdirSync(join(project, "scripts"), { recursive: true });
  writeFileSync(join(project, "node_modules", ".bin", "expo"), "");
  writeFileSync(join(project, "scripts", "start-expo-preview.sh"), "");
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("reading the account", () => {
  test("state.json with a session names the account", () => {
    signIn("bob");
    expect(readExpoStateAccount(home)).toBe("bob");
  });
  test("state.json with only a uuid is signed out", () => {
    mkdirSync(join(home, ".expo"), { recursive: true });
    writeFileSync(join(home, ".expo", "state.json"), JSON.stringify({ uuid: "u" }));
    expect(readExpoStateAccount(home)).toBeNull();
  });
  test("whoami output", () => {
    expect(parseWhoami("bennykok\n")).toBe("bennykok");
    expect(parseWhoami("Not logged in\n")).toBeNull();
    expect(parseWhoami("")).toBeNull();
  });
  test("manifest username", () => {
    expect(manifestUsername(JSON.stringify({ extra: { expoGo: { username: "u1" } } }))).toBe("u1");
    expect(manifestUsername(JSON.stringify({ extra: { expoGo: {} } }))).toBeNull();
    expect(manifestUsername("--multipart")).toBeNull();
  });
});

describe("GET /api/expo-account", () => {
  test("reports signed out, then the account once state.json changes", async () => {
    const s = service();
    expect((await s.call("/api/expo-account")).body).toEqual({ signedIn: false });
    signIn("bob");
    expect((await s.call("/api/expo-account")).body).toEqual({ signedIn: true, username: "bob" });
  });
  test("refuses another user's session", async () => {
    const s = service();
    expect((await s.call("/api/expo-account", "GET", "b@x.dev")).status).toBe(403);
  });
});

describe("Connect Expo", () => {
  test("concurrent taps during desktop startup share one login", async () => {
    let ready!: () => void;
    const desktop = new Promise<void>((resolve) => { ready = resolve; });
    const s = service({ startDesktop: () => desktop });
    const first = s.call("/api/expo-account/connect", "POST");
    await settle();
    const second = await s.call("/api/expo-account/connect", "POST");
    expect(second.body.connect?.state).toBe("waiting");
    ready();
    await first;
    expect(s.calls.filter((c) => c[1] === "login")).toHaveLength(1);
    await s.call("/api/expo-account/cancel", "POST");
  });

  test("cancel during startup prevents a late login, and retry waits for cleanup", async () => {
    let ready!: () => void;
    let closed!: () => void;
    const desktop = new Promise<void>((resolve) => { ready = resolve; });
    const cleanup = new Promise<void>((resolve) => { closed = resolve; });
    const s = service({ startDesktop: () => desktop, closeBrowser: () => cleanup });
    const first = s.call("/api/expo-account/connect", "POST");
    await settle();
    expect((await s.call("/api/expo-account/cancel", "POST")).body.connect?.state).toBe("cancelled");
    ready();
    await first;
    expect(s.calls.filter((c) => c[1] === "login")).toHaveLength(0);
    const retry = s.call("/api/expo-account/connect", "POST");
    await settle();
    expect(s.calls.filter((c) => c[1] === "login")).toHaveLength(0);
    closed();
    await retry;
    expect(s.calls.filter((c) => c[1] === "login")).toHaveLength(1);
    await s.call("/api/expo-account/cancel", "POST");
  });

  test("browser startup failure is simple and can be retried", async () => {
    let fail = true;
    const s = service({ startDesktop: async () => { if (fail) throw new Error("port 9222 is already in use"); } });
    const failed = await s.call("/api/expo-account/connect", "POST");
    expect(failed.body.connect?.state).toBe("failed");
    expect(failed.body.connect?.message).toBe("The Computer could not open Expo sign-in. Try again.");
    fail = false;
    expect((await s.call("/api/expo-account/connect", "POST")).body.connect?.state).toBe("waiting");
    await s.call("/api/expo-account/cancel", "POST");
  });

  test("login, whoami, Metro restart, done", async () => {
    const s = service();
    const started = await s.call("/api/expo-account/connect", "POST");
    expect(started.body.connect?.state).toBe("waiting");
    expect(s.calls[0]).toEqual(["desktop"]);
    expect(s.calls[1]).toEqual([join(project, "node_modules", ".bin", "expo"), "login", "--browser"]);
    // A second tap does not start a second login.
    await s.call("/api/expo-account/connect", "POST");
    expect(s.calls.filter((c) => c[1] === "login")).toHaveLength(1);

    signIn("expo-e2e-test");
    s.login().finish(0);
    await settle();
    const after = await s.call("/api/expo-account");
    expect(after.body.signedIn).toBe(true);
    expect(after.body.username).toBe("expo-e2e-test");
    expect(after.body.connect?.state).toBe("done");
    expect(s.calls.some((c) => c[0] === "bash" && c[2] === "https://box-8081-abc-sig.preview.omgs.app" && c[3] === "8081")).toBe(true);
  });

  test("no restart when the manifest already names the account", async () => {
    const s = service();
    s.setManifestUser("expo-e2e-test");
    await s.call("/api/expo-account/connect", "POST");
    signIn("expo-e2e-test");
    s.login().finish(0);
    await settle();
    expect((await s.call("/api/expo-account")).body.connect?.state).toBe("done");
    expect(s.calls.some((c) => c[0] === "bash")).toBe(false);
  });

  test("asks the agent when there is no start script", async () => {
    rmSync(join(project, "scripts"), { recursive: true });
    const s = service();
    await s.call("/api/expo-account/connect", "POST");
    signIn("expo-e2e-test");
    s.login().finish(0);
    await settle();
    expect((await s.call("/api/expo-account")).body.connect?.state).toBe("done");
    expect(s.told[0]).toContain("Restart Metro");
  });

  test("cancel stops the login", async () => {
    const s = service();
    await s.call("/api/expo-account/connect", "POST");
    const res = await s.call("/api/expo-account/cancel", "POST");
    expect(res.body.connect?.state).toBe("cancelled");
    expect(s.login().killed).toBe(true);
    await settle();
    expect((await s.call("/api/expo-account")).body.connect?.state).toBe("cancelled");
  });

  test("a failed login says so", async () => {
    const s = service();
    await s.call("/api/expo-account/connect", "POST");
    s.login().finish(1);
    await settle();
    const res = await s.call("/api/expo-account");
    expect(res.body.connect?.state).toBe("failed");
    expect(res.body.signedIn).toBe(false);
  });

  test("times out", async () => {
    const s = service({ loginTimeoutMs: 5 });
    await s.call("/api/expo-account/connect", "POST");
    await new Promise((r) => setTimeout(r, 30));
    const res = await s.call("/api/expo-account");
    expect(res.body.connect?.state).toBe("failed");
    expect(res.body.connect?.message).toContain("timed out");
  });

  test("needs Expo CLI in the project", async () => {
    rmSync(join(project, "node_modules"), { recursive: true });
    const s = service();
    const res = await s.call("/api/expo-account/connect", "POST");
    expect(res.status).toBe(409);
  });
});

describe("Create free account (mode signup)", () => {
  const signup = JSON.stringify({ mode: "signup" });

  test("cancel while the sign-up window opens closes it after opening", async () => {
    let opened!: () => void;
    const window = new Promise<void>((resolve) => { opened = resolve; });
    const s = service({ openBrowser: () => window });
    const first = s.call("/api/expo-account/connect", "POST", "a@x.dev", signup);
    await settle();
    await s.call("/api/expo-account/cancel", "POST");
    expect(s.calls.filter((c) => c[0] === "close")).toHaveLength(0);
    opened();
    await first;
    await settle();
    expect(s.calls.filter((c) => c[0] === "close")).toHaveLength(1);
    expect(s.calls.filter((c) => c[1] === "login")).toHaveLength(0);
  });

  test("opens expo.dev/signup, waits for the browser sign-in, then runs the CLI login", async () => {
    const s = service();
    const started = await s.call("/api/expo-account/connect", "POST", "a@x.dev", signup);
    expect(started.body.connect?.state).toBe("signup");
    expect(s.calls[1]).toEqual(["open", "https://expo.dev/signup"]);
    await settle();
    expect(s.calls.some((c) => c[1] === "login")).toBe(false);

    s.web.signedIn = true;
    await settle();
    expect((await s.call("/api/expo-account")).body.connect?.state).toBe("waiting");
    expect(s.calls.filter((c) => c[1] === "login")).toHaveLength(1);

    signIn("expo-e2e-test");
    s.login().finish(0);
    await settle();
    const after = await s.call("/api/expo-account");
    expect(after.body.connect?.state).toBe("done");
    expect(after.body.username).toBe("expo-e2e-test");
  });

  test("never fills in the sign-up form itself", async () => {
    const s = service();
    await s.call("/api/expo-account/connect", "POST", "a@x.dev", signup);
    await settle();
    // Only navigation: no typing, clicking or other browser commands.
    expect(s.calls.filter((c) => c[0] === "open")).toEqual([["open", "https://expo.dev/signup"]]);
  });

  test("cancel during sign-up stops the wait", async () => {
    const s = service();
    await s.call("/api/expo-account/connect", "POST", "a@x.dev", signup);
    expect((await s.call("/api/expo-account/cancel", "POST")).body.connect?.state).toBe("cancelled");
    s.web.signedIn = true;
    await settle();
    expect(s.calls.some((c) => c[1] === "login")).toBe(false);
    expect((await s.call("/api/expo-account")).body.connect?.state).toBe("cancelled");
  });

  test("sign-up times out", async () => {
    const s = service({ signupTimeoutMs: 5 });
    await s.call("/api/expo-account/connect", "POST", "a@x.dev", signup);
    await new Promise((r) => setTimeout(r, 30));
    const res = await s.call("/api/expo-account");
    expect(res.body.connect?.state).toBe("failed");
    expect(res.body.connect?.message).toContain("timed out");
  });

  test("the sign-in window closes when the run ends", async () => {
    const s = service();
    await s.call("/api/expo-account/connect", "POST", "a@x.dev", signup);
    expect(s.calls.some((c) => c[0] === "close")).toBe(false);
    s.web.signedIn = true;
    await settle();
    // The same window moves on to the CLI login page; it stays open.
    expect(s.calls.some((c) => c[0] === "close")).toBe(false);
    signIn("expo-e2e-test");
    s.login().finish(0);
    await settle();
    expect(s.calls.some((c) => c[0] === "close")).toBe(true);
  });

  test("cancel closes the sign-in window", async () => {
    const s = service();
    await s.call("/api/expo-account/connect", "POST", "a@x.dev", signup);
    await s.call("/api/expo-account/cancel", "POST");
    await settle();
    expect(s.calls.filter((c) => c[0] === "close")).toHaveLength(1);
  });

  test("a bad mode is refused, and no body means login", async () => {
    const s = service();
    expect((await s.call("/api/expo-account/connect", "POST", "a@x.dev", JSON.stringify({ mode: "bot" }))).status).toBe(400);
    expect((await s.call("/api/expo-account/connect", "POST", "a@x.dev", "")).body.connect?.state).toBe("waiting");
  });
});

describe("expo.dev browser sign-in rule", () => {
  test("a sessionSecret cookie or an account page means signed in", () => {
    expect(expoWebSignedInFrom([{ name: "io.expo.auth.sessionSecret", value: "{}" }], "https://expo.dev/signup")).toBe(true);
    expect(expoWebSignedInFrom([], "https://expo.dev/accounts/bob")).toBe(true);
    expect(expoWebSignedInFrom([{ name: "_ga", value: "1" }], "https://expo.dev/signup")).toBe(false);
    expect(expoWebSignedInFrom([{ name: "io.expo.auth.sessionSecret", value: "" }], "https://expo.dev/login")).toBe(false);
    expect(expoWebSignedInFrom([], "about:blank")).toBe(false);
  });
});

describe("xdg-open shim", () => {
  test("goes on PATH only when the system has none", () => {
    const bin = join(dir, "bin");
    mkdirSync(bin);
    const env: NodeJS.ProcessEnv = { PATH: bin };
    expect(installXdgOpenShim(env, 9000)).toBe(true);
    expect(env.PATH!.split(":")[0]).toBe(XDG_OPEN_SHIM_DIR);
    expect(env.OMG_COMPUTER_API).toBe("http://127.0.0.1:9000");

    writeFileSync(join(bin, "xdg-open"), "#!/bin/sh\n");
    chmodSync(join(bin, "xdg-open"), 0o755);
    const own: NodeJS.ProcessEnv = { PATH: bin };
    expect(installXdgOpenShim(own)).toBe(false);
    expect(own.PATH).toBe(bin);
  });

  test("opens the URL through serve and never fails its caller", async () => {
    const seen: { path: string; body: string }[] = [];
    const server = Bun.serve({
      port: 0, hostname: "127.0.0.1",
      async fetch(req) { seen.push({ path: new URL(req.url).pathname, body: await req.text() }); return Response.json({ ok: true }); },
    });
    try {
      const url = "https://expo.dev/login?client_id=expo-cli&redirect_uri=http%3A%2F%2Flocalhost%3A41234%2Fauth%2Fcallback";
      // Async spawn: the fake serve runs on this same event loop.
      const ok = Bun.spawn([join(XDG_OPEN_SHIM_DIR, "xdg-open"), url], { env: { PATH: process.env.PATH, OMG_COMPUTER_API: `http://127.0.0.1:${server.port}` }, stderr: "pipe" });
      expect(await ok.exited).toBe(0);
      expect(seen.map((s) => s.path)).toEqual(["/api/computer/start", "/api/computer/browser/navigate"]);
      expect(JSON.parse(seen[1]!.body)).toEqual({ url, kiosk: false });
      // The Expo login sets OMG_COMPUTER_KIOSK, so its page opens in the sheet's window.
      const kiosk = Bun.spawn([join(XDG_OPEN_SHIM_DIR, "xdg-open"), url], { env: { PATH: process.env.PATH, OMG_COMPUTER_API: `http://127.0.0.1:${server.port}`, OMG_COMPUTER_KIOSK: "1" }, stderr: "pipe" });
      expect(await kiosk.exited).toBe(0);
      expect(JSON.parse(seen[3]!.body)).toEqual({ url, kiosk: true });
    } finally { server.stop(true); }
    const down = Bun.spawnSync([join(XDG_OPEN_SHIM_DIR, "xdg-open"), "https://expo.dev/login"], { env: { PATH: process.env.PATH, OMG_COMPUTER_API: "http://127.0.0.1:1" } });
    expect(down.exitCode).toBe(0);
    expect(new TextDecoder().decode(down.stderr)).toContain("https://expo.dev/login");
  });
});
