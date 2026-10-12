// Fixed-timestep loop. Game rules run at a constant STEP (default 1/60 s) no
// matter how fast the screen redraws, so a race, a jump or a collision plays
// the same on a 60 Hz phone and a 120 Hz monitor.
//
// This file has no React and no DOM. `useGameLoop` (use-game-loop.ts) drives it
// from requestAnimationFrame; tests drive it with plain numbers.

export type LoopOptions = {
  /** Seconds per game step. */
  step?: number;
  /** Longest frame time that counts, in seconds. A tab that slept does not replay the gap. */
  maxFrame?: number;
  /** Most steps one frame may run. Stops a slow device from spiralling. */
  maxSteps?: number;
};

export type Loop = {
  readonly step: number;
  /** Add `dt` seconds of real time and run `update(step)` for each full step owed. Returns the steps run. */
  advance(dt: number, update: (step: number) => void): number;
  /** Fraction (0 to 1) of a step left over. Use it to blend a drawn position. */
  alpha(): number;
  reset(): void;
};

export function createLoop(options: LoopOptions = {}): Loop {
  const step = options.step ?? 1 / 60;
  const maxFrame = options.maxFrame ?? 0.25;
  const maxSteps = options.maxSteps ?? 8;
  let acc = 0;
  return {
    step,
    advance(dt, update) {
      if (!(dt > 0)) return 0;
      acc += Math.min(dt, maxFrame);
      let n = 0;
      // The 1e-9 absorbs float error: 3 frames of 1/60 must give 3 steps.
      while (acc + 1e-9 >= step && n < maxSteps) {
        update(step);
        acc -= step;
        n++;
      }
      if (n === maxSteps && acc > step) acc = 0; // drop the backlog
      if (acc < 0) acc = 0;
      return n;
    },
    alpha: () => acc / step,
    reset() {
      acc = 0;
    },
  };
}
