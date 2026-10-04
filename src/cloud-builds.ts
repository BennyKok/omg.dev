// Build an installable Android APK of an Expo project through omg Cloud.
//
// One owner for the agent build flow: check the project, commit, bundle the
// source with git, register the app, upload, start the build, wait within the
// agent budget, then download the signed APK and mint a phone install link.
// HTTP (serve) and MCP (omg_build_android / omg_build_status) are thin callers.
//
// In a Cloud Computer every request goes through the host proxy
// (cloudApiBaseUrl), which injects the Computer's credential; the control
// plane builds only for the owner's running Computer.

import { execFile } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { basename, join } from "node:path";
import { promisify } from "node:util";

import { cloudApiBaseUrl } from "./cloud-account.ts";
import { loadProjectLink, saveProjectLink, AGENT_DEPLOY_WAIT_MS } from "./cloud-apps.ts";

const run = promisify(execFile);

/** The Expo SDK the cloud builder pins (vibes templates/android-builder). */
export const BUILDER_EXPO_SDK = "57";
export const ANDROID_TARGET = { platform: "android", format: "apk", profile: "release", abis: ["arm64-v8a"] } as const;

export class BuildError extends Error {
  constructor(message: string, readonly status = 400, readonly body?: unknown) {
    super(message);
    this.name = "BuildError";
  }
}

export type BuildStep = { id: string; label: string; status: string; estimateMs: number; durationMs: number | null };
export type BuildProgress = {
  status: string; currentStep: string | null; steps: BuildStep[];
  estimatedTotalMs: number; etaAt: number | null; error: string | null;
  version: { name: string; code: number };
};
export type BuildState = {
  buildId: string;
  status: string;
  pending?: true;
  app: { id: string; name: string; bundleId?: string };
  version?: { name: string; code: number };
  progress?: BuildProgress | null;
  error?: string | null;
  /** Present after success: the downloaded APK inside the project. */
  apkPath?: string;
  apkBytes?: number;
  /** Present after success: a phone install page, valid until installExpiresAt. */
  installUrl?: string;
  installExpiresAt?: number;
  next?: string;
};

type Fetch = (url: string, init?: RequestInit) => Promise<Response>;
export type BuildDeps = {
  getAccessToken: () => Promise<string | null | undefined>;
  fetch?: Fetch;
  baseUrl?: string;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
};

async function cloud(deps: BuildDeps, path: string, init: RequestInit = {}): Promise<Response> {
  const token = await deps.getAccessToken();
  const headers = new Headers(init.headers);
  if (token) headers.set("Authorization", `Bearer ${token}`);
  headers.set("User-Agent", "omg-runtime");
  const base = (deps.baseUrl ?? cloudApiBaseUrl()).replace(/\/+$/, "");
  return (deps.fetch ?? fetch)(`${base}${path}`, { ...init, headers });
}

async function cloudJson<T>(deps: BuildDeps, path: string, init: RequestInit = {}): Promise<T> {
  const response = await cloud(deps, path, { ...init, headers: { Accept: "application/json", ...(init.headers as Record<string, string> | undefined) } });
  const text = await response.text();
  let body: unknown = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  if (!response.ok) {
    const message = body && typeof body === "object" && "error" in body ? String((body as { error: unknown }).error) : `Cloud request failed (${response.status})`;
    throw new BuildError(message, response.status, body);
  }
  return body as T;
}

async function git(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await run("git", args, { cwd, maxBuffer: 16 * 1024 * 1024 });
  return stdout.trim();
}

