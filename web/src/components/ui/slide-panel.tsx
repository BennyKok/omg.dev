/**
 * A modal panel that slides in from the left edge or the bottom edge, for the
 * phone surfaces that must feel instant: the side navigation and the agent
 * setup sheet.
 *
 * It is mounted before it is needed (when the browser is idle, or on the first
 * open) and then stays mounted, so opening it changes one attribute and CSS
 * slides the panel on the compositor. The curve starts fast, the way iOS does,
 * so the panel is visibly moving on the first frame after the tap.
 *
 * Both surfaces used to be react-aria Sheets. A Sheet mounts its whole content
 * on every tap, then enters with a smooth scroll whose duration and easing
 * belong to the browser: a slow start of about 300 ms, after the mount work had
 * finished. The swipe-to-dismiss the Sheet got from scrolling is a pointer
 * gesture here, and the panel follows the finger.
 */
import {
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";

export type SlidePanelEdge = "left" | "bottom";

/** How far a release must have dragged the panel, as a share of its size, to close it. */
const SWIPE_CLOSE_SHARE = 0.35;
/** A flick this fast (px per ms, toward the edge) closes regardless of distance. */
const SWIPE_CLOSE_VELOCITY = 0.4;
/** Movement before a touch is read as a dismiss drag or as a scroll. */
const SWIPE_SLOP = 8;

const FOCUSABLE =
  'a[href],button:not([disabled]),input:not([disabled]),select,textarea,[tabindex]:not([tabindex="-1"])';

/**
 * The app shell is hidden from assistive tech and focus while any panel is
 * open, the way a native modal hides the page under it. Counted, so a panel
 * that closes while another is still open does not expose the page early.
 */
let shellHiders = 0;
function hideShell(): () => void {
  const shell = typeof document === "undefined" ? null : document.getElementById("root");
  if (!shell) return () => {};
  shellHiders += 1;
  shell.inert = true;
  shell.setAttribute("aria-hidden", "true");
  let released = false;
  return () => {
    if (released) return;
    released = true;
    shellHiders -= 1;
    if (shellHiders > 0) return;
    shell.inert = false;
    shell.removeAttribute("aria-hidden");
  };
}

/** True when an element between `target` and `stop` can still scroll back toward its start. */
function scrolledAway(target: EventTarget | null, stop: Element | null, axis: "x" | "y"): boolean {
  let node = target instanceof Element ? target : null;
  while (node && node !== stop) {
    if (axis === "y" ? node.scrollTop > 0 : node.scrollLeft > 0) return true;
    node = node.parentElement;
  }
  return false;
}

export type SlidePanelProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  edge: SlidePanelEdge;
  /** The panel's accessible name, from a heading inside it. */
  labelledBy?: string;
  /** Used when there is no heading to point at. */
  label?: string;
  /** Classes for the sliding surface. Position it against the edge. */
  className?: string;
  backdropClassName?: string;
  /** `data-slot` of the surface, for tests and for styling hooks. */
  slot?: string;
  /** Stacking layer of the whole panel. */
  layer?: number;
  /** Where focus goes on open. Defaults to the panel itself. */
  initialFocus?: (panel: HTMLElement) => HTMLElement | null;
  /**
   * The content is not rendered again while the panel is closed. Change this
   * key to render it once anyway, off screen, ahead of the next open.
   */
  refreshKey?: unknown;
  children: ReactNode;
};

