import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent, WheelEvent as ReactWheelEvent } from "react";
import { createPortal } from "react-dom";
import { Minus, Plus, RotateCcw, X } from "lucide-react";
import { cn } from "@/lib/utils";

const MIN_SCALE = 1;
const MAX_SCALE = 8;
const DOUBLE_CLICK_SCALE = 2.5;

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

type View = { scale: number; ox: number; oy: number };

const RESET: View = { scale: 1, ox: 0, oy: 0 };

/**
 * The box the full image will settle in, from its intrinsic size: as large as
 * the original allows, inside 92% of the viewport. Reserving it lets a smaller
 * preview fill the same frame, so nothing moves when the original lands.
 */
function lightboxBox(width: number | undefined, height: number | undefined) {
  if (!width || !height) return undefined;
  return {
    aspectRatio: `${width} / ${height}`,
    width: `min(${width}px, 92vw, calc(92vh * ${width / height}))`,
  };
}

/**
 * The open/close motion. A critically damped curve: it settles without
 * overshoot, because nothing was flicked. Both directions use the same curve
 * and nearly the same time, so the image returns along the path it came.
 */
const OPEN_MS = 340;
const CLOSE_MS = 280;
const SETTLE = "cubic-bezier(0.22, 1, 0.36, 1)";

function prefersReducedMotion() {
  return typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
}

/**
 * The transform that lays `stage` (measured with no transform) exactly over
 * `target`. Returns null when the target is not on screen, so the caller can
 * fall back to a fade rather than fly to a row that has scrolled away.
 */
function transformOnto(stage: DOMRect, target: DOMRect | null): string | null {
  if (!target || !stage.width || !stage.height || !target.width || !target.height) return null;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  if (target.bottom <= 0 || target.top >= vh || target.right <= 0 || target.left >= vw) return null;
  const sx = target.width / stage.width;
  const sy = target.height / stage.height;
  const dx = target.left - stage.left;
  const dy = target.top - stage.top;
  return `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})`;
}

/**
 * Full-screen click-to-zoom viewer for a single image. Renders through a portal
 * so it escapes the chat's overflow/stacking context. Zoom is anchored to the
 * cursor (wheel + double-click); drag pans once zoomed in.
 *
 * `placeholderSrc` is a smaller copy the page has usually painted already. It
 * is shown at once, and `src` replaces it only after its bytes have loaded, so
 * opening an image never shows an empty frame while a large original
 * downloads.
 */