/** The builder's input rules, checked before anything is uploaded. */
export function checkAndroidProject(cwd: string): { name: string; versionName: string } {
  const read = (file: string) => { try { return JSON.parse(readFileSync(join(cwd, file), "utf8")); } catch { return null; } };
  const app = read("app.json")?.expo;
  const pkg = read("package.json");
  if (!app || !pkg) throw new BuildError("An Expo project with app.json and package.json is required. Create one with omg_create_project template \"expo\".");
  for (const dynamic of ["app.config.js", "app.config.ts", "app.config.mjs", "app.config.cjs"]) {
    if (existsSync(join(cwd, dynamic))) throw new BuildError(`The Android builder needs a static app.json. Move the settings from ${dynamic} into app.json.`);
  }
  if (!existsSync(join(cwd, "bun.lock"))) throw new BuildError("The Android builder needs a committed bun.lock. Run bun install in the project, then build again.");
  const expo = String(pkg.dependencies?.expo ?? "");
  if (!new RegExp(`^[~^]?${BUILDER_EXPO_SDK}\\.`).test(expo)) throw new BuildError(`The Android builder supports Expo SDK ${BUILDER_EXPO_SDK} only; this project uses expo ${expo || "(missing)"}.`);
  if (!pkg.dependencies?.["react-native"]) throw new BuildError("react-native must be a dependency.");
  const versionName = typeof app.version === "string" && app.version.trim() ? app.version.trim() : "1.0.0";
  return { name: typeof app.name === "string" && app.name.trim() ? app.name.trim() : basename(cwd), versionName };
}

/** Commit work in progress so the build is exactly the files the agent sees. */
async function commitForBuild(cwd: string): Promise<string> {
  try { await git(cwd, ["rev-parse", "--is-inside-work-tree"]); }
  catch { await git(cwd, ["init", "-q", "-b", "main"]); }
  // Build outputs (APK, source bundle) never enter the app's history. The repo
  // keeps .omg/project.json committed on purpose, so exclude only builds/.
  const gitPath = await git(cwd, ["rev-parse", "--git-path", "info/exclude"])
  const exclude = gitPath.startsWith("/") ? gitPath : join(cwd, gitPath)
  mkdirSync(join(exclude, ".."), { recursive: true })
  const excluded = existsSync(exclude) ? readFileSync(exclude, "utf8") : ""
  if (!excluded.split("\n").includes(".omg/builds/")) writeFileSync(exclude, `${excluded}${excluded && !excluded.endsWith("\n") ? "\n" : ""}.omg/builds/\n`)
  if (await git(cwd, ["status", "--porcelain"])) {
    await git(cwd, ["add", "-A"]);
    await git(cwd, ["-c", "user.name=omg.dev agent", "-c", "user.email=agent@omg.dev", "commit", "-q", "-m", "Build Android app"]);
  }
  return git(cwd, ["rev-parse", "HEAD"]);
}

function buildsDir(cwd: string): string {
  const dir = join(cwd, ".omg", "builds");
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  return dir;
}
function saveLast(cwd: string, state: Pick<BuildState, "buildId" | "app">): void {
  writeFileSync(join(buildsDir(cwd), "last.json"), `${JSON.stringify({ buildId: state.buildId, app: state.app }, null, 2)}\n`, { mode: 0o600 });
}
export function loadLastBuild(cwd: string): { buildId: string; app: BuildState["app"] } | null {
  try { return JSON.parse(readFileSync(join(cwd, ".omg", "builds", "last.json"), "utf8")); } catch { return null; }
}

type CloudBuild = { buildId: string; status: string; app?: { id: string; bundleId: string }; version?: { name: string; code: number }; error?: string | null; progress?: BuildProgress | null };
const TERMINAL = new Set(["succeeded", "failed", "canceled", "timed_out"]);

async function waitForBuild(deps: BuildDeps, buildId: string, budgetMs: number): Promise<CloudBuild> {
  const now = deps.now ?? Date.now, sleep = deps.sleep ?? ((ms: number) => new Promise<void>(r => setTimeout(r, ms)));
  const deadline = now() + budgetMs;
  let last = await cloudJson<CloudBuild>(deps, `/api/cli/builds/${encodeURIComponent(buildId)}`);
  while (!TERMINAL.has(last.status) && now() + 3_000 < deadline) {
    await sleep(3_000);
    last = await cloudJson<CloudBuild>(deps, `/api/cli/builds/${encodeURIComponent(buildId)}`);
  }
  return last;
}