export function SlidePanel(props: SlidePanelProps) {
  const { open, refreshKey, children } = props;
  // A closed panel keeps the content it last showed. Its owner (App, or the
  // composer) renders on every live update, and an always-mounted panel would
  // otherwise render its whole content with it, for a surface nobody can see.
  // The same element reference lets React skip the subtree. Opening renders
  // the fresh content in the same commit that starts the slide.
  const content = useRef(children);
  const contentKey = useRef(refreshKey);
  if (open || !Object.is(contentKey.current, refreshKey)) {
    content.current = children;
    contentKey.current = refreshKey;
  }
  const [mounted, setMounted] = useState(open);
  if (open && !mounted) setMounted(true);
  // Mount ahead of the first tap, while nothing else is happening.
  useEffect(() => {
    if (mounted) return;
    const idle = (window as Window & { requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number })
      .requestIdleCallback;
    const cancelIdle = (window as Window & { cancelIdleCallback?: (id: number) => void }).cancelIdleCallback;
    if (idle) {
      const id = idle(() => setMounted(true), { timeout: 3000 });
      return () => cancelIdle?.(id);
    }
    const id = window.setTimeout(() => setMounted(true), 1500);
    return () => window.clearTimeout(id);
  }, [mounted]);
  if (!mounted || typeof document === "undefined") return null;
  return createPortal(<SlidePanelSurface {...props}>{content.current}</SlidePanelSurface>, document.body);
}

