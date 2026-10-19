// Deploy a local folder through omg Cloud / Infra.
//
// One owner: collect the tree the way `/api/cli/apps/deploy-source` expects,
// POST it with the runtime credential, persist `.omg/project.json` so the next
// deploy updates the same slug. CLI, HTTP, and MCP are thin callers.

import { mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, extname, isAbsolute, join, posix, relative, sep } from "node:path";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";

import {
  CloudAppsError,
  createCloudAppsClient,
  isDeployDone,
  isDeployFailed,
  type CloudAppsClient,
  type CloudDeployResult,
  type CloudDeployStatus,
  type CloudSourceFile,
} from "../packages/cloud/src/apps.ts";
import type { FetchLike, GetAuthToken } from "../packages/cloud/src/config.ts";
import { cloudApiBaseUrl } from "./cloud-account.ts";

export const GUEST_PROJECT_ROOT = "/home/user/project";
export const MAX_SOURCE_FILES = 2_000;
export const MAX_FILE_BYTES = 2_000_000;
export const MAX_TOTAL_BYTES = 40_000_000;

const ALWAYS_SKIP = new Set([
  "node_modules",
  "dist",
  ".agents",
  ".vibes",
  ".git",
  ".omg",
  ".DS_Store",
  ".next",
  ".turbo",
  "coverage",
  "AGENTS.md",
  "CLAUDE.md",
]);

export type ProjectLink = {
  slug: string;
  projectId: string;
  name: string;
};

export type RepoDeployLink = ProjectLink & {
  url: string;
};

export function publicAppUrl(slug: string): string {
  return `https://${slug}.omgs.app`;
}

export function deployLinkFromProject(cwd: string): RepoDeployLink | undefined {
  const link = loadProjectLink(cwd);
  if (!link) return undefined;
  return { ...link, url: publicAppUrl(link.slug) };
}

export type CollectedProject = {
  files: CloudSourceFile[];
  skippedSecrets: string[];
  skippedLarge: string[];
};

export type DeployFolderInput = {
  cwd: string;
  name?: string;
  projectId?: string;
  generateIcon?: boolean;
  idempotencyKey?: string;
  wait?: boolean;
  intervalMs?: number;
  timeoutMs?: number;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  onStatus?: (status: CloudDeployStatus) => void;
  /** Stop waiting after this long and return `pending: true` while the build continues. */
  waitBudgetMs?: number;
  /** The agent session that ran the deploy. */
  sessionId?: string;
};

export type DeployFolderResult = CloudDeployResult & {
  latest?: CloudDeployStatus;
  /** True when the build was still running when the wait budget ended. */
  pending?: true;
  /** `.env` file names left out of the upload. Their values never ship as files. */
  skippedSecrets?: string[];
  /** Tells the agent how to move skipped `.env` values into the app's env vars. */
  envHint?: string;
  /** First deploy only: how to add store screenshots once the build is ready. */
  storeScreenshotsHint?: string;
};

export function projectLinkPath(cwd: string): string {
  return join(cwd, ".omg", "project.json");
}

export function loadProjectLink(cwd: string): ProjectLink | null {
  try {
    const parsed = JSON.parse(readFileSync(projectLinkPath(cwd), "utf8")) as Partial<ProjectLink>;
    if (!parsed.slug || !parsed.projectId || !parsed.name) return null;
    return { slug: parsed.slug, projectId: parsed.projectId, name: parsed.name };
  } catch {
    return null;
  }
}

/** loadProjectLink without blocking the event loop, for request paths. */
export async function loadProjectLinkAsync(cwd: string): Promise<ProjectLink | null> {
  try {
    const parsed = JSON.parse(await readFile(projectLinkPath(cwd), "utf8")) as Partial<ProjectLink>;
    if (!parsed.slug || !parsed.projectId || !parsed.name) return null;
    return { slug: parsed.slug, projectId: parsed.projectId, name: parsed.name };
  } catch {
    return null;
  }
}

