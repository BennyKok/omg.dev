// Live drawing: things that move every frame are written straight to their
// views, without a React render. `<Sprite of={obj}>`, `<Live of={obj}>` and
// `World` register a writer here; `useGameLoop` calls `syncLive()` once per
// frame after the game step. React then only redraws at `renderHz` for the
// HUD, new or removed objects, and colour changes.
//
// No React and no DOM in this file.

export type LiveWriter = () => void;

const writers = new Set<LiveWriter>();

/** Register a writer. Returns the function that removes it. */
export function addLive(write: LiveWriter): () => void {
  writers.add(write);
  return () => {
    writers.delete(write);
  };
}

/** Push the current position of every live object to its view. */
export function syncLive(): void {
  for (const write of writers) write();
}

/** Number of registered writers. For checks and debugging. */
export function liveCount(): number {
  return writers.size;
}

/**
 * Decides which frames also redraw React. Motion is synced on every frame;
 * React redraws at most `hz` times per second. `hz` of 0 or less redraws every frame.
 */
export function createRenderGate(hz: number) {
  const interval = hz > 0 ? 1000 / hz : 0;
  let last = -Infinity;
  return {
    /** `now` in milliseconds. True when this frame should redraw React. */
    due(now: number): boolean {
      // The 1 ms slack keeps 60 Hz frames (16.7 ms) on a 30 Hz gate at every second frame.
      if (now - last + 1 < interval) return false;
      last = now;
      return true;
    },
    reset() {
      last = -Infinity;
    },
  };
}
