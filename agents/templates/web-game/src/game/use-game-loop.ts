// Runs the fixed-timestep loop from requestAnimationFrame. `update(step)` runs
// at a fixed 1/60 s step; `draw(alpha)` paints the canvas once per screen
// frame, also while paused, so a resize never leaves a blank canvas.
//
// Game state lives in a ref, not in React state. React does not redraw each
// frame: read HUD numbers with `useLiveValue`, which redraws only when they change.
import { useEffect, useRef, useState } from "react";
import { createLoop, type LoopOptions } from "./loop";
import { testSpeed } from "./test-mode";

export function useGameLoop(
  update: (step: number) => void,
  options: { paused?: boolean; draw?: (alpha: number) => void } & LoopOptions = {},
): void {
  const { paused = false, draw, step, maxFrame, maxSteps } = options;
  const updateRef = useRef(update);
  const drawRef = useRef(draw);
  const pausedRef = useRef(paused);
  updateRef.current = update; // always the latest closure, no loop restart
  drawRef.current = draw;
  pausedRef.current = paused;

  useEffect(() => {
    const loop = createLoop({ step, maxFrame, maxSteps });
    let raf = 0;
    let last = 0;
    const tick = (now: number) => {
      const dt = last ? (now - last) / 1000 : 0;
      last = now;
      // testSpeed() is 1 except in check:play's test mode (?test=1), which ends a round quickly.
      if (!pausedRef.current) for (let i = testSpeed(); i > 0; i--) loop.advance(dt, (s) => updateRef.current(s));
      drawRef.current?.(loop.alpha());
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [step, maxFrame, maxSteps]);
}

/**
 * A value read from the game each frame, for the HUD. The component redraws
 * only when the value changes (compared as JSON), not 60 times a second.
 *
 *   const hud = useLiveValue(() => ({ score: game.current.score, time: Math.ceil(game.current.timeLeft) }));
 */
export function useLiveValue<T>(read: () => T): T {
  const readRef = useRef(read);
  readRef.current = read;
  const [value, setValue] = useState(read);
  const keyRef = useRef(JSON.stringify(value));
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const next = readRef.current();
      const key = JSON.stringify(next);
      if (key !== keyRef.current) {
        keyRef.current = key;
        setValue(next);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);
  return value;
}

/** Calls `onHidden` when the page goes to the background (app switch, lock screen, tab change). */
export function usePageHidden(onHidden: () => void): void {
  const ref = useRef(onHidden);
  ref.current = onHidden;
  useEffect(() => {
    const handle = () => {
      if (document.visibilityState === "hidden") ref.current();
    };
    document.addEventListener("visibilitychange", handle);
    return () => document.removeEventListener("visibilitychange", handle);
  }, []);
}
