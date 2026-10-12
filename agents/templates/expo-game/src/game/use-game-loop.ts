// Runs a fixed-timestep loop from requestAnimationFrame and redraws once per
// frame. Game state lives in a ref, not in React state: update it inside
// `update(step)` and read it while rendering. Only the frame counter is state.
import { useEffect, useRef, useState } from "react";
import { createLoop, type LoopOptions } from "./loop";

export function useGameLoop(update: (step: number) => void, options: { paused?: boolean } & LoopOptions = {}): number {
  const { paused = false, step, maxFrame, maxSteps } = options;
  const [frame, setFrame] = useState(0);
  const updateRef = useRef(update);
  updateRef.current = update; // always the latest closure, no loop restart

  useEffect(() => {
    if (paused) return;
    const loop = createLoop({ step, maxFrame, maxSteps });
    let raf = 0;
    let last = 0;
    const tick = (now: number) => {
      const dt = last ? (now - last) / 1000 : 0;
      last = now;
      loop.advance(dt, (s) => updateRef.current(s));
      setFrame((f) => (f + 1) % 1_000_000);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [paused, step, maxFrame, maxSteps]);

  return frame;
}
