import { createContext, useContext } from "react";
import type { ConnectionStatus } from "../useLiveSocket";

export type RuntimeAvailability = {
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
