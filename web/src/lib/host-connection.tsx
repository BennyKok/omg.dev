// Whether a host owns this tree's connection display.
//
// A hosted page has its own full-page loading screen and its own retry. When
// the surface also drew its overlay, pill, toasts, startup pill and inline
// Retry, one wait showed up to four messages at once, and a hidden surface
// portaled its overlay on top of the host's other pages. A host that passes
// `onConnectionChange` takes the whole job: the surface reports its state and
// draws none of those itself.
//
// Per tree, like BareSurfaceProvider: one document can hold a full app surface
// and a settings surface at the same time.

import { createContext, useContext, useEffect, useRef, type ReactNode } from "react";
import type { ConnectionStatus } from "../useLiveSocket";
import type { RuntimeLifecycle } from "./runtime-lifecycle";

/** What the surface knows about its connection, reported to the host. */
export interface HostConnectionState {
  /** Socket state. "live" when the surface does not use a live socket. */
  status: ConnectionStatus;
  /** The first bootstrap is still loading. */
  loading: boolean;
  /** Bootstrap data is usable. */
  ready: boolean;
  /**
   * The surface shows its saved screen (the last startup state) while live
   * data loads. Never true once `ready` is: a saved screen is not live data.
   */
  saved: boolean;
  /** Last bootstrap error, while the surface retries it. */
  error: string | null;
  /** Why the runtime is not answering, from the cloud proxy, when it knows. */
  lifecycle: RuntimeLifecycle | null;
}

export type HostConnectionHandler = (state: HostConnectionState) => void;

const HostConnectionContext = createContext<HostConnectionHandler | null>(null);

export function HostConnectionProvider({
  onChange,
  children,
}: {
  onChange: HostConnectionHandler | undefined;
  children: ReactNode;
}) {
  return (
    <HostConnectionContext.Provider value={onChange ?? null}>{children}</HostConnectionContext.Provider>
  );
}

/** True when the host draws every connection message for this tree. */
export function useHostOwnsConnection(): boolean {
  return useContext(HostConnectionContext) !== null;
}

function sameState(a: HostConnectionState | null, b: HostConnectionState): boolean {
  return !!a && a.status === b.status && a.loading === b.loading && a.ready === b.ready
    && a.saved === b.saved && a.error === b.error && a.lifecycle === b.lifecycle;
}

/** Report each change of connection state to the host, once per change. */
export function useReportHostConnection(state: HostConnectionState): void {
  const onChange = useContext(HostConnectionContext);
  const last = useRef<HostConnectionState | null>(null);
  const { status, loading, ready, saved, error, lifecycle } = state;
  useEffect(() => {
    if (!onChange) return;
    const next = { status, loading, ready, saved, error, lifecycle };
    if (sameState(last.current, next)) return;
    last.current = next;
    onChange(next);
  }, [onChange, status, loading, ready, saved, error, lifecycle]);
}
