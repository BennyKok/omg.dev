/**
 * `useState`, except that setting the value it already holds does nothing.
 *
 * React only skips a same-value update eagerly when the component has no
 * other pending work. Right after a commit that is often not true, so React
 * runs the component once more before it discovers that nothing changed. For
 * App that is a full render of the shell. The live hooks call their setters
 * after every session-list update, mostly with the value they already hold,
 * so on a busy server App rendered every few seconds for nothing.
 *
 * This setter computes the next value at once, against the latest value it
 * set, and only calls React when the value is a different reference. Every
 * update must go through this setter, which is true because it is the only one
 * returned. Updaters run when they are called, not during the next render.
 */
import { type SetStateAction, useCallback, useRef, useState } from "react";

export function useSkipSameState<T>(initial: T | (() => T)) {
  const [state, setState] = useState(initial);
  const latest = useRef(state);
  const set = useCallback((action: SetStateAction<T>) => {
    const next = typeof action === "function" ? (action as (prev: T) => T)(latest.current) : action;
    if (Object.is(next, latest.current)) return;
    latest.current = next;
    setState(next);
  }, []);
  return [state, set] as const;
}
