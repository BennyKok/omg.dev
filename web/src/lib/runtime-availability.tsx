import { createContext, useContext } from "react";
import type { ConnectionStatus } from "../useLiveSocket";

import { runtimeLifecycleMessage, type RuntimeLifecycle } from "./runtime-lifecycle";

export type RuntimeAvailability = {
  lifecycle?: RuntimeLifecycle | null;
  status: ConnectionStatus;
  transportLive?: boolean;
  loading: boolean;
  ready: boolean;
  error: string | null;
  retry: () => void;
};
// App owns bootstrap and the socket. Consumers only read that same state.
export const RuntimeAvailabilityContext = createContext<RuntimeAvailability>({
  status: "live", loading: false, ready: true, error: null, retry: () => {},
});
export const useRuntimeAvailability = () => useContext(RuntimeAvailabilityContext);
/**
 * The one label for a runtime that is not live yet. Every surface that shows
 * connection state reads it here: the rail brand lockup, the standalone
 * recovery line, and the mobile header. They drifted as three copies of the
 * same three-way conditional.
 *
 * `null` means the runtime is live and no surface should say anything.
 */
export function runtimeStatusText(state: {
  loading: boolean;
  ready: boolean;
  status: ConnectionStatus;
  error: string | null;
  lifecycle?: RuntimeLifecycle | null;
}): string | null {
  if (runtimeIsLive(state)) return null;
  // The cloud proxy knows why the runtime is not answering yet, so its
  // lifecycle wins over the generic transport words when it has one.
  const lifecycle = runtimeLifecycleMessage(state.lifecycle);
  if (lifecycle) return lifecycle;
  if (state.loading || state.status === "connecting") return "Connecting…";
  if (state.status === "reconnecting") return "Reconnecting…";
  return "Connection unavailable";
}

export function runtimeErrorMessage(error: string): string {
  if (error.includes("cloud_runtime_unavailable")) return "Cannot connect to your cloud runtime.";
  if (/failed to fetch|networkerror|load failed|network request failed/i.test(error)) return "Cannot connect to this computer.";
  return "Could not load this computer. Please try again.";
}

/**
 * Whether a socket that just went live must re-run the bootstrap.
 *
 * - A bootstrap already in flight answers for this connection, so starting a
 *   second one only fetches everything twice. On a first open the socket and
 *   the first bootstrap race, and the socket often wins.
 * - Nothing loaded for this transport generation, or the last load failed:
 *   reload.
 * - Otherwise reload only when the runtime process changed. A runtime that
 *   sends no bootId (an older box) has nothing to compare, so its loaded
 *   bootstrap stands.
 */
export function shouldReloadRuntime(input: {
  inFlight: boolean;
  loaded: boolean;
  failed: boolean;
  previousBootId: string | null;
  currentBootId: string | null;
}): boolean {
  if (input.inFlight) return false;
  if (input.failed || !input.loaded) return true;
  return !!input.previousBootId && !!input.currentBootId && input.previousBootId !== input.currentBootId;
}

/** A connected runtime with usable bootstrap data has recovered, even if an older probe failed. */
export function runtimeIsLive(state: Pick<RuntimeAvailability, "ready" | "status">): boolean {
  return state.ready && state.status === "live";
}
