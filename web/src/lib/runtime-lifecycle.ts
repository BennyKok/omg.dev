import { useEffect, useState } from "react";
import { omgFetch } from "./omg-client";

export type RuntimeLifecycle = "starting" | "waking" | "ready" | "failed" | "paused" | "unavailable";
const states: readonly string[] = ["starting", "waking", "ready", "failed", "paused", "unavailable"];
export function parseRuntimeLifecycle(value: unknown): RuntimeLifecycle | null {
  const state = value && typeof value === "object" ? (value as { state?: unknown }).state : null;
  return typeof state === "string" && states.includes(state) ? state as RuntimeLifecycle : null;
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
        if (!disposed) setSnapshot({ generation, state });
        if (response.ok && !state) return;
      } catch {
        if (!disposed) setSnapshot({ generation, state: null });
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
    case "waking": return "Waking your computer…";
    // Infrastructure can be ready before the client finishes its connection.
    case "ready": return "Connecting…";
    case "failed": return "Could not start your computer";
    case "paused": return "Computer paused";
    case "unavailable": return "Computer unavailable";
    default: return null;
  }
}
