/**
 * Outer Cloud/Infra verbs: whoami, apps, deploy, visibility, env.
 *
 * These talk to `backend.omg.dev /api/cli/*`. The caller injects the token
 * (or omits it, so a Computer proxy can attach one). Nothing here knows
 * whether the runtime is a local box or a sandbox.
 */

import {
  resolveCloudEndpoints,
  type CloudEndpoints,
  type FetchLike,
  type GetAuthToken,
} from "./config";

export class CloudAppsError extends Error {
  constructor(
    message: string,
    readonly status = 500,
    readonly body: unknown = null,
  ) {
    super(message);
    this.name = "CloudAppsError";
  }
}

export type CloudWhoami = {
  userId: string;
  email?: string;
  name?: string;
};

export type CloudAppRow = {
  slug: string;
  name: string;
  /** The id a project folder links to. Missing on a control plane older than the field. */
  projectId?: string;
  sandboxState?: string;
  latestRunId?: string | null;
  dashboardUrl?: string;
  /** Missing on a control plane older than these fields. */
  iconUrl?: string | null;
  isLive?: boolean;
  appKind?: "app" | "game";
  /** The Cloud Computer session that last published the app. It belongs to the app whatever folder it ran in. */
  builtBySessionId?: string | null;
};

/** An app's visit numbers (control plane analytics.getVisitSummary). */
export type CloudAppVisits =
  | { enabled: false }
  | { enabled: true; days: number; visitors: number; pageviews: number; previousVisitors: number };

export type CloudDeployResult = {
  slug: string;
  url: string;
  status: string;
  projectId: string;
  runId: string;
  dashboardUrl: string;
};

export type CloudDeployStatus = {
  slug?: string;
  url?: string;
  status?: string;
  phase?: string;
  buildError?: string;
  buildLog?: string;
  static?: boolean;
  version?: number;
  runId?: string;
  updatedAt?: string;
  [extra: string]: unknown;
};

export type CloudVisibility = {
  visibility: "public" | "omg-users" | string;
  published?: boolean;
};

/** Checkout test mode for an app (see omg_app_test_checkout). */
export type CloudTestMode = { slug: string; testMode: boolean };

/** A completed test checkout: where the buyer would land next. */
export type CloudTestCheckoutResult = {
  ok?: boolean;
  slug: string;
  plan: string;
  redirectUrl: string;
  alreadyCompleted?: boolean;
};

/** Result of moving an app to a new address. The old address redirects. */
export type CloudAppRename = {
  ok?: boolean;
  slug: string;
  previousSlug?: string;
  url?: string;
};

export type CloudSourceFile = {
  path: string;
  content: string;
  bytes?: number;
};

export type CloudDeploySourceInput = {
  idempotencyKey: string;
  name?: string;
  files: CloudSourceFile[];
  projectId?: string;
  generateIcon?: boolean;
  /** The agent session that ran the deploy. Cloud links it from the app's "ready" email. */
  sessionId?: string;
};

export type CloudEnvSummary = {
  key?: string;
  [extra: string]: unknown;
};

export type CloudAppIdentityInput = {
  slug: string;
  name?: string;
  tagline?: string;
  icon?: { contentType: string; dataBase64: string };
  /** Store page screenshot links (https), in order. Replaces the whole set; [] clears it. */
  screenshotUrls?: string[];
};

export type CloudAppIdentity = {
  ok?: boolean;
  slug: string;
  name: string;
  tagline: string | null;
  iconUrl: string | null;
  /** Store page screenshots, in order. Missing from older servers. */
  screenshots?: string[];
};

export interface CloudAppsClient {
  whoami(): Promise<CloudWhoami>;
  listApps(): Promise<CloudAppRow[]>;
  deploySource(input: CloudDeploySourceInput): Promise<CloudDeployResult>;
  getStatus(slug: string): Promise<CloudDeployStatus>;
  getVisibility(slug: string): Promise<CloudVisibility>;
  getVisits(slug: string, days?: number): Promise<CloudAppVisits>;
  setVisibility(slug: string, visibility: string): Promise<{ ok?: boolean; visibility: string }>;
  renameApp(slug: string, newSlug: string): Promise<CloudAppRename>;
  getTestMode(slug: string): Promise<CloudTestMode>;
  setTestMode(slug: string, enabled: boolean): Promise<CloudTestMode>;
  completeTestCheckout(checkout: string): Promise<CloudTestCheckoutResult>;
  updateIdentity(input: CloudAppIdentityInput): Promise<CloudAppIdentity>;
  listEnv(slug: string, projectId?: string): Promise<{ slug?: string; vars: CloudEnvSummary[] }>;
  pullEnv(slug: string, projectId?: string): Promise<{ slug?: string; env: Record<string, string> }>;
  setEnv(body: unknown): Promise<unknown>;
  removeEnv(body: unknown): Promise<unknown>;
  importEnv(body: unknown): Promise<unknown>;
}

