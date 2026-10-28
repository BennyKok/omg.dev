import { useCallback, useLayoutEffect, useRef, type RefObject } from "react";

/**
 * A ref that holds the value from the latest committed render.
 *
 * Use it where a callback that outlives a render (a timer, a toast action, a
 * listener added once) must read current state. Do not write `ref.current`
 * during render instead: React Compiler skips a component that does, and then
 * every child re-renders on every render. See lib/attempt.ts for the other
 * patterns that make the compiler skip a component.
 *
 * The layout effect runs after commit and before the browser can deliver the
 * next input event, so a handler never reads a value older than the screen.
 * Do not read the ref during render; read the value itself there.
 */
export function useLatestRef<T>(value: T): RefObject<T> {
  const ref = useRef(value);
  useLayoutEffect(() => {
    ref.current = value;
  });
  return ref;
}

/**
 * A function that keeps one identity for the life of the component and calls
 * the latest `fn`. Pass it to children as an event handler: a child that gets
 * it does not re-render when `fn` closes over new state, such as each
 * keystroke of a draft.
 *
 * Call it from events, timers and effects only. During render it would call
 * the `fn` from the previous commit.
 */
export function useLatestCallback<A extends unknown[], R>(fn: (...args: A) => R): (...args: A) => R {
  const ref = useLatestRef(fn);
  return useCallback((...args: A) => ref.current(...args), [ref]);
}
