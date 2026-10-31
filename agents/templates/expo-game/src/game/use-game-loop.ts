// Runs a fixed-timestep loop from requestAnimationFrame. Game state lives in a
// ref, not in React state: update it inside `update(step)`.
//
// Each frame: run the game steps, then move every live object (`<Sprite of>`,
// `<Live of>`, the `World` camera) straight to its new position. React redraws
// the screen at most `renderHz` times per second (default 30) for the HUD,
// objects that appear or disappear, and colour changes. A full React redraw of
// a busy scene every frame is what makes a game stutter on a phone.
import { useEffect, useRef, useState } from "react";
import { createRenderGate, syncLive } from "./live";
import { createLoop, type LoopOptions } from "./loop";

export function useGameLoop(
  update: (step: number) => void,
  options: { paused?: boolean; renderHz?: number } & LoopOptions = {},
): number {
  const { paused = false, renderHz = 30, step, maxFrame, maxSteps } = options;
  const [frame, setFrame] = useState(0);
  const updateRef = useRef(update);
  updateRef.current = update; // always the latest closure, no loop restart

  useEffect(() => {
    if (paused) return;
    const loop = createLoop({ step, maxFrame, maxSteps });
    const gate = createRenderGate(renderHz);
    let raf = 0;
    let last = 0;
    const tick = (now: number) => {
      const dt = last ? (now - last) / 1000 : 0;
      last = now;
      loop.advance(dt, (s) => updateRef.current(s));
      syncLive();
      if (gate.due(now)) setFrame((f) => (f + 1) % 1_000_000);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [paused, renderHz, step, maxFrame, maxSteps]);

  return frame;
}