function apkName(appName: string, versionName: string): string {
  const clean = (s: string) => s.normalize("NFKD").replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
  return `${clean(appName) || "app"}-${clean(versionName) || "build"}.apk`;
}

/** Turn a cloud build into the agent's result; download and link on success. */
async function finish(deps: BuildDeps, cwd: string | undefined, app: BuildState["app"], build: CloudBuild): Promise<BuildState> {
  const state: BuildState = { buildId: build.buildId, status: build.status, app: { ...app, bundleId: build.app?.bundleId ?? app.bundleId }, version: build.version, progress: build.progress ?? null, error: build.error ?? null };
  if (!TERMINAL.has(build.status)) {
    return { ...state, pending: true, next: `The build is still running. Call omg_build_status with buildId "${build.buildId}" until it finishes. Do not start another build.` };
  }
  if (build.status !== "succeeded") {
    return { ...state, next: "The build did not succeed. Read error and progress, fix the project, commit, and call omg_build_android again." };
  }
  if (cwd) {
    const response = await cloud(deps, `/api/cli/builds/${encodeURIComponent(build.buildId)}/artifacts/app.apk`);
    if (!response.ok) throw new BuildError(`APK download failed (${response.status})`, response.status);
    const bytes = new Uint8Array(await response.arrayBuffer());
    const expected = response.headers.get("X-Content-SHA256");
    if (expected && createHash("sha256").update(bytes).digest("hex") !== expected) throw new BuildError("APK download was corrupted", 502);
    const path = join(buildsDir(cwd), apkName(app.name, build.version?.name ?? "build"));
    writeFileSync(path, bytes, { mode: 0o644 });
    state.apkPath = path;
    state.apkBytes = bytes.length;
  }
  const link = await cloudJson<{ url: string; expiresAt: number }>(deps, `/api/cli/builds/${encodeURIComponent(build.buildId)}/install-link`, { method: "POST" });
  state.installUrl = link.url;
  state.installExpiresAt = link.expiresAt;
  state.next = `Give the user the Android app: call omg_display_file with ${state.apkPath ? `path "${state.apkPath}"` : "the downloaded APK"}, and send installUrl (it opens an install page on an Android phone and expires at installExpiresAt; call omg_build_status again for a new link). iPhone is not supported by this build.`;
  return state;
}

export type StartBuildInput = { cwd: string; name?: string; versionName?: string; sessionId?: string; wait?: boolean; waitBudgetMs?: number };