function SlidePanelSurface({
  open,
  onOpenChange,
  edge,
  labelledBy,
  label,
  className,
  backdropClassName,
  slot,
  layer = 180,
  initialFocus,
  children,
}: SlidePanelProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLElement>(null);
  const backdropRef = useRef<HTMLDivElement>(null);
  const onOpenChangeRef = useRef(onOpenChange);
  onOpenChangeRef.current = onOpenChange;
  const initialFocusRef = useRef(initialFocus);
  initialFocusRef.current = initialFocus;
  const close = useCallback(() => onOpenChangeRef.current(false), []);

  // A surface that mounts already open would paint open with no slide. Lay it
  // out closed once, then arm it, so even the cold first open animates.
  const [armed, setArmed] = useState(false);
  useLayoutEffect(() => {
    rootRef.current?.getBoundingClientRect();
    setArmed(true);
  }, []);
  const shown = open && armed;

  // Hidden from focus and assistive tech while closed. While open, the page
  // under it is hidden instead; focus moves in, and returns on close.
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    root.inert = !open;
    if (!open) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const releaseShell = hideShell();
    const panel = panelRef.current;
    if (panel) (initialFocusRef.current?.(panel) ?? panel).focus({ preventScroll: true });
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !event.defaultPrevented) {
        event.preventDefault();
        close();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      const hadFocus = !!panel?.contains(document.activeElement);
      releaseShell();
      if (previous?.isConnected && hadFocus) previous.focus({ preventScroll: true });
    };
  }, [open, close]);

  // Keep Tab inside the panel while it is open.
  const onKeyDown = (event: ReactKeyboardEvent<HTMLElement>) => {
    if (event.key !== "Tab") return;
    const panel = panelRef.current;
    if (!panel) return;
    const focusable = [...panel.querySelectorAll<HTMLElement>(FOCUSABLE)];
    if (focusable.length === 0) return;
    const first = focusable[0]!;
    const last = focusable[focusable.length - 1]!;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  // Swipe toward the edge to close. The panel follows the finger with no
  // transition and no React render; release either closes or springs back.
  const drag = useRef<{
    id: number;
    x: number;
    y: number;
    t: number;
    offset: number;
    mode: "pending" | "drag" | "scroll";
    size: number;
  } | null>(null);
  const suppressClick = useRef(false);
  // A tap on the dimmed page closes only when the press also began there. A
  // trigger that opens on pointerup (the composer's agent button) is followed
  // by the click of that same tap, which lands on the backdrop that has just
  // appeared under the finger, and closed the panel the moment it opened.
  const pressOnBackdrop = useRef(false);
  const endDrag = (commit: boolean) => {
    const state = drag.current;
    drag.current = null;
    const root = rootRef.current;
    const panel = panelRef.current;
    const backdrop = backdropRef.current;
    if (!state || state.mode !== "drag" || !root || !panel || !backdrop) return;
    suppressClick.current = true;
    window.setTimeout(() => {
      suppressClick.current = false;
    }, 0);
    // Re-enable the transition and drop the inline position in one style
    // change, so the panel animates from where the finger left it.
    root.removeAttribute("data-dragging");
    panel.style.transform = "";
    backdrop.style.opacity = "";
    if (!commit) return;
    const elapsed = Math.max(1, performance.now() - state.t);
    if (state.offset > state.size * SWIPE_CLOSE_SHARE || state.offset / elapsed > SWIPE_CLOSE_VELOCITY) close();
  };
  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!open || !event.isPrimary || (event.pointerType === "mouse" && event.button !== 0)) return;
    const panel = panelRef.current;
    drag.current = {
      id: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      t: performance.now(),
      offset: 0,
      mode: "pending",
      size: (edge === "left" ? panel?.offsetWidth : panel?.offsetHeight) || 1,
    };
  };
  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const state = drag.current;
    if (!state || state.id !== event.pointerId || state.mode === "scroll") return;
    const dx = event.clientX - state.x;
    const dy = event.clientY - state.y;
    // The distance moved toward the edge, and across it.
    const along = edge === "left" ? -dx : dy;
    const across = edge === "left" ? dy : dx;
    if (state.mode === "pending") {
      if (Math.abs(dx) < SWIPE_SLOP && Math.abs(dy) < SWIPE_SLOP) return;
      // A drag that starts inside a list scrolled away from its start is that
      // list scrolling back, not a dismiss.
      if (
        Math.abs(across) >= Math.abs(along) ||
        along < 0 ||
        scrolledAway(event.target, panelRef.current, edge === "left" ? "x" : "y")
      ) {
        state.mode = "scroll";
        return;
      }
      state.mode = "drag";
      // Measure velocity from the start of the drag, not from the touch.
      state.t = performance.now();
      state.x = event.clientX;
      state.y = event.clientY;
      rootRef.current?.setAttribute("data-dragging", "true");
      try {
        event.currentTarget.setPointerCapture(event.pointerId);
      } catch {
        // A synthetic or already-released pointer cannot be captured.
      }
      return;
    }
    const offset = Math.max(0, edge === "left" ? state.x - event.clientX : event.clientY - state.y);
    state.offset = offset;
    if (panelRef.current) {
      panelRef.current.style.transform =
        edge === "left" ? `translate3d(${-offset}px,0,0)` : `translate3d(0,${offset}px,0)`;
    }
    if (backdropRef.current) backdropRef.current.style.opacity = String(Math.max(0, 1 - offset / state.size));
  };

  // Once a dismiss drag owns the touch, stop the browser from also scrolling
  // or overscrolling under it. A passive React listener cannot do that.
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const onTouchMove = (event: TouchEvent) => {
      if (drag.current?.mode === "drag" && event.cancelable) event.preventDefault();
    };
    root.addEventListener("touchmove", onTouchMove, { passive: false });
    return () => root.removeEventListener("touchmove", onTouchMove);
  }, []);

  return (
    <div
      ref={rootRef}
      className="lfg-slide fixed inset-0"
      style={{ zIndex: layer }}
      data-open={shown ? "true" : "false"}
      data-edge={edge}
      aria-hidden={!open}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={() => endDrag(true)}
      onPointerCancel={() => endDrag(false)}
      onClickCapture={(event) => {
        if (!suppressClick.current) return;
        suppressClick.current = false;
        event.preventDefault();
        event.stopPropagation();
      }}
    >
      <div
        ref={backdropRef}
        data-slot="drawer-overlay"
        aria-hidden="true"
        className={cn("lfg-slide-backdrop absolute inset-0", backdropClassName)}
        onPointerDown={() => {
          pressOnBackdrop.current = open;
        }}
        // The backdrop cannot take focus, so a press on it would blur the panel
        // and drop focus to the body. That includes the mouse-compatibility
        // press of the very tap that opened the panel.
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => {
          const pressed = pressOnBackdrop.current;
          pressOnBackdrop.current = false;
          if (pressed) close();
        }}
      />
      <section
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        aria-label={labelledBy ? undefined : label}
        tabIndex={-1}
        data-slot={slot}
        onKeyDown={onKeyDown}
        className={cn("lfg-slide-panel absolute outline-none", className)}
      >
        {children}
      </section>
    </div>
  );
}
