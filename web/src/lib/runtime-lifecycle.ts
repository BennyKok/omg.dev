import { useEffect, useState } from "react";
import { omgFetch } from "./omg-client";

/** `updating` is not a server state: the cloud proxy sends `ready` with
 * `updating: true` while the Computer installs a release and restarts. */
export type RuntimeLifecycle = "starting" | "waking" | "ready" | "updating" | "failed" | "paused" | "unavailable";
const states: readonly string[] = ["starting", "waking", "ready", "failed", "paused", "unavailable"];
export function parseRuntimeLifecycle(value: unknown): RuntimeLifecycle | null {
  const body = value && typeof value === "object" ? value as { state?: unknown; updating?: unknown } : null;
  const state = body?.state;
  if (typeof state !== "string" || !states.includes(state)) return null;
  return state === "ready" && body?.updating === true ? "updating" : state as RuntimeLifecycle;
}

/** The cloud proxy serves this read before the runtime can answer. Older and
 * local servers return 404, so they retain ordinary connection feedback. */
export function useRuntimeLifecycle(enabled: boolean, generation: number) {
  const [snapshot, setSnapshot] = useState<{ generation: number; state: RuntimeLifecycle | null } | null>(null);
  useEffect(() => {
    if (!enabled) { setSnapshot(null); return; }
    let disposed = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const controller = new AbortController();
    const poll = async () => {
      try {
        const response = await omgFetch("/api/runtime-status", { signal: controller.signal });
        if (disposed) return;
        if (response.status === 404 || response.status === 405) {
          setSnapshot({ generation, state: null });
          return;
        }
        const state = response.ok ? parseRuntimeLifecycle(await response.json()) : null;
        if (!disposed && state) setSnapshot({ generation, state });
        if (response.ok && !state) return;
      } catch {
        // A transient proxy/network failure must not replace known wake state
        // with a generic failure while the computer is still resuming.
      }
      if (!disposed) timer = setTimeout(poll, 3000);
    };
    void poll();
    return () => { disposed = true; controller.abort(); clearTimeout(timer); };
  }, [enabled, generation]);
  return enabled && snapshot?.generation === generation ? snapshot.state : null;
}

export function runtimeLifecycleMessage(state: RuntimeLifecycle | null | undefined): string | null {
  switch (state) {
    case "starting": return "Starting your computer…";
    case "waking": return "Resuming your computer…";
    // Infrastructure can be ready before the client finishes its connection.
    case "ready": return "Connecting…";
    case "updating": return "Updating your computer…";
    case "failed": return "Could not start your computer";
    case "paused": return "Resuming your computer…";
    case "unavailable": return "Computer unavailable";
    default: return null;
  }
}
