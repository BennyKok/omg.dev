// Deploy a local folder through omg Cloud / Infra.
//
// One owner: collect the tree the way `/api/cli/apps/deploy-source` expects,
// POST it with the runtime credential, persist `.omg/project.json` so the next
// deploy updates the same slug. CLI, HTTP, and MCP are thin callers.

import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join, posix, relative, sep } from "node:path";
import { randomUUID } from "node:crypto";

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
  ".vibes",
  ".git",
  ".omg",
  ".DS_Store",
  ".next",
  ".turbo",
  "coverage",
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
};

export type DeployFolderResult = CloudDeployResult & {
  latest?: CloudDeployStatus;
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

export function saveProjectLink(cwd: string, link: ProjectLink): void {
  const path = projectLinkPath(cwd);
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  writeFileSync(path, `${JSON.stringify(link, null, 2)}\n`, { mode: 0o600 });
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
  } = {},
): Promise<CloudDeployStatus> {
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
  throw new CloudAppsError(`deploy timed out for ${slug}`, 504, last);
}

export async function deployFolder(
  client: CloudAppsClient,
  input: DeployFolderInput,
): Promise<DeployFolderResult> {
  const cwd = input.cwd;
  const link = loadProjectLink(cwd);
  const collected = collectProjectFiles(cwd);
  const name = input.name?.trim() || link?.name || basename(cwd);
  const started = await client.deploySource({
    idempotencyKey: input.idempotencyKey ?? randomUUID(),
    name,
    files: collected.files,
    projectId: input.projectId ?? link?.projectId,
    generateIcon: input.generateIcon,
  });
  saveProjectLink(cwd, { slug: started.slug, projectId: started.projectId, name });
  if (!input.wait) return started;
  const status = await waitForDeploy(client, started.slug, {
    intervalMs: input.intervalMs,
    timeoutMs: input.timeoutMs,
    sleep: input.sleep,
    now: input.now,
    onStatus: input.onStatus,
  });
  return {
    ...started,
    url: typeof status.url === "string" && status.url ? status.url : started.url,
    status: status.status ?? started.status,
    latest: status,
  };
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
  "/api/cloud/env",
  "/api/cloud/env/pull",
  "/api/cloud/env/rm",
  "/api/cloud/env/import",
] as const;

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
    if (path === "/api/cloud/apps/deploy" && req.method === "POST") {
      const body = (await req.json().catch(() => null)) as {
        cwd?: unknown;
        name?: unknown;
        wait?: unknown;
        generateIcon?: unknown;
      } | null;
      if (typeof body?.cwd !== "string" || !body.cwd.trim()) {
        return jsonResponse({ error: "cwd is required" }, 400);
      }
      const deployed = await deployFolder(client, {
        cwd: body.cwd.trim(),
        name: typeof body.name === "string" ? body.name : undefined,
        wait: body.wait === true,
        generateIcon: body.generateIcon === true,
      });
      return jsonResponse(deployed);
    }
    if (path === "/api/cloud/env" && req.method === "GET") {
      const slug = url.searchParams.get("slug")?.trim() ?? "";
      if (!slug) return jsonResponse({ error: "slug is required" }, 400);
      return jsonResponse(await client.listEnv(slug, url.searchParams.get("projectId") ?? undefined));
    }
    if (path === "/api/cloud/env/pull" && req.method === "GET") {
      const slug = url.searchParams.get("slug")?.trim() ?? "";
      if (!slug) return jsonResponse({ error: "slug is required" }, 400);
      return jsonResponse(await client.pullEnv(slug, url.searchParams.get("projectId") ?? undefined));
    }
    if (path === "/api/cloud/env" && req.method === "POST") {
      return jsonResponse(await client.setEnv(await req.json()));
    }
    if (path === "/api/cloud/env/rm" && req.method === "POST") {
      return jsonResponse(await client.removeEnv(await req.json()));
    }
    if (path === "/api/cloud/env/import" && req.method === "POST") {
      return jsonResponse(await client.importEnv(await req.json()));
    }
    return jsonResponse({ error: "method not allowed" }, 405);
  } catch (error) {
    const status = error instanceof CloudAppsError ? error.status : 500;
    const message = error instanceof Error ? error.message : "Cloud apps request failed";
    return jsonResponse({ error: message }, status);
  }
}