export function ImageLightbox({
  src,
  placeholderSrc,
  width,
  height,
  alt,
  open,
  onClose,
  origin,
}: {
  src: string;
  placeholderSrc?: string;
  /** Intrinsic size of `src`, when known. Keeps the frame still on the swap. */
  width?: number;
  height?: number;
  alt?: string;
  open: boolean;
  onClose: () => void;
  /** The picture that was tapped. The viewer grows out of it on open and
   *  shrinks back into it on close. Without it the viewer fades. */
  origin?: HTMLElement | null;
}) {
  const imgRef = useRef<HTMLDivElement>(null);
  // `stage` carries the open/close motion. It is separate from `imgRef`, which
  // carries zoom and pan, so the two transforms never fight.
  const stageRef = useRef<HTMLDivElement>(null);
  const backdropRef = useRef<HTMLDivElement>(null);
  const controlsRef = useRef<HTMLDivElement>(null);
  const closing = useRef(false);
  const originRef = useRef(origin);
  originRef.current = origin;
  // The URL whose bytes have finished loading. Compared with `src`, so a new
  // `src` goes back to the placeholder without an effect.
  const [loadedSrc, setLoadedSrc] = useState<string | null>(null);
  const progressive = placeholderSrc !== undefined && placeholderSrc !== src;
  const fullReady = !progressive || loadedSrc === src;
  const [view, setView] = useState<View>(RESET);
  // Live screen position of every active pointer, keyed by pointerId. One entry
  // = drag-to-pan; two = pinch-zoom. Last pinch distance/midpoint lets us turn
  // each move into a scale ratio + pan delta.
  const pointers = useRef<Map<number, { x: number; y: number }>>(new Map());
  const pinch = useRef<{ dist: number; mx: number; my: number } | null>(null);
  // Whether the current gesture moved enough to count as a pan/pinch (so we
  // don't treat a lift as a tap-to-close).
  const moved = useRef(false);
  const [gesturing, setGesturing] = useState(false);

  // Reset the transform every time the viewer (re)opens.
  useEffect(() => {
    if (open) setView(RESET);
  }, [open, src]);

  // Grow out of the tapped picture. Measured before the first paint, so the
  // full-size frame is never seen before the motion starts.
  useLayoutEffect(() => {
    if (!open) return;
    closing.current = false;
    const stage = stageRef.current;
    const backdrop = backdropRef.current;
    if (!stage || !backdrop || typeof stage.animate !== "function") return;
    const timing = { duration: OPEN_MS, easing: SETTLE };
    const from = prefersReducedMotion()
      ? null
      : transformOnto(stage.getBoundingClientRect(), originRef.current?.getBoundingClientRect() ?? null);
    if (from) {
      stage.animate([{ transform: from }, { transform: "none" }], timing);
    } else {
      stage.animate([{ opacity: 0 }, { opacity: 1 }], { ...timing, duration: 200 });
    }
    backdrop.animate([{ opacity: 0 }, { opacity: 1 }], timing);
    controlsRef.current?.animate([{ opacity: 0 }, { opacity: 1 }], timing);
  }, [open]);

  /**
   * Shrink back into the picture, then tell the caller. Starts from where the
   * image is on screen right now, so closing during the opening motion turns
   * around in place instead of jumping to the end first.
   */
  const requestClose = useCallback(() => {
    const stage = stageRef.current;
    const backdrop = backdropRef.current;
    if (closing.current) return;
    if (!stage || !backdrop || typeof stage.animate !== "function") {
      onClose();
      return;
    }
    closing.current = true;
    setView(RESET);
    const liveTransform = getComputedStyle(stage).transform;
    const liveOpacity = getComputedStyle(backdrop).opacity;
    for (const el of [stage, backdrop, controlsRef.current]) {
      el?.getAnimations().forEach((animation) => animation.cancel());
    }
    const timing = { duration: CLOSE_MS, easing: SETTLE, fill: "forwards" as const };
    const to = prefersReducedMotion()
      ? null
      : transformOnto(stage.getBoundingClientRect(), originRef.current?.getBoundingClientRect() ?? null);
    const start = liveTransform && liveTransform !== "none" ? liveTransform : "none";
    const motion = to
      ? stage.animate([{ transform: start }, { transform: to }], timing)
      : stage.animate(
          [
            { transform: start, opacity: 1 },
            { transform: "scale(0.94)", opacity: 0 },
          ],
          { ...timing, duration: 200 },
        );
    backdrop.animate([{ opacity: liveOpacity }, { opacity: 0 }], timing);
    controlsRef.current?.animate([{ opacity: 1 }, { opacity: 0 }], { ...timing, duration: 150 });
    motion.onfinish = () => onClose();
    motion.oncancel = () => onClose();
  }, [onClose]);

  // Escape to close; lock body scroll while open.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") requestClose();
    };
    window.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [open, requestClose]);

  // Zoom toward a screen point (cx, cy), keeping the content under it fixed.
  const zoomAt = useCallback((nextScale: number, cx: number, cy: number) => {
    const el = imgRef.current;
    if (!el) return;
    setView((v) => {
      const target = clamp(nextScale, MIN_SCALE, MAX_SCALE);
      if (target === MIN_SCALE) return RESET;
      const rect = el.getBoundingClientRect();
      // Offset of the cursor from the element's current painted top-left.
      const dx = cx - rect.left;
      const dy = cy - rect.top;
      const ratio = target / v.scale;
      return {
        scale: target,
        ox: v.ox + dx * (1 - ratio),
        oy: v.oy + dy * (1 - ratio),
      };
    });
  }, []);

  const onWheel = useCallback(
    (e: ReactWheelEvent<HTMLDivElement>) => {
      e.preventDefault();
      const factor = Math.exp(-e.deltaY * 0.0015);
      setView((v) => {
        const el = imgRef.current;
        if (!el) return v;
        const target = clamp(v.scale * factor, MIN_SCALE, MAX_SCALE);
        if (target === MIN_SCALE) return RESET;
        const rect = el.getBoundingClientRect();
        const dx = e.clientX - rect.left;
        const dy = e.clientY - rect.top;
        const ratio = target / v.scale;
        return { scale: target, ox: v.ox + dx * (1 - ratio), oy: v.oy + dy * (1 - ratio) };
      });
    },
    [],
  );

  function onPointerDown(e: ReactPointerEvent<HTMLDivElement>) {
    e.currentTarget.setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    moved.current = false;
    setGesturing(true);
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      pinch.current = {
        dist: Math.hypot(a.x - b.x, a.y - b.y),
        mx: (a.x + b.x) / 2,
        my: (a.y + b.y) / 2,
      };
    }
  }

  function onPointerMove(e: ReactPointerEvent<HTMLDivElement>) {
    const map = pointers.current;
    const prev = map.get(e.pointerId);
    if (!prev) return;
    const next = { x: e.clientX, y: e.clientY };
    map.set(e.pointerId, next);

    // Two fingers → pinch-zoom anchored at the midpoint, plus follow the
    // midpoint's drift so the gesture pans at the same time.
    if (map.size >= 2 && pinch.current) {
      const [a, b] = [...map.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      const mx = (a.x + b.x) / 2;
      const my = (a.y + b.y) / 2;
      const el = imgRef.current;
      if (el && pinch.current.dist > 0) {
        const rect = el.getBoundingClientRect();
        const ratio = dist / pinch.current.dist;
        const panX = mx - pinch.current.mx;
        const panY = my - pinch.current.my;
        const dx = mx - rect.left;
        const dy = my - rect.top;
        setView((v) => {
          const target = clamp(v.scale * ratio, MIN_SCALE, MAX_SCALE);
          if (target === MIN_SCALE) return RESET;
          const r = target / v.scale;
          return {
            scale: target,
            ox: v.ox + dx * (1 - r) + panX,
            oy: v.oy + dy * (1 - r) + panY,
          };
        });
        moved.current = true;
      }
      pinch.current = { dist, mx, my };
      return;
    }

    // One finger / mouse → pan, but only once zoomed in.
    if (map.size === 1) {
      const dx = next.x - prev.x;
      const dy = next.y - prev.y;
      if (Math.abs(dx) > 2 || Math.abs(dy) > 2) moved.current = true;
      setView((v) => (v.scale <= MIN_SCALE ? v : { ...v, ox: v.ox + dx, oy: v.oy + dy }));
    }
  }

  function onPointerUp(e: ReactPointerEvent<HTMLDivElement>) {
    const map = pointers.current;
    map.delete(e.pointerId);
    if (map.size < 2) pinch.current = null;
    if (map.size === 0) {
      setGesturing(false);
      // A clean tap (no pan/pinch) while not zoomed dismisses the viewer.
      if (!moved.current && view.scale <= MIN_SCALE) requestClose();
    }
  }

  function onDoubleClick(e: ReactPointerEvent<HTMLDivElement>) {
    if (view.scale > MIN_SCALE) setView(RESET);
    else zoomAt(DOUBLE_CLICK_SCALE, e.clientX, e.clientY);
  }

  if (!open) return null;

  const zoomed = view.scale > MIN_SCALE;
  const box = lightboxBox(width, height);

  return createPortal(
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center"
      onWheel={onWheel}
      onPointerDown={(e) => {
        // Click on the backdrop (not the image) closes.
        if (e.target === e.currentTarget || e.target === backdropRef.current) requestClose();
      }}
      role="dialog"
      aria-modal="true"
      aria-label={alt || "Image viewer"}
    >
      {/* Its own layer, so it can fade while the image moves. */}
      <div ref={backdropRef} aria-hidden className="absolute inset-0 bg-black/80 backdrop-blur-sm" />
      {/* Controls */}
      <div ref={controlsRef} className="absolute right-3 top-3 z-10 flex items-center gap-1.5">
        <LightboxButton
          label="Zoom out"
          onClick={() => zoomAt(view.scale / 1.5, window.innerWidth / 2, window.innerHeight / 2)}
          disabled={!zoomed}
        >
          <Minus className="size-4" />
        </LightboxButton>
        <span className="min-w-[3.25rem] select-none text-center text-xs tabular-nums text-white/80">
          {Math.round(view.scale * 100)}%
        </span>
        <LightboxButton
          label="Zoom in"
          onClick={() => zoomAt(view.scale * 1.5, window.innerWidth / 2, window.innerHeight / 2)}
          disabled={view.scale >= MAX_SCALE}
        >
          <Plus className="size-4" />
        </LightboxButton>
        <LightboxButton label="Reset zoom" onClick={() => setView(RESET)} disabled={!zoomed}>
          <RotateCcw className="size-4" />
        </LightboxButton>
        <LightboxButton label="Close" onClick={requestClose}>
          <X className="size-4" />
        </LightboxButton>
      </div>

      <div ref={stageRef} className="relative" style={{ transformOrigin: "0 0", willChange: "transform" }}>
      <div
        ref={imgRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onDoubleClick={onDoubleClick}
        className={cn(
          "relative touch-none select-none",
          zoomed ? "cursor-grab active:cursor-grabbing" : "cursor-zoom-out",
        )}
        style={{
          ...box,
          transform: `translate(${view.ox}px, ${view.oy}px) scale(${view.scale})`,
          transformOrigin: "0 0",
          transition: gesturing ? "none" : "transform 120ms ease-out",
          touchAction: "none",
          willChange: "transform",
        }}
      >
        <img
          // The placeholder until the original has loaded. Swapping `src` on
          // one element keeps the picture painted through the change.
          src={fullReady ? src : placeholderSrc}
          alt={alt || "Image"}
          draggable={false}
          className={cn(
            "block object-contain",
            box ? "h-full w-full" : "max-h-[92vh] max-w-[92vw]",
          )}
        />
        {fullReady ? null : (
          // Downloads the original out of sight. It is never painted itself.
          <img
            src={src}
            alt=""
            aria-hidden
            className="hidden"
            onLoad={() => setLoadedSrc(src)}
          />
        )}
      </div>
      </div>
    </div>,
    document.body,
  );
}

function LightboxButton({
  label,
  onClick,
  disabled,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "flex size-9 items-center justify-center rounded-full bg-white/10 text-white backdrop-blur-sm transition-colors",
        "hover:bg-white/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/50",
        "disabled:pointer-events-none disabled:opacity-40",
      )}
    >
      {children}
    </button>
  );
}

/**
 * Inline image that opens {@link ImageLightbox} on click. Drop-in for a plain
 * `<img>` in message bubbles.
 */
export function ZoomableImage({
  src,
  alt,
  className,
}: {
  src: string;
  alt?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [origin, setOrigin] = useState<HTMLElement | null>(null);
  // Authenticated artifact images are already local blob URLs. Querying those
  // produces a different, invalid object URL; only server paths support the
  // generated-preview flag.
  const previewSrc = src.startsWith("blob:")
    ? src
    : src.includes("?")
      ? `${src}&preview=1`
      : `${src}?preview=1`;
  return (
    <>
      <img
        src={previewSrc}
        alt={alt}
        loading="lazy"
        decoding="async"
        onClick={(event) => {
          setOrigin(event.currentTarget);
          setOpen(true);
        }}
        // Hidden while the viewer is open: the viewer is this picture, moved.
        className={cn("cursor-zoom-in", open && "invisible", className)}
      />
      <ImageLightbox
        src={src}
        placeholderSrc={previewSrc}
        alt={alt}
        open={open}
        origin={origin}
        onClose={() => setOpen(false)}
      />
    </>
  );
}
