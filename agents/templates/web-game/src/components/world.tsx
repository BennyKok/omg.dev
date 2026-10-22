// The game canvas. One <canvas> fills its parent and stays sharp on high-DPI
// screens. Draw on it from the loop's `draw` callback with the helpers in
// src/game/draw.ts, in CSS pixels.
//
//   const canvas = useCanvas();
//   useGameLoop(update, { draw: () => {
//     const ctx = canvas.context();
//     if (!ctx) return;
//     const { width, height } = canvas.size.current;
//     drawGame(ctx, { game: game.current, cam, view: { x: 0, y: 0, w: width, h: height } });
//   } });
//   <div className="game-area"><GameCanvas canvas={canvas} /></div>
import { useCallback, useEffect, useRef, useState, type RefObject } from "react";

export type CanvasSize = { width: number; height: number; dpr: number };

export type CanvasHandle = {
  ref: RefObject<HTMLCanvasElement | null>;
  /** Current size, for the loop (no React redraw). */
  size: RefObject<CanvasSize>;
  /** The same size as React state, for layout. */
  width: number;
  height: number;
  /** The 2D context, scaled so 1 unit = 1 CSS pixel. Null before the canvas mounts. */
  context(): CanvasRenderingContext2D | null;
};

export function useCanvas(): CanvasHandle {
  const ref = useRef<HTMLCanvasElement | null>(null);
  const size = useRef<CanvasSize>({ width: 0, height: 0, dpr: 1 });
  const [state, setState] = useState({ width: 0, height: 0 });
  const ctxRef = useRef<CanvasRenderingContext2D | null>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const measure = () => {
      const rect = canvas.getBoundingClientRect();
      // Cap at 2x: a 3x phone screen costs 2.25 times the pixels for little visible gain.
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const width = Math.round(rect.width);
      const height = Math.round(rect.height);
      canvas.width = Math.max(1, Math.round(width * dpr));
      canvas.height = Math.max(1, Math.round(height * dpr));
      size.current = { width, height, dpr };
      setState((s) => (s.width === width && s.height === height ? s : { width, height }));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(canvas);
    window.addEventListener("orientationchange", measure);
    return () => {
      observer.disconnect();
      window.removeEventListener("orientationchange", measure);
    };
  }, []);

  const context = useCallback(() => {
    const canvas = ref.current;
    if (!canvas) return null;
    if (!ctxRef.current || ctxRef.current.canvas !== canvas) ctxRef.current = canvas.getContext("2d", { alpha: false });
    const ctx = ctxRef.current;
    if (!ctx) return null;
    const { dpr } = size.current;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return ctx;
  }, []);

  return { ref, size, width: state.width, height: state.height, context };
}

/** The canvas element. It fills its parent; give the parent a size (the `game-area` class does). */
export function GameCanvas({ canvas, label = "Game" }: { canvas: CanvasHandle; label?: string }) {
  return <canvas ref={canvas.ref} className="game-canvas" role="img" aria-label={label} />;
}