/** deployLinkFromProject without blocking the event loop. */
export async function deployLinkFromProjectAsync(cwd: string): Promise<RepoDeployLink | undefined> {
  const link = await loadProjectLinkAsync(cwd);
  if (!link) return undefined;
  return { ...link, url: publicAppUrl(link.slug) };
}

export function saveProjectLink(cwd: string, link: ProjectLink): void {
  const path = projectLinkPath(cwd);
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  writeFileSync(path, `${JSON.stringify(link, null, 2)}\n`, { mode: 0o600 });
}

/**
 * After a rename, point every local `.omg/project.json` that named the old
 * slug at the new one, so env, visibility and status calls keep finding the
 * app. Deploys go by projectId and would work regardless. Returns the folders
 * that changed.
 */
export function relinkRenamedApp(oldSlug: string, newSlug: string, folders: readonly string[]): string[] {
  if (!newSlug || oldSlug === newSlug) return [];
  const changed: string[] = [];
  for (const folder of new Set(folders)) {
    const link = loadProjectLink(folder);
    if (link?.slug !== oldSlug) continue;
    saveProjectLink(folder, { ...link, slug: newSlug });
    changed.push(folder);
  }
  return changed;
}

export type LinkAppInput = {
  cwd: string;
  slug: string;
  /** Replace a link this folder already has to a different app. */
  replace?: boolean;
};

export type LinkAppResult = RepoDeployLink & {
  /** False when the folder already linked to this app. */
  changed: boolean;
};

/**
 * Link a project folder to an app that already exists, so the next deploy
 * from the folder updates that app instead of creating a new one.
 *
 * A wrong link is worse than no link: the next deploy replaces another live
 * app. So the app must be in the caller's account, no other folder on this
 * computer may link to it, and an existing link changes only with `replace`.
 */
export async function linkProjectApp(
  client: Pick<CloudAppsClient, "listApps">,
  input: LinkAppInput,
  otherFolders: readonly string[],
): Promise<LinkAppResult> {
  const cwd = input.cwd.trim();
  const slug = input.slug.trim();
  if (!cwd || !isAbsolute(cwd)) throw new CloudAppsError("cwd must be an absolute project folder", 400);
  if (!slug) throw new CloudAppsError("slug is required", 400);
  if (!statSync(cwd, { throwIfNoEntry: false })?.isDirectory()) {
    throw new CloudAppsError(`${cwd} is not a folder`, 400);
  }
  const app = (await client.listApps()).find((row) => row.slug === slug);
  if (!app) throw new CloudAppsError(`No app ${slug} in this omg account`, 404);
  if (!app.projectId) {
    throw new CloudAppsError("omg Cloud did not return this app's id. Try again after the Cloud update ships.", 409);
  }
  const current = loadProjectLink(cwd);
  if (current?.projectId === app.projectId) {
    return { ...current, url: publicAppUrl(current.slug), changed: false };
  }
  if (current && !input.replace) {
    throw new CloudAppsError(
      `${basename(cwd)} already deploys to ${current.slug}. Pass replace: true only if the user asked to switch apps.`,
      409,
    );
  }
  const elsewhere = otherFolders.find((folder) =>
    folder !== cwd && loadProjectLink(folder)?.projectId === app.projectId);
  if (elsewhere) {
    throw new CloudAppsError(`${elsewhere} already deploys to ${slug}. Unlink it there first.`, 409);
  }
  const link: ProjectLink = { slug: app.slug, projectId: app.projectId, name: app.name };
  saveProjectLink(cwd, link);
  return { ...link, url: publicAppUrl(link.slug), changed: true };
}

/** Remove a folder's app link. The next deploy from it creates a new app. */
export function unlinkProjectApp(cwd: string): { unlinked: boolean } {
  const folder = cwd.trim();
  if (!folder || !isAbsolute(folder)) throw new CloudAppsError("cwd must be an absolute project folder", 400);
  if (!loadProjectLink(folder)) return { unlinked: false };
  rmSync(projectLinkPath(folder), { force: true });
  return { unlinked: true };
}

