import { afterEach, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import { AGENT_CALL_BUDGET_MS, androidBuildStatus, checkAndroidProject, handleCloudBuildsRequest, PROJECT_ICON_PATH, remainingWait, startAndroidBuild, type BuildDeps } from "./cloud-builds.ts";

// /tmp is RAM on the shared box; keep test trees on disk.
const ROOT = join(homedir(), ".cache", "lfg", "tmp");
const dirs: string[] = [];
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });

function project(overrides: { pkg?: Record<string, unknown>; files?: Record<string, string>; noLock?: boolean } = {}): string {
  mkdirSync(ROOT, { recursive: true });
  const cwd = mkdtempSync(join(ROOT, "cloud-builds-test-"));
  dirs.push(cwd);
  writeFileSync(join(cwd, "app.json"), JSON.stringify({ expo: { name: "Coral Tasks", slug: "coral-tasks", version: "1.2.0" } }));
  writeFileSync(join(cwd, "package.json"), JSON.stringify(overrides.pkg ?? { name: "coral", dependencies: { expo: "~57.0.24", "react-native": "0.86.3" } }));
  if (!overrides.noLock) writeFileSync(join(cwd, "bun.lock"), '{ "lockfileVersion": 1 }\n');
  for (const [name, text] of Object.entries(overrides.files ?? {})) writeFileSync(join(cwd, name), text);
  const git = (...args: string[]) => execFileSync("git", args, { cwd, stdio: "pipe" });
  git("init", "-q", "-b", "main");
  git("add", "-A");
  git("-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "-m", "init");
  return cwd;
}

const APK = new TextEncoder().encode("PK fake apk bytes");

/** Minimal fake of the control-plane /api/cli/builds surface. */
function fakeCloud(opts: { finishAfterPolls?: number; iconPng?: Uint8Array } = {}) {
  const calls: { method: string; path: string; body?: unknown; query: URLSearchParams }[] = [];
  let polls = 0;
  const fetch = async (url: string, init: RequestInit = {}) => {
    const u = new URL(url), method = init.method ?? "GET", path = u.pathname.replace(/^\/cloud/, "");
    let body: unknown;
    if (init.body instanceof Uint8Array || Buffer.isBuffer(init.body)) body = { bytes: (init.body as Uint8Array).length, sha256: createHash("sha256").update(init.body as Uint8Array).digest("hex") };
    else if (typeof init.body === "string") body = JSON.parse(init.body);
    calls.push({ method, path, body, query: u.searchParams });
    const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
    if (path === "/api/cli/builds/apps/proj-1/icon.png") return opts.iconPng ? new Response(opts.iconPng, { headers: { "content-type": "image/png" } }) : json({ error: "This app has no icon yet" }, 404);
    if (path === "/api/cli/builds/apps") return json({ app: { id: "proj-1", slug: "coral-tasks-abcde", name: "Coral Tasks", bundleId: "dev.omg.u12345678.coraltasks" }, created: true }, 201);
    if (path === "/api/cli/builds/uploads") {
      const b = body as { sha256: string };
      if (u.searchParams.get("sha256") !== b.sha256) return json({ error: "Source bundle SHA-256 mismatch" }, 400);
      return json({ uploadId: "up-1", bundleSha256: b.sha256 }, 201);
    }
    if (path === "/api/cli/builds" && method === "POST") return json({ buildId: "b-1", status: "queued", app: { id: "proj-1", bundleId: "dev.omg.u12345678.coraltasks" }, version: { name: "1.2.0", code: 1 } }, 202);
    if (path === "/api/cli/builds/b-1") {
      polls++;
      const done = polls > (opts.finishAfterPolls ?? 1);
      return json({ buildId: "b-1", status: done ? "succeeded" : "running", version: { name: "1.2.0", code: 1 }, error: null, progress: { status: done ? "succeeded" : "running", currentStep: done ? null : "compile", steps: [], estimatedTotalMs: 177_000, etaAt: null, error: null, version: { name: "1.2.0", code: 1 } } });
    }
    if (path === "/api/cli/builds/b-1/artifacts/app.apk") return new Response(APK, { headers: { "X-Content-SHA256": createHash("sha256").update(APK).digest("hex") } });
    if (path === "/api/cli/builds/b-1/install-link") return json({ url: "https://backend.omg.dev/v1/builds/b-1/install?t=tok", expiresAt: 123 });
    return json({ error: "not found" }, 404);
  };
  return { calls, fetch };
}
const deps = (fetch: BuildDeps["fetch"]): BuildDeps => ({ getAccessToken: async () => null, fetch, baseUrl: "http://169.254.0.1:9090/cloud", sleep: async () => {} });

test("checks the builder's input rules before uploading", () => {
  expect(() => checkAndroidProject(project({ noLock: true }))).toThrow("bun.lock");
  expect(() => checkAndroidProject(project({ files: { "app.config.ts": "export default {}" } }))).toThrow("static app.json");
  expect(() => checkAndroidProject(project({ pkg: { dependencies: { expo: "~55.0.0", "react-native": "0.83.0" } } }))).toThrow("Expo SDK 57");
  expect(checkAndroidProject(project())).toEqual({ name: "Coral Tasks", versionName: "1.2.0" });
});

test("builds end to end: commit, register, upload, build, download, install link", async () => {
  const cwd = project();
  writeFileSync(join(cwd, "App.js"), "export default () => null\n"); // uncommitted work
  const cloud = fakeCloud();
  const state = await startAndroidBuild(deps(cloud.fetch), { cwd, sessionId: "sess_1" });

  expect(state.status).toBe("succeeded");
  expect(state.pending).toBeUndefined();
  expect(state.installUrl).toBe("https://backend.omg.dev/v1/builds/b-1/install?t=tok");
  expect(state.apkPath).toBe(join(cwd, ".omg", "builds", "Coral-Tasks-1.2.0.apk"));
  expect(readFileSync(state.apkPath!)).toEqual(Buffer.from(APK));
  expect(state.next).toContain("omg_display_file");

  // The work in progress was committed, and build outputs never were.
  const git = (...args: string[]) => execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
  expect(git("status", "--porcelain")).toBe("");
  expect(git("ls-files")).toContain("App.js");
  expect(git("ls-files")).not.toContain(".omg/builds");
  const head = git("rev-parse", "HEAD");

  // The app link is saved so a later omg_deploy shares the same app record.
  expect(JSON.parse(readFileSync(join(cwd, ".omg", "project.json"), "utf8"))).toMatchObject({ projectId: "proj-1", slug: "coral-tasks-abcde" });
  const create = cloud.calls.find((c) => c.path === "/api/cli/builds" && c.method === "POST")!.body as Record<string, any>;
  expect(create.app).toEqual({ id: "proj-1" });
  expect(create.source.commitSha).toBe(head);
  expect(create.origin).toEqual({ sessionId: "sess_1" });
  expect(create.target).toEqual({ platform: "android", format: "apk", profile: "release", abis: ["arm64-v8a"] });
  expect(create.version).toEqual({ name: "1.2.0" });

  // The uploaded bundle checks out the exact commit the way the builder does:
  // fetch refs/* into a fresh repository, then detach at the commit.
  const fresh = mkdtempSync(join(ROOT, "cloud-builds-checkout-")); dirs.push(fresh);
  const g = (...args: string[]) => execFileSync("git", args, { cwd: fresh, stdio: "pipe" });
  g("init", "-q");
  g("-c", "core.hooksPath=/dev/null", "fetch", "-q", join(cwd, ".omg", "builds", "source.bundle"), "+refs/*:refs/source/*");
  g("-c", "core.hooksPath=/dev/null", "checkout", "-q", "--detach", head);
  expect(execFileSync("git", ["rev-parse", "HEAD"], { cwd: fresh, encoding: "utf8" }).trim()).toBe(head);
  // The temporary ref does not stay in the user's repository.
  expect(git("for-each-ref", "refs/omg-build")).toBe("");
});

test("returns pending inside the agent budget, then status finishes from the saved build", async () => {
  const cwd = project();
  const cloud = fakeCloud({ finishAfterPolls: 100 });
  const started = await startAndroidBuild({ ...deps(cloud.fetch), now: (() => { let t = 0; return () => (t += 20_000); })() }, { cwd });
  expect(started).toMatchObject({ status: "running", pending: true, buildId: "b-1" });
  expect(started.next).toContain("omg_build_status");
  expect(existsSync(join(cwd, ".omg", "builds", "last.json"))).toBe(true);

  const done = await androidBuildStatus(deps(fakeCloud().fetch), { cwd });
  expect(done.status).toBe("succeeded");
  expect(done.apkPath).toBe(join(cwd, ".omg", "builds", "Coral-Tasks-1.2.0.apk"));
});

test("the HTTP surface reports input errors with their message", async () => {
  const cwd = project({ noLock: true });
  const res = await handleCloudBuildsRequest(new Request("http://127.0.0.1/api/cloud/builds/android", { method: "POST", body: JSON.stringify({ cwd }) }), new URL("http://127.0.0.1/api/cloud/builds/android"), deps(fakeCloud().fetch));
  expect(res!.status).toBe(400);
  expect(((await res!.json()) as { error: string }).error).toContain("bun.lock");
});

// Codex stops an MCP tool call after 60 s. A slow upload must shrink the wait,
// so the agent always receives the buildId instead of a timeout.
test("a slow upload shortens the wait, so the call ends inside the agent budget", async () => {
  const cwd = project();
  const cloud = fakeCloud({ finishAfterPolls: 100 });
  let t = 0;
  const slowFetch: BuildDeps["fetch"] = async (url, init) => {
    if (new URL(url).pathname.includes("/uploads")) t += 25_000;
    return cloud.fetch(url, init);
  };
  const started = await startAndroidBuild({ ...deps(slowFetch), now: () => t, sleep: async (ms) => { t += ms; } }, { cwd });
  expect(started).toMatchObject({ pending: true, buildId: "b-1" });
  expect(t).toBeLessThanOrEqual(AGENT_CALL_BUDGET_MS);
});

test("the wait is what is left of the call budget", () => {
  expect(remainingWait(0, 0)).toBe(30_000);
  expect(remainingWait(0, 25_000)).toBe(5_000);
  expect(remainingWait(0, 60_000)).toBe(0);
});

// A PNG header is enough for the build flow; the cloud renders the real image.
const ICON = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);

