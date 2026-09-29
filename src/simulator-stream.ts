import type {
  ProjectPreview,
  SimulatorStream,
  SimulatorStreamProvider,
} from "../packages/protocol/src/project-preview.ts";
import { readFileSync } from "node:fs";
import { cloudApiBaseUrl, loadCloudCredentials } from "./cloud-account.ts";

/**
 * Level 2 of the Expo preview card: an iOS Simulator on a remote Mac,
 * streamed into the card. Shown only when the control plane marks this
 * Computer's owner as allowed (/etc/omg/preview-features.json). The env
 * `LFG_PREVIEW_SIMULATOR=1` or `=0` forces it on or off.
 *
 * The control plane owns the simulators (vibes control-plane/lib/sim-broker.ts).
 * This provider only relays the card's status polls and start/stop taps to
 * `/api/cli/sim/*`. A Cloud Computer reaches it through the guest proxy, which
 * attaches the owner's identity; a Computer on the user's own machine uses its
 * `omg login` token. The Computer never holds a Mac credential.
 */
export function simulatorStreamProvider(
  env: Record<string, string | undefined> = process.env,
  deps: BrokerDeps = {},
): SimulatorStreamProvider | null {
  // Explicit override for development and tests.
  if (env.LFG_PREVIEW_SIMULATOR === "0") return null;
  if (env.LFG_PREVIEW_SIMULATOR === "1") return brokerProvider(deps);
  // Otherwise the control plane decides per Computer owner: it writes
  // /etc/omg/preview-features.json on every wake (vibes cloud-computer.ts).
  const read = deps.readFeatures ?? readPreviewFeatures;
  const now = deps.now ?? Date.now;
  let cached: { at: number; on: boolean } | null = null;
  const provider = brokerProvider(deps);
  return {
    ...provider,
    available() {
      if (!cached || now() - cached.at > FEATURES_CACHE_MS) cached = { at: now(), on: read().simulator === true };
      return cached.on;
    },
  };
}

export const PREVIEW_FEATURES_FILE = "/etc/omg/preview-features.json";
const FEATURES_CACHE_MS = 5_000;

function readPreviewFeatures(): { simulator?: unknown } {
  try {
    return JSON.parse(readFileSync(PREVIEW_FEATURES_FILE, "utf8")) as { simulator?: unknown };
  } catch {
    return {};
  }
}

export interface BrokerDeps {
  fetch?: typeof fetch;
  readFeatures?: () => { simulator?: unknown };
  baseUrl?: () => string;
  token?: () => string | null;
  now?: () => number;
}

/** The card polls about every 3 s per open card; one broker call per 2 s is enough. */
const STATUS_CACHE_MS = 2_000;
const TIMEOUT_MS = 10_000;

export function brokerProvider(deps: BrokerDeps = {}): SimulatorStreamProvider {
  const doFetch = deps.fetch ?? fetch;
  const base = deps.baseUrl ?? (() => cloudApiBaseUrl());
  const token = deps.token ?? (() => loadCloudCredentials()?.token ?? null);
  const now = deps.now ?? Date.now;
  const cache = new Map<string, { at: number; value: SimulatorStream }>();

  async function call(op: "status" | "start" | "stop", preview: ProjectPreview): Promise<SimulatorStream> {
    const headers: Record<string, string> = { "content-type": "application/json" };
    const bearer = token();
    if (bearer) headers.authorization = `Bearer ${bearer}`;
    let response: Response;
    try {
      response = await doFetch(`${base()}/api/cli/sim/${op}`, {
        method: "POST",
        headers,
        body: JSON.stringify({ sessionId: preview.sessionId, expoGoUrl: preview.expoGoUrl }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch {
      return { state: "error", message: "The simulator service did not answer. Try again." };
    }
    if (response.status === 401 || response.status === 403) {
      return { state: "unavailable", message: "Sign in to omg.dev on this Computer to use the simulator preview." };
    }
    if (!response.ok) return { state: "error", message: "The simulator service failed. Try again." };
    return parseStream(await response.json().catch(() => null));
  }

  return {
    async status(preview) {
      const hit = cache.get(preview.sessionId);
      if (hit && now() - hit.at < STATUS_CACHE_MS) return hit.value;
      const value = await call("status", preview);
      cache.set(preview.sessionId, { at: now(), value });
      return value;
    },
    async start(preview) {
      cache.delete(preview.sessionId);
      return call("start", preview);
    },
    async stop(preview) {
      cache.delete(preview.sessionId);
      await call("stop", preview);
    },
  };
}

const STATES = new Set<SimulatorStream["state"]>(["idle", "queued", "starting", "ready", "unavailable", "error"]);
const PHASES = new Set<NonNullable<SimulatorStream["phase"]>>(["allocating", "booting", "opening", "loading_bundle"]);

/** Accept only the documented shape. The stream page must be HTTPS. */
export function parseStream(raw: unknown): SimulatorStream {
  const v = (raw ?? {}) as Record<string, unknown>;
  const state = STATES.has(v.state as SimulatorStream["state"]) ? (v.state as SimulatorStream["state"]) : null;
  if (!state) return { state: "error", message: "The simulator service sent an unexpected answer." };
  const out: SimulatorStream = { state };
  if (typeof v.streamId === "string") out.streamId = v.streamId;
  if (typeof v.streamUrl === "string" && v.streamUrl.startsWith("https://")) out.streamUrl = v.streamUrl;
  if (typeof v.expiresAt === "number") out.expiresAt = v.expiresAt;
  if (typeof v.queuePosition === "number") out.queuePosition = v.queuePosition;
  if (typeof v.etaMs === "number") out.etaMs = v.etaMs;
  if (PHASES.has(v.phase as NonNullable<SimulatorStream["phase"]>)) out.phase = v.phase as SimulatorStream["phase"];
  if (typeof v.progress === "number") out.progress = v.progress;
  if (typeof v.message === "string") out.message = v.message.slice(0, 300);
  if (state === "ready" && !out.streamUrl) return { state: "error", message: "The simulator stream has no address." };
  return out;
}