function shouldSkipName(name: string): boolean {
  if (ALWAYS_SKIP.has(name)) return true;
  if (name === ".env" || name.startsWith(".env.")) return true;
  return false;
}

function toGuestPath(rel: string): string {
  const posixRel = rel.split(sep).join(posix.sep);
  return `${GUEST_PROJECT_ROOT}/${posixRel}`;
}

export function collectProjectFiles(cwd: string): CollectedProject {
  const root = statSync(cwd);
  if (!root.isDirectory()) throw new Error(`not a directory: ${cwd}`);

  const files: CloudSourceFile[] = [];
  const skippedSecrets: string[] = [];
  const skippedLarge: string[] = [];
  let totalBytes = 0;

  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (shouldSkipName(entry.name)) {
        if (entry.name === ".env" || entry.name.startsWith(".env.")) skippedSecrets.push(entry.name);
        continue;
      }
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      if (!entry.isFile()) continue;
      const rel = relative(cwd, full);
      if (!rel || rel.startsWith("..")) continue;
      const bytes = statSync(full).size;
      if (bytes > MAX_FILE_BYTES) {
        skippedLarge.push(rel);
        continue;
      }
      totalBytes += bytes;
      if (files.length >= MAX_SOURCE_FILES) {
        throw new Error(`source contains more than ${MAX_SOURCE_FILES} files`);
      }
      if (totalBytes > MAX_TOTAL_BYTES) {
        throw new Error(`source exceeds the ${MAX_TOTAL_BYTES} byte total limit`);
      }
      files.push({
        path: toGuestPath(rel),
        content: readFileSync(full).toString("base64"),
        bytes,
      });
    }
  };
  walk(cwd);
  if (files.length === 0) throw new Error("no files to deploy");
  return { files, skippedSecrets, skippedLarge };
}

