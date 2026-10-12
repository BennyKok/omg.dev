// A countdown that survives reloads, with pause and resume.
//
//   const t = usePersistedTimer("focus", 25 * 60_000);
//   <Text>{formatClock(t.remainingMs)}</Text>
//   t.start(); t.pause(); t.resume(); t.reset();   t.finished is true at 0.
//
// `key` is the storage key: use one per timer. `t.ready` is false until the
// saved state loaded; do not show 25:00 before that.
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  idleTimer, isFinished, loadTimer, pauseTimer, remainingMs, resetTimer, resumeTimer, saveTimer, startTimer, type TimerState,
} from "./timer-core";

export { formatClock } from "./timer-core";

export function usePersistedTimer(key: string, durationMs: number) {
  const [state, setState] = useState<TimerState>(() => idleTimer(durationMs));
  const [ready, setReady] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const loaded = useRef(false);
  const stateRef = useRef(state);

  useEffect(() => {
    let live = true;
    void loadTimer(AsyncStorage, `omg-timer:${key}`, durationMs).then((s) => {
      if (!live) return;
      loaded.current = true;
      stateRef.current = s;
      setState(s);
      setNow(Date.now());
      setReady(true);
    });
    return () => { live = false; };
  }, [key, durationMs]);

  useEffect(() => {
    if (state.status !== "running") return;
    const id = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(id);
  }, [state.status]);

  const update = useCallback((fn: (s: TimerState, at: number) => TimerState) => {
    const at = Date.now();
    const next = fn(stateRef.current, at);
    stateRef.current = next;
    setState(next);
    setNow(at);
    if (loaded.current) void saveTimer(AsyncStorage, `omg-timer:${key}`, next);
  }, [key]);

  return {
    ready,
    status: state.status,
    remainingMs: remainingMs(state, now),
    finished: isFinished(state, now),
    start: useCallback(() => update(startTimer), [update]),
    pause: useCallback(() => update(pauseTimer), [update]),
    resume: useCallback(() => update(resumeTimer), [update]),
    reset: useCallback(() => update((s) => resetTimer(s)), [update]),
  };
}