/** Start (or replay) an Android build of the project at cwd. */
export async function startAndroidBuild(deps: BuildDeps, input: StartBuildInput): Promise<BuildState> {
  const cwd = input.cwd;
  const checked = checkAndroidProject(cwd);
  // Register first: .omg/project.json then lands in the build commit, so the
  // app keeps one identity across builds and a later omg_deploy.
  const link = loadProjectLink(cwd);
  const registered = await cloudJson<{ app: { id: string; slug: string; name: string; bundleId: string }; created: boolean }>(deps, "/api/cli/builds/apps", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify(link?.projectId ? { projectId: link.projectId } : { name: input.name?.trim() || checked.name }),
  });
  if (!link) saveProjectLink(cwd, { slug: registered.app.slug, projectId: registered.app.id, name: registered.app.name });
  const app = { id: registered.app.id, name: registered.app.name, bundleId: registered.app.bundleId };
  const commitSha = await commitForBuild(cwd);
  if (!/^[0-9a-f]{40}$/.test(commitSha)) throw new BuildError("Could not resolve the commit to build");

  // Bundle a named ref, not bare HEAD: the builder fetches refs/* from the
  // bundle, and a HEAD-only bundle checks out as "unable to read tree".
  const bundlePath = join(buildsDir(cwd), "source.bundle");
  const ref = "refs/omg-build/head";
  await git(cwd, ["update-ref", ref, commitSha]);
  try { await git(cwd, ["bundle", "create", "-q", bundlePath, ref]); }
  finally { await git(cwd, ["update-ref", "-d", ref]).catch(() => {}); }
  const bundle = readFileSync(bundlePath);
  const sha256 = createHash("sha256").update(bundle).digest("hex");
  const upload = await cloudJson<{ uploadId: string; bundleSha256: string }>(deps, `/api/cli/builds/uploads?appId=${encodeURIComponent(app.id)}&sha256=${sha256}`, {
    method: "POST", headers: { "Content-Type": "application/octet-stream" }, body: bundle,
  });

  const created = await cloudJson<CloudBuild>(deps, "/api/cli/builds", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      app: { id: app.id },
      source: { commitSha, bundleSha256: upload.bundleSha256, uploadId: upload.uploadId },
      target: ANDROID_TARGET,
      version: { name: input.versionName?.trim() || checked.versionName },
      signing: { identity: "default" },
      ...(input.sessionId ? { origin: { sessionId: input.sessionId } } : {}),
    }),
  });
  saveLast(cwd, { buildId: created.buildId, app });
  if (input.wait === false) return finish(deps, cwd, app, { ...created, status: created.status === "succeeded" ? "running" : created.status });
  const build = await waitForBuild(deps, created.buildId, input.waitBudgetMs ?? AGENT_DEPLOY_WAIT_MS);
  return finish(deps, cwd, app, build);
}

/** Wait for a build within the agent budget; download and link once it succeeds. */
export async function androidBuildStatus(deps: BuildDeps, input: { buildId?: string; cwd?: string; waitBudgetMs?: number }): Promise<BuildState> {
  const last = input.cwd ? loadLastBuild(input.cwd) : null;
  const buildId = input.buildId?.trim() || last?.buildId;
  if (!buildId) throw new BuildError("buildId is required (or a cwd with a previous omg_build_android build)");
  const build = await waitForBuild(deps, buildId, input.waitBudgetMs ?? AGENT_DEPLOY_WAIT_MS);
  const app = last && last.buildId === buildId ? last.app : { id: build.app?.id ?? "", name: input.cwd ? basename(input.cwd) : "app", bundleId: build.app?.bundleId };
  return finish(deps, input.cwd, app, build);
}

/** HTTP surface for omg serve: /api/cloud/builds/android and /api/cloud/builds/status. */
export const CLOUD_BUILD_PATHS = ["/api/cloud/builds/android", "/api/cloud/builds/status"] as const;
export async function handleCloudBuildsRequest(req: Request, url: URL, deps: BuildDeps): Promise<Response | undefined> {
  const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
  try {
    if (url.pathname === "/api/cloud/builds/android" && req.method === "POST") {
      const body = (await req.json().catch(() => ({}))) as Partial<StartBuildInput>;
      if (!body.cwd) return json({ error: "cwd is required" }, 400);
      const sessionId = body.sessionId || req.headers.get("X-OMG-Session-ID") || undefined;
      return json(await startAndroidBuild(deps, { cwd: body.cwd, name: body.name, versionName: body.versionName, sessionId, wait: body.wait }));
    }
    if (url.pathname === "/api/cloud/builds/status" && req.method === "GET") {
      return json(await androidBuildStatus(deps, { buildId: url.searchParams.get("buildId") ?? undefined, cwd: url.searchParams.get("cwd") ?? undefined }));
    }
  } catch (error) {
    if (error instanceof BuildError) return json({ error: error.message, details: error.body ?? null }, error.status >= 400 && error.status < 600 ? error.status : 500);
    return json({ error: error instanceof Error ? error.message : String(error) }, 500);
  }
  return undefined;
}
