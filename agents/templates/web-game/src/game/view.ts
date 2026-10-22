// The contract between the game and its renderer. The UI, loop, input and
// rules do not know whether the game is 2D or 3D: play.tsx loads a view
// module (src/app/view.ts) and calls these methods. A 2D view draws with the
// canvas 2D context (src/render/canvas2d.ts); a 3D view draws with three.js
// on the same canvas (src/render/three.ts).
//
// No React in this file.
import type { PlayerId } from "./input";

/** The canvas size in CSS pixels, and the screen's device pixel ratio (not yet capped). */
export type CanvasSize = { width: number; height: number; dpr: number };

/** A rectangle of the canvas in CSS pixels. Split screen gives one per player. */
export type Viewport = { x: number; y: number; w: number; h: number };

export type ViewOptions = {
  /** Colour of each player's ship, car or hero. */
  colors: Record<PlayerId, string>;
};

export interface GameView<G> {
  /** The canvas changed size. Set the pixel buffer here. */
  resize(size: CanvasSize): void;
  /** Runs at the fixed game step after the rules: move cameras here. */
  update?(game: G, dt: number): void;
  /** Runs once per screen frame. `alpha` is the leftover share of a step (0..1). */
  draw(game: G, alpha: number): void;
  /** Free GPU memory and listeners. */
  dispose(): void;
}

/** What a view file exports. Both coin-dash/view-2d.ts and view-3d.ts match it. */
export type ViewModule<G> = {
  createView(canvas: HTMLCanvasElement, options: ViewOptions): GameView<G>;
};

/** One viewport for one player, or two stacked ones with a gap for split screen. */
export function splitViewports(size: { width: number; height: number }, players: number, gap = 4): Viewport[] {
  const n = Math.max(1, players);
  const h = (size.height - gap * (n - 1)) / n;
  return Array.from({ length: n }, (_, i) => ({ x: 0, y: i * (h + gap), w: size.width, h }));
}

/** Cap the pixel ratio: a 3x phone screen costs 2.25 times the pixels of 2x for little visible gain. */
export const cappedDpr = (dpr: number, max: number): number => Math.max(0.5, Math.min(dpr || 1, max));