export function createRuntimeAppsClient(options: {
  getAccessToken: GetAuthToken;
  fetch?: FetchLike;
  controlPlaneUrl?: string;
}): CloudAppsClient {
  return createCloudAppsClient({
    getAuthToken: options.getAccessToken,
    fetch: options.fetch,
    userAgent: "omg-runtime",
    endpoints: {
      controlPlaneOrigin: (options.controlPlaneUrl ?? cloudApiBaseUrl()).replace(/\/+$/, ""),
    },
  });
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export async function waitForDeploy(
  client: CloudAppsClient,
  slug: string,
  options: {
    intervalMs?: number;
    timeoutMs?: number;
    sleep?: (ms: number) => Promise<void>;
    now?: () => number;
    onStatus?: (status: CloudDeployStatus) => void;
    /** Return the last status marked `pending` instead of throwing at the deadline. */
    pendingOnTimeout?: boolean;
  } = {},
): Promise<CloudDeployStatus & { pending?: true }> {
  const intervalMs = options.intervalMs ?? 2_000;
  const timeoutMs = options.timeoutMs ?? 10 * 60 * 1000;
  const sleep = options.sleep ?? defaultSleep;
  const now = options.now ?? Date.now;
  const deadline = now() + timeoutMs;
  let last: CloudDeployStatus = {};
  while (now() <= deadline) {
    last = await client.getStatus(slug);
    options.onStatus?.(last);
    if (isDeployDone(last)) return last;
    if (isDeployFailed(last)) {
      throw new CloudAppsError(last.buildError || `deploy failed (${last.phase ?? last.status})`, 502, last);
    }
    await sleep(intervalMs);
  }
  if (options.pendingOnTimeout) return { ...last, pending: true };
  throw new CloudAppsError(`deploy timed out for ${slug}`, 504, last);
}

/**
 * How long one agent tool call may wait for a build. MCP clients abort a
 * request after 60 seconds (-32001), and the build keeps running after that,
 * so a longer wait turns a working deploy into a reported failure.
 */
export const AGENT_DEPLOY_WAIT_MS = 45_000;

export async function deployFolder(
  client: CloudAppsClient,
  input: DeployFolderInput,
): Promise<DeployFolderResult> {
  const cwd = input.cwd;
  const startedAt = (input.now ?? Date.now)();
  const link = loadProjectLink(cwd);
  const collected = collectProjectFiles(cwd);
  const name = input.name?.trim() || link?.name || basename(cwd);
  const started = await client.deploySource({
    idempotencyKey: input.idempotencyKey ?? randomUUID(),
    name,
    files: collected.files,
    projectId: input.projectId ?? link?.projectId,
    generateIcon: input.generateIcon,
    ...(input.sessionId ? { sessionId: input.sessionId } : {}),
  });
  saveProjectLink(cwd, { slug: started.slug, projectId: started.projectId, name });
  const extras = {
    ...skippedSecretsInfo(collected.skippedSecrets),
    // A first deploy from a chat had no step that asked for store screenshots,
    // so most store pages (omg.dev/apps/<slug>) and "ready" emails showed no
    // picture of the app (2026-10-15).
    ...(link ? {} : { storeScreenshotsHint: STORE_SCREENSHOTS_HINT }),
  };
  if (!input.wait) return { ...started, ...extras };
  const status = await waitForDeploy(client, started.slug, {
    intervalMs: input.intervalMs,
    // The budget covers the whole call, upload included, so the agent's
    // request still answers before its client gives up.
    timeoutMs: input.waitBudgetMs !== undefined
      ? Math.max(0, input.waitBudgetMs - ((input.now ?? Date.now)() - startedAt))
      : input.timeoutMs,
    sleep: input.sleep,
    now: input.now,
    onStatus: input.onStatus,
    pendingOnTimeout: input.waitBudgetMs !== undefined,
  });
  return {
    ...started,
    url: typeof status.url === "string" && status.url ? status.url : started.url,
    status: status.status ?? started.status,
    latest: status,
    ...(status.pending ? { pending: true as const } : {}),
    ...extras,
  };
}

export const STORE_SCREENSHOTS_HINT =
  "When this build is ready, add store screenshots: open the live link at phone size (390x844) and capture its 3 main screens with real-looking sample data (no empty states, error screens or dev overlays). Put them in the app's public folder under omg-store/ (served as /omg-store/1.png, /omg-store/2.png, /omg-store/3.png; that folder is public even when the app needs sign-in), deploy again, and call omg_app_identity with screenshotUrls set to their live https links, in order. They show on the app's store page and in its \"ready\" email. Skip this for a slide deck or an app with no screens.";

function skippedSecretsInfo(names: string[]): Pick<DeployFolderResult, "skippedSecrets" | "envHint"> {
  const unique = [...new Set(names)];
  if (unique.length === 0) return {};
  return {
    skippedSecrets: unique,
    envHint:
      "Env files are never uploaded as files. To give the app these values, call omg_app_env with action import (it reads the file on this machine, so values stay out of chat), then deploy again.",
  };
}

/** Largest .env file accepted for import. Matches a generous real-world file. */
export const MAX_ENV_FILE_BYTES = 256 * 1024;

/**
 * Read a local dotenv file for import. Only `.env` and `.env.*` names are
 * accepted, so the import cannot be pointed at an arbitrary file. Cloud owns
 * the dotenv parser, so the contents go up unparsed.
 */
export function readEnvFile(path: string): string {
  const name = basename(path);
  if (name !== ".env" && !name.startsWith(".env.")) {
    throw new CloudAppsError(`only .env or .env.* files can be imported: ${path}`, 400);
  }
  let stats;
  try {
    stats = statSync(path);
  } catch {
    throw new CloudAppsError(`env file not found: ${path}`, 404);
  }
  if (!stats.isFile()) throw new CloudAppsError(`not a file: ${path}`, 400);
  if (stats.size > MAX_ENV_FILE_BYTES) {
    throw new CloudAppsError(`env file is larger than ${MAX_ENV_FILE_BYTES} bytes: ${path}`, 400);
  }
  return readFileSync(path, "utf8");
}

/**
 * Resolve the app for an env call: an explicit slug wins, else the folder's
 * `.omg/project.json`. The projectId rides along only when it belongs to the
 * same slug.
 */
export function resolveEnvTarget(input: { slug?: unknown; cwd?: unknown }): { slug: string; projectId?: string } {
  const slug = typeof input.slug === "string" ? input.slug.trim() : "";
  const cwd = typeof input.cwd === "string" ? input.cwd.trim() : "";
  const link = cwd ? loadProjectLink(cwd) : null;
  if (slug) return link?.slug === slug ? { slug, projectId: link.projectId } : { slug };
  if (link) return { slug: link.slug, projectId: link.projectId };
  throw new CloudAppsError(
    cwd ? `no deployed app is linked to ${cwd}; deploy first or pass slug` : "slug or cwd is required",
    400,
  );
}

const ICON_TYPES: Record<string, string> = {
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
};
const MAX_ICON_BYTES = 512 * 1024;

/**
 * Read a local icon file for omg_app_identity. The type comes from the
 * extension; Cloud checks the bytes match. Limits mirror Cloud's so the agent
 * gets the error before an upload.
 */
export function readIconFile(path: string): { contentType: string; dataBase64: string } {
  const ext = extname(path).toLowerCase();
  const contentType = ICON_TYPES[ext];
  if (!contentType) throw new CloudAppsError("icon must be an .svg, .png or .jpg file", 400);
  let data: Buffer;
  try {
    data = readFileSync(path);
  } catch {
    throw new CloudAppsError(`icon file not found: ${path}`, 400);
  }
  if (data.byteLength === 0) throw new CloudAppsError("icon file is empty", 400);
  if (data.byteLength > MAX_ICON_BYTES) throw new CloudAppsError("icon must be 512 KB or smaller", 400);
  return { contentType, dataBase64: data.toString("base64") };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

export const CLOUD_APPS_PATHS = [
  "/api/cloud/whoami",
  "/api/cloud/apps",
  "/api/cloud/apps/deploy",
  "/api/cloud/apps/status",
  "/api/cloud/apps/visibility",
  "/api/cloud/apps/rename",
  "/api/cloud/apps/test-checkout",
  "/api/cloud/apps/identity",
  "/api/cloud/apps/link",
  "/api/cloud/apps/unlink",
  "/api/cloud/env",
  "/api/cloud/env/pull",
  "/api/cloud/env/rm",
  "/api/cloud/env/import",
] as const;

async function envBody(req: Request): Promise<Record<string, unknown>> {
  const body = (await req.json().catch(() => null)) as unknown;
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new CloudAppsError("a JSON object body is required", 400);
  }
  return body as Record<string, unknown>;
}

/** Drop the local-only fields before the body goes to Cloud. */
function stripLocal(body: Record<string, unknown>): Record<string, unknown> {
  const { cwd: _cwd, file: _file, ...rest } = body;
  return rest;
}

export function isCloudAppsPath(path: string): boolean {
  return (CLOUD_APPS_PATHS as readonly string[]).includes(path);
}

export async function handleCloudAppsRequest(
  req: Request,
  url: URL,
  options: {
    getAccessToken: GetAuthToken;
    fetch?: FetchLike;
    controlPlaneUrl?: string;
    /** Project folders on this computer, to refuse a second link to one app. */
    projectFolders?: () => Promise<readonly string[]>;
  },
): Promise<Response | null> {
  const path = url.pathname;
  if (!isCloudAppsPath(path)) return null;
  const client = createRuntimeAppsClient(options);
  try {
    if (path === "/api/cloud/whoami" && req.method === "GET") {
      return jsonResponse(await client.whoami());
    }
    if (path === "/api/cloud/apps" && req.method === "GET") {
      return jsonResponse({ apps: await client.listApps() });
    }
    if (path === "/api/cloud/apps/status" && req.method === "GET") {
      const slug = url.searchParams.get("slug")?.trim() ?? "";
      if (!slug) return jsonResponse({ error: "slug is required" }, 400);
      if (url.searchParams.get("wait") === "1") {
        return jsonResponse(await waitForDeploy(client, slug, { timeoutMs: AGENT_DEPLOY_WAIT_MS, pendingOnTimeout: true }));
      }
      return jsonResponse(await client.getStatus(slug));
    }
    if (path === "/api/cloud/apps/visibility" && req.method === "GET") {
      const slug = url.searchParams.get("slug")?.trim() ?? "";
      if (!slug) return jsonResponse({ error: "slug is required" }, 400);
      return jsonResponse(await client.getVisibility(slug));
    }
    if (path === "/api/cloud/apps/visibility" && req.method === "POST") {
      const body = (await req.json().catch(() => null)) as { slug?: unknown; visibility?: unknown } | null;
      if (typeof body?.slug !== "string" || !body.slug.trim()) {
        return jsonResponse({ error: "slug is required" }, 400);
      }
      if (typeof body.visibility !== "string" || !body.visibility.trim()) {
        return jsonResponse({ error: "visibility is required" }, 400);
      }
      return jsonResponse(await client.setVisibility(body.slug.trim(), body.visibility.trim()));
    }
    if (path === "/api/cloud/apps/test-checkout" && req.method === "POST") {
      const body = await envBody(req);
      const action = typeof body.action === "string" ? body.action : "";
      if (action === "complete") {
        if (typeof body.checkout !== "string" || !body.checkout.trim()) {
          return jsonResponse({ error: "checkout is required: the checkout URL or id from billing.checkout()" }, 400);
        }
        return jsonResponse(await client.completeTestCheckout(body.checkout.trim()));
      }
      if (typeof body.slug !== "string" || !body.slug.trim()) {
        return jsonResponse({ error: "slug is required" }, 400);
      }
      const slug = body.slug.trim();
      if (action === "status") return jsonResponse(await client.getTestMode(slug));
      if (action === "enable" || action === "disable") {
        return jsonResponse(await client.setTestMode(slug, action === "enable"));
      }
      return jsonResponse({ error: "action must be status, enable, disable or complete" }, 400);
    }
    if (path === "/api/cloud/apps/rename" && req.method === "POST") {
      const body = await envBody(req);
      if (typeof body.slug !== "string" || !body.slug.trim()) {
        return jsonResponse({ error: "slug is required" }, 400);
      }
      if (typeof body.newSlug !== "string" || !body.newSlug.trim()) {
        return jsonResponse({ error: "newSlug is required" }, 400);
      }
      const renamed = await client.renameApp(body.slug.trim(), body.newSlug.trim());
      const folders = (await options.projectFolders?.()) ?? [];
      const extra = typeof body.cwd === "string" && body.cwd.trim() ? [body.cwd.trim()] : [];
      const relinked = relinkRenamedApp(body.slug.trim(), renamed.slug, [...extra, ...folders]);
      return jsonResponse({ ...renamed, relinkedFolders: relinked });
    }
    if (path === "/api/cloud/apps/identity" && req.method === "POST") {
      const body = (await req.json().catch(() => null)) as {
        slug?: unknown;
        name?: unknown;
        tagline?: unknown;
        iconPath?: unknown;
        screenshotUrls?: unknown;
      } | null;
      if (typeof body?.slug !== "string" || !body.slug.trim()) {
        return jsonResponse({ error: "slug is required" }, 400);
      }
      const icon = typeof body.iconPath === "string" && body.iconPath.trim()
        ? readIconFile(body.iconPath.trim())
        : undefined;
      return jsonResponse(await client.updateIdentity({
        slug: body.slug.trim(),
        ...(typeof body.name === "string" ? { name: body.name } : {}),
        ...(typeof body.tagline === "string" ? { tagline: body.tagline } : {}),
        ...(icon ? { icon } : {}),
        // Cloud owns the link rules (https, length, count); pass the list as is.
        ...(body.screenshotUrls !== undefined ? { screenshotUrls: body.screenshotUrls as string[] } : {}),
      }));
    }
    if (path === "/api/cloud/apps/deploy" && req.method === "POST") {
      const body = (await req.json().catch(() => null)) as {
        cwd?: unknown;
        name?: unknown;
        wait?: unknown;
        agentWait?: unknown;
        generateIcon?: unknown;
        sessionId?: unknown;
      } | null;
      if (typeof body?.cwd !== "string" || !body.cwd.trim()) {
        return jsonResponse({ error: "cwd is required" }, 400);
      }
      const deployed = await deployFolder(client, {
        cwd: body.cwd.trim(),
        name: typeof body.name === "string" ? body.name : undefined,
        wait: body.wait === true,
        // An agent tool call must answer before its client aborts the request.
        waitBudgetMs: body.agentWait === true ? AGENT_DEPLOY_WAIT_MS : undefined,
        generateIcon: body.generateIcon === true,
        sessionId: typeof body.sessionId === "string" && body.sessionId.trim()
          ? body.sessionId.trim()
          : req.headers.get("X-OMG-Session-ID")?.trim() || undefined,
      });
      return jsonResponse(deployed);
    }
    if (path === "/api/cloud/apps/link" && req.method === "POST") {
      const body = await envBody(req);
      if (typeof body.cwd !== "string" || typeof body.slug !== "string") {
        return jsonResponse({ error: "cwd and slug are required" }, 400);
      }
      const folders = (await options.projectFolders?.()) ?? [];
      return jsonResponse(await linkProjectApp(client, {
        cwd: body.cwd,
        slug: body.slug,
        replace: body.replace === true,
      }, folders));
    }
    if (path === "/api/cloud/apps/unlink" && req.method === "POST") {
      const body = await envBody(req);
      if (typeof body.cwd !== "string") return jsonResponse({ error: "cwd is required" }, 400);
      return jsonResponse(unlinkProjectApp(body.cwd));
    }
    if (path === "/api/cloud/env" && req.method === "GET") {
      const target = resolveEnvTarget({ slug: url.searchParams.get("slug"), cwd: url.searchParams.get("cwd") });
      return jsonResponse(await client.listEnv(target.slug, url.searchParams.get("projectId") ?? target.projectId));
    }
    if (path === "/api/cloud/env/pull" && req.method === "GET") {
      const slug = url.searchParams.get("slug")?.trim() ?? "";
      if (!slug) return jsonResponse({ error: "slug is required" }, 400);
      return jsonResponse(await client.pullEnv(slug, url.searchParams.get("projectId") ?? undefined));
    }
    if (path === "/api/cloud/env" && req.method === "POST") {
      const body = await envBody(req);
      return jsonResponse(await client.setEnv({ ...stripLocal(body), ...resolveEnvTarget(body) }));
    }
    if (path === "/api/cloud/env/rm" && req.method === "POST") {
      const body = await envBody(req);
      return jsonResponse(await client.removeEnv({ ...stripLocal(body), ...resolveEnvTarget(body) }));
    }
    if (path === "/api/cloud/env/import" && req.method === "POST") {
      const body = await envBody(req);
      const target = resolveEnvTarget(body);
      let contents = typeof body.contents === "string" ? body.contents : undefined;
      if (contents === undefined) {
        // Read the file here so the values never pass through the caller.
        const cwd = typeof body.cwd === "string" ? body.cwd.trim() : "";
        const file = typeof body.file === "string" && body.file.trim()
          ? (isAbsolute(body.file.trim()) || !cwd ? body.file.trim() : join(cwd, body.file.trim()))
          : cwd ? join(cwd, ".env") : "";
        if (!file) return jsonResponse({ error: "contents, file or cwd is required" }, 400);
        contents = readEnvFile(file);
      }
      return jsonResponse(await client.importEnv({ ...stripLocal(body), ...target, contents }));
    }
    return jsonResponse({ error: "method not allowed" }, 405);
  } catch (error) {
    const status = error instanceof CloudAppsError ? error.status : 500;
    const message = error instanceof Error ? error.message : "Cloud apps request failed";
    return jsonResponse({ error: message }, status);
  }
}