export const DEPLOY_DONE_PHASES = new Set(["ready", "succeeded"]);
export const DEPLOY_FAILED_PHASES = new Set(["failed", "error"]);

export function deployPhaseOf(status: CloudDeployStatus): string {
  const phase = status.phase ?? status.status ?? "";
  return String(phase).toLowerCase();
}

export function isDeployDone(status: CloudDeployStatus): boolean {
  return DEPLOY_DONE_PHASES.has(deployPhaseOf(status));
}

export function isDeployFailed(status: CloudDeployStatus): boolean {
  return DEPLOY_FAILED_PHASES.has(deployPhaseOf(status));
}

export interface CloudAppsOptions {
  getAuthToken: GetAuthToken;
  fetch?: FetchLike;
  endpoints?: Partial<CloudEndpoints>;
  userAgent?: string;
}

async function readJson(response: Response): Promise<unknown> {
  const text = await response.text().catch(() => "");
  if (!text) return {};
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return { error: text };
  }
}

export function createCloudAppsClient(options: CloudAppsOptions): CloudAppsClient {
  const endpoints = resolveCloudEndpoints(options.endpoints);
  const fetchImpl = options.fetch ?? globalThis.fetch;
  const userAgent = options.userAgent ?? "omg-runtime";

  async function request(path: string, init: RequestInit = {}): Promise<unknown> {
    const token = await options.getAuthToken();
    const headers = new Headers(init.headers);
    if (token) headers.set("Authorization", `Bearer ${token}`);
    if (!headers.has("Accept")) headers.set("Accept", "application/json");
    if (init.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
    if (!headers.has("User-Agent")) headers.set("User-Agent", userAgent);
    const url = `${endpoints.controlPlaneOrigin}${path}`;
    const response = await fetchImpl(url, { ...init, headers });
    const body = await readJson(response);
    if (!response.ok) {
      const message =
        body && typeof body === "object" && "error" in body && typeof (body as { error: unknown }).error === "string"
          ? (body as { error: string }).error
          : `Cloud request failed (${response.status})`;
      throw new CloudAppsError(message, response.status, body);
    }
    return body;
  }

  const get = (path: string) => request(path);
  const post = (path: string, body?: unknown) =>
    request(path, { method: "POST", body: body === undefined ? undefined : JSON.stringify(body) });

  return {
    async whoami() {
      return (await get("/api/cli/whoami")) as CloudWhoami;
    },
    async listApps() {
      const body = (await get("/api/cli/apps/list")) as { apps?: CloudAppRow[] };
      return Array.isArray(body.apps) ? body.apps : [];
    },
    async deploySource(input) {
      return (await post("/api/cli/apps/deploy-source", input)) as CloudDeployResult;
    },
    async getStatus(slug) {
      return (await get(`/api/cli/apps/status?slug=${encodeURIComponent(slug)}`)) as CloudDeployStatus;
    },
    async getVisits(slug, days = 7) {
      return (await get(`/api/cli/apps/stats?slug=${encodeURIComponent(slug)}&days=${days}`)) as CloudAppVisits;
    },
    async getVisibility(slug) {
      return (await get(`/api/cli/apps/visibility?slug=${encodeURIComponent(slug)}`)) as CloudVisibility;
    },
    async setVisibility(slug, visibility) {
      return (await post("/api/cli/apps/visibility", { slug, visibility })) as {
        ok?: boolean;
        visibility: string;
      };
    },
    async renameApp(slug, newSlug) {
      return (await post("/api/cli/apps/rename", { slug, newSlug })) as CloudAppRename;
    },
    async getTestMode(slug) {
      return (await get(`/api/cli/apps/test-mode?slug=${encodeURIComponent(slug)}`)) as CloudTestMode;
    },
    async setTestMode(slug, enabled) {
      return (await post("/api/cli/apps/test-mode", { slug, enabled })) as CloudTestMode;
    },
    async completeTestCheckout(checkout) {
      return (await post("/api/cli/apps/test-checkout/complete", { checkout })) as CloudTestCheckoutResult;
    },
    async updateIdentity(input) {
      return (await post("/api/cli/apps/identity", input)) as CloudAppIdentity;
    },
    async listEnv(slug, projectId) {
      const query = new URLSearchParams({ slug });
      if (projectId) query.set("projectId", projectId);
      return (await get(`/api/cli/env/list?${query}`)) as { slug?: string; vars: CloudEnvSummary[] };
    },
    async pullEnv(slug, projectId) {
      const query = new URLSearchParams({ slug });
      if (projectId) query.set("projectId", projectId);
      return (await get(`/api/cli/env/pull?${query}`)) as { slug?: string; env: Record<string, string> };
    },
    async setEnv(body) {
      return post("/api/cli/env/set", body);
    },
    async removeEnv(body) {
      return post("/api/cli/env/rm", body);
    },
    async importEnv(body) {
      return post("/api/cli/env/import", body);
    },
  };
}