test("the app's omg.dev icon is committed with the build, and the same icon does not change the app again", async () => {
  const cwd = project();
  const git = (...args: string[]) => execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
  const first = await startAndroidBuild(deps(fakeCloud({ iconPng: ICON }).fetch), { cwd });
  expect(first.icon).toBe("applied");
  expect(readFileSync(join(cwd, PROJECT_ICON_PATH))).toEqual(Buffer.from(ICON));
  const expo = JSON.parse(readFileSync(join(cwd, "app.json"), "utf8")).expo;
  expect(expo.icon).toBe(`./${PROJECT_ICON_PATH}`);
  expect(expo.android.adaptiveIcon).toEqual({ foregroundImage: `./${PROJECT_ICON_PATH}`, backgroundColor: "#ffffff" });
  // The icon is part of the commit the cloud builds, not a later change.
  expect(git("ls-files")).toContain(PROJECT_ICON_PATH);
  expect(git("status", "--porcelain")).toBe("");
  const head = git("rev-parse", "HEAD");

  const again = await startAndroidBuild(deps(fakeCloud({ iconPng: ICON }).fetch), { cwd });
  expect(again.icon).toBe("unchanged");
  expect(git("rev-parse", "HEAD")).toBe(head);
});

test("an icon the app chose itself is left alone and not fetched; no icon or a failed fetch keeps building", async () => {
  const custom = project({ files: { "app.json": JSON.stringify({ expo: { name: "Coral Tasks", version: "1.2.0", icon: "./assets/mine.png" } }) } });
  const cloud = fakeCloud({ iconPng: ICON });
  const state = await startAndroidBuild(deps(cloud.fetch), { cwd: custom });
  expect(state.icon).toBe("custom");
  expect(cloud.calls.some((c) => c.path.endsWith("/icon.png"))).toBe(false);
  expect(JSON.parse(readFileSync(join(custom, "app.json"), "utf8")).expo.icon).toBe("./assets/mine.png");

  const none = await startAndroidBuild(deps(fakeCloud().fetch), { cwd: project() });
  expect(none.icon).toBe("none");
  expect(none.status).toBe("succeeded");

  const broken = fakeCloud();
  const failing = async (url: string, init?: RequestInit) => (url.endsWith("/icon.png") ? new Response("boom", { status: 502 }) : broken.fetch(url, init));
  const skipped = await startAndroidBuild(deps(failing), { cwd: project() });
  expect(skipped.icon).toBe("skipped");
  expect(skipped.status).toBe("succeeded");
});
