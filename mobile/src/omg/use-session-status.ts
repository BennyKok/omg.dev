import { useCallback, useEffect, useRef } from "react";
import { AppState } from "react-native";
import { useFocusEffect } from "expo-router";
import type { OmgConnectionStatus, OmgLiveConnection } from "@omg-dev/client";
import { observeSessionStatus, type SessionStatusState } from "./session-status";
import { recordConnectionTiming } from "./connection-trace";

/** One focused observer survives Bridge bootstrap; cloud still waits for readiness. */
export function useSessionStatus(options: {
  live: OmgLiveConnection | null;
  state: SessionStatusState;
  ready: boolean;
  cloud: boolean;
  denied: boolean;
  load: (quiet?: boolean) => Promise<void>;
  connectionChanged: (status: OmgConnectionStatus) => void;
}) {
  const latest = useRef(options);
  latest.current = options;
  const focused = useRef(false);
  const previousReady = useRef(options.ready);
  const allowed = !options.denied && (!options.cloud || options.ready);
  const { live, state, ready } = options;
  useFocusEffect(useCallback(() => {
    focused.current = true;
    let stop: (() => void) | undefined;
    const start = () => {
      if (!live || !allowed || stop) return;
      const unsubscribe = observeSessionStatus({
        live,
        apply: rows => { recordConnectionTiming("live.status"); return state.apply(rows); },
        refresh: quiet => { if (latest.current.ready) void latest.current.load(quiet); },
        connectionChanged: value => latest.current.connectionChanged(value),
      });
      stop = () => { unsubscribe(); stop = undefined; };
    };
    if (AppState.currentState === "active") start();
    const subscription = AppState.addEventListener("change", value => {
      if (value === "active") start();
      else stop?.();
    });
    return () => { focused.current = false; subscription.remove(); stop?.(); };
  }, [live, state, allowed]));
  useEffect(() => {
    if (ready && !previousReady.current && focused.current && AppState.currentState === "active") void latest.current.load();
    previousReady.current = ready;
  }, [ready]);
}
