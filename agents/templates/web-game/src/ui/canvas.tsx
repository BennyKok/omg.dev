// The game canvas and the hook that puts a 2D or 3D view on it.
//
//   const canvas = useCanvas();
//   const view = useGameView(loadView, canvas, { colors });   // see src/app/view.ts
//   useGameLoop(update, { draw: (alpha) => view.current?.draw(game.current, alpha) });
//   <div className="game-area"><GameCanvas canvas={canvas} /></div>
import { useEffect, useRef, useState, type RefObject } from "react";
import type { CanvasSize, GameView, ViewModule, ViewOptions } from "../game/view";

export type CanvasHandle = {
  ref: RefObject<HTMLCanvasElement | null>;
  /** Current size, for the loop and the view (no React redraw). */
  size: RefObject<CanvasSize>;
  /** The same size as React state, for layout. */
  width: number;
  height: number;
};

/** Measures the canvas element. The view sets the pixel buffer from this size. */
export function useCanvas(): CanvasHandle {
  const ref = useRef<HTMLCanvasElement | null>(null);
  const size = useRef<CanvasSize>({ width: 0, height: 0, dpr: 1 });
  const [state, setState] = useState({ width: 0, height: 0 });
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const measure = () => {
      const rect = canvas.getBoundingClientRect();
      const width = Math.round(rect.width);
      const height = Math.round(rect.height);
      size.current = { width, height, dpr: window.devicePixelRatio || 1 };
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
  return { ref, size, width: state.width, height: state.height };
}

/**
 * Load a view module and create its view on the canvas. Returns a ref that is
 * null until the view is ready (a 3D view first downloads three.js), so pause
 * the game until then.
 */
export function useGameView<G>(
  load: () => Promise<ViewModule<G>>,
  canvas: CanvasHandle,
  options: ViewOptions,
): { view: RefObject<GameView<G> | null>; ready: boolean; error: string | null } {
  const view = useRef<GameView<G> | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const optionsRef = useRef(options);
  optionsRef.current = options;

  useEffect(() => {
    let cancelled = false;
    load()
      .then((mod) => {
        const el = canvas.ref.current;
        if (cancelled || !el) return;
        const v = mod.createView(el, optionsRef.current);
        v.resize(canvas.size.current);
        view.current = v;
        setReady(true);
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      cancelled = true;
      view.current?.dispose();
      view.current = null;
      setReady(false);
    };
    // The view is created once per mount; options are read when it is created.
  }, [load, canvas.ref, canvas.size]);

  // Follow the canvas size.
  useEffect(() => {
    view.current?.resize(canvas.size.current);
  }, [canvas.width, canvas.height, canvas.size, ready]);

  return { view, ready, error };
}

/** The canvas element. It fills its parent; give the parent a size (the `game-area` class does). */
export function GameCanvas({ canvas, label = "Game" }: { canvas: CanvasHandle; label?: string }) {
  return <canvas ref={canvas.ref} className="game-canvas" role="img" aria-label={label} />;
}
