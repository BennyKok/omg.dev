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
  if (state.ready && state.status === "live" && !state.error) return null;
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

/** The first successful connection must retry a failed bootstrap. Later
 * reconnects reload only when the runtime process changed. */
export function shouldReloadRuntime(previousBootId: string | null, currentBootId: string | null): boolean {
  return !previousBootId || (!!currentBootId && previousBootId !== currentBootId);
}
