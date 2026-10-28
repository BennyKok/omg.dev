import { createContext, useContext, useEffect, useRef, useState, type DragEvent, type ReactNode, type Ref } from "react";
import { createPortal } from "react-dom";
import { toast } from "sonner";
import type { Session } from "../App";
import { api } from "../lib/omg-client";
import { setSubagentGroupOpen } from "../lib/subagent-group-open";
import { cn } from "../lib/utils";
import { attemptAsync } from "@/lib/attempt";
import { useLatestRef } from "@/lib/use-latest-ref";

export const SESSION_DRAG_TYPE = "application/x-omg-session";
const sessionId = (session: Session) => session.sessionId || session.nativeSessionId || "";
const matches = (session: Session, id: string) => session.sessionId === id || session.nativeSessionId === id;

// Touch drag. Phones do not turn a finger into HTML5 drag events, so a row
// carries its own long-press gesture: hold still for TOUCH_ARM_MS, then move.
// The row menu opens on a 500 ms still hold (Base UI's long press), so a
// hold-then-move under that lifts the row with no menu, and a move after the
// menu opened closes it and lifts the row. A move before the arm is a scroll.
export const TOUCH_ARM_MS = 300;
const TOUCH_SLOP = 10;
const EDGE_SCROLL = 56;
const MENU_QUIET_MS = 700;

/** Whether `child` may move under `target`: managed, not itself, not a descendant, not already there. */
function canReparent(sessions: readonly Session[], childId: string | null, target: Session): boolean {
  const child = childId ? sessions.find((item) => matches(item, childId)) : undefined;
  const id = sessionId(target);
  if (!child?.managed || !child.tmuxName || !id || !sessions.some((item) => matches(item, id))) return false;
  const currentParent = child.parentSessionId || child.parentNativeSessionId;
  if (currentParent && matches(target, currentParent)) return false;
  const seen = new Set<string>();
  let cursor: Session | undefined = target;
  while (cursor) {
    const cursorId = sessionId(cursor);
    if (matches(child, cursorId) || seen.has(cursorId)) return false;
    seen.add(cursorId);
    const up: string | null | undefined = cursor.parentSessionId || cursor.parentNativeSessionId;
    cursor = up ? sessions.find((item) => matches(item, up)) : undefined;
  }
  return true;
}

function scrollParent(element: HTMLElement): HTMLElement {
  for (let node = element.parentElement; node; node = node.parentElement) {
    const overflow = getComputedStyle(node).overflowY;
    if ((overflow === "auto" || overflow === "scroll") && node.scrollHeight > node.clientHeight) return node;
  }
  return (document.scrollingElement as HTMLElement | null) || document.documentElement;
}

type TouchDrag = { id: string; title: string; x: number; y: number; over: string | null };
const NO_SESSIONS: readonly Session[] = [];
const titleOf = (session: Session | undefined, id: string) => session?.title || id;
type ReparentResult = { changed?: boolean; parentNotified?: boolean; notificationError?: string };
const ReparentContext = createContext<{
  sessions: readonly Session[];
  dragging: string | null;
  pending: boolean;
  /** A touch drag is running. */
  touchDragging: boolean;
  /** The drop row under the finger during a touch drag. */
  touchOver: string | null;
  setDragging: (id: string | null) => void;
  move: (childId: string, parent: Session) => Promise<void>;
  touchStart: (id: string, title: string, x: number, y: number, source: HTMLElement) => void;
  touchMove: (x: number, y: number) => void;
  touchEnd: (drop: boolean) => void;
  /** True during a touch drag and just after it, when a row menu must not open. */
  menuBlocked: () => boolean;
} | null>(null);

export function SessionReparentProvider({ sessions, onRefresh, request = api, children }: {
  sessions: readonly Session[];
  onRefresh: () => Promise<void>;
  request?: typeof api;
  children: ReactNode;
}) {
  "use memo";
  const [dragging, setDragging] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [touch, setTouch] = useState<TouchDrag | null>(null);
  const inFlight = useRef(false);
  const touchRef = useRef<TouchDrag | null>(null);
  const scroller = useRef<HTMLElement | null>(null);
  const menuQuietUntil = useRef(0);
  const sessionsRef = useLatestRef(sessions);

  const move = async (childId: string, parent: Session) => {
    if (inFlight.current) return;
    inFlight.current = true;
    setPending(true);
    setDragging(null);
    await attemptAsync(async () => {
      const result = await request<ReparentResult>("/api/sessions/reparent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: childId, parentSessionId: sessionId(parent) }),
      });
      // The list folds all descendants under the family's root, even when
      // the drop target is itself a child shown in a stage column.
      let ancestor: Session | undefined = parent;
      const opened = new Set<string>();
      while (ancestor && !opened.has(sessionId(ancestor))) {
        const ancestorId = sessionId(ancestor);
        opened.add(ancestorId);
        setSubagentGroupOpen(ancestorId, true);
        const up: string | null | undefined = ancestor.parentSessionId || ancestor.parentNativeSessionId;
        ancestor = up ? sessionsRef.current.find((item) => matches(item, up)) : undefined;
      }
      if (result.parentNotified === false) {
        toast.warning(`Session moved. Parent notice failed: ${result.notificationError || "Could not send the notice"}`);
      } else if (result.changed !== false) {
        toast.success(result.parentNotified ? "Session moved. Parent session notified." : "Session moved.");
      }
      await attemptAsync(onRefresh, () => {
        toast.warning("Session moved. Refresh the session list to see the change.");
      });
    }, (error) => {
      toast.error(error instanceof Error ? error.message : "Could not move the session");
    }, () => {
      inFlight.current = false;
      setPending(false);
    });
  };

  // The row under a point. Rects, not elementFromPoint: an open row menu's
  // backdrop covers the list while the drag takes over from it.
  const dropAt = (x: number, y: number, childId: string): string | null => {
    let over: string | null = null;
    for (const element of document.querySelectorAll<HTMLElement>("[data-session-drag-id]")) {
      const rect = element.getBoundingClientRect();
      if (x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom) over = element.dataset.sessionDragId || null;
    }
    const target = over ? sessionsRef.current.find((item) => matches(item, over)) : undefined;
    return target && canReparent(sessionsRef.current, childId, target) ? over : null;
  };
  const showTouch = (next: TouchDrag | null) => { touchRef.current = next; setTouch(next); };
  const touchMove = (x: number, y: number) => {
    const current = touchRef.current;
    if (current) showTouch({ ...current, x, y, over: dropAt(x, y, current.id) });
  };
  const touchStart = (id: string, title: string, x: number, y: number, source: HTMLElement) => {
    menuQuietUntil.current = Number.POSITIVE_INFINITY;
    scroller.current = scrollParent(source);
    setDragging(id);
    showTouch({ id, title, x, y, over: dropAt(x, y, id) });
  };
  const touchEnd = (drop: boolean) => {
    const current = touchRef.current;
    showTouch(null);
    setDragging(null);
    menuQuietUntil.current = Date.now() + MENU_QUIET_MS;
    const target = drop && current?.over ? sessionsRef.current.find((item) => matches(item, current.over!)) : undefined;
    if (current && target) void move(current.id, target);
  };

  // Near the top or bottom edge, scroll the list so an off-screen parent can
  // be reached.
  const touchActive = !!touch;
  useEffect(() => {
    if (!touchActive) return;
    let frame = 0;
    const step = () => {
      const current = touchRef.current;
      const element = scroller.current;
      if (current && element) {
        const whole = element === document.scrollingElement || element === document.documentElement;
        const rect = whole ? { top: 0, bottom: window.innerHeight } : element.getBoundingClientRect();
        const speed = current.y < rect.top + EDGE_SCROLL ? -(rect.top + EDGE_SCROLL - current.y)
          : current.y > rect.bottom - EDGE_SCROLL ? current.y - (rect.bottom - EDGE_SCROLL) : 0;
        if (speed) {
          const before = element.scrollTop;
          element.scrollTop += Math.round(speed / 4) || Math.sign(speed);
          if (element.scrollTop !== before) touchMove(current.x, current.y);
        }
      }
      frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [touchActive]);

  // The list is published only during a drag, the one time a row reads it
  // (canReparent is false with nothing dragged). The list is a new array on
  // every status update, so publishing it always would re-render every row.
  return <ReparentContext.Provider value={{
    sessions: dragging ? sessions : NO_SESSIONS, dragging, pending, touchDragging: !!touch, touchOver: touch?.over ?? null, setDragging, move,
    touchStart, touchMove, touchEnd, menuBlocked: () => Date.now() < menuQuietUntil.current,
  }}>
    {children}
    {touch && typeof document !== "undefined" ? createPortal(
      // The finger covers the row under it, so the drop hint rides here.
      <div
        data-session-drag-ghost=""
        className="pointer-events-none fixed z-[100] flex max-w-[75vw] -translate-x-1/2 -translate-y-full flex-col items-center rounded-2xl bg-primary px-3 py-1.5 text-center text-primary-foreground shadow-lg"
        style={{ left: touch.x, top: touch.y - 28 }}
      >
        <span className="max-w-full truncate text-[13px] font-medium">{touch.title}</span>
        {touch.over ? <span data-session-drag-ghost-target="" className="max-w-full truncate text-[11px] opacity-90">
          Move under {titleOf(sessions.find((item) => matches(item, touch.over!)), touch.over)}
        </span> : null}
      </div>,
      document.body,
    ) : null}
  </ReparentContext.Provider>;
}

/**
 * For a row menu that opens on long press: whether a touch drag owns the
 * gesture (the menu must not open), and whether one is running now (an open
 * menu must close).
 */
export function useSessionDragMenuGuard() {
  const context = useContext(ReparentContext);
  return { blocked: () => !!context?.menuBlocked(), touchDragging: !!context?.touchDragging };
}

export function SessionReparentTarget({ session, children, className, ref, touch = false }: {
  session: Session;
  children: ReactNode;
  className?: string;
  ref?: Ref<HTMLDivElement>;
  /** Also lift the row with a long press and a finger move (phone lists). */
  touch?: boolean;
}) {
  "use memo";
  const context = useContext(ReparentContext);
  const [hovered, setHovered] = useState(false);
  useEffect(() => setHovered(false), [context?.dragging]);
  const id = sessionId(session);
  const draggable = !!context && !context.pending && !!id && !!session.managed && !!session.tmuxName;
  const canDrop = !!context && !context.pending && canReparent(context.sessions, context.dragging, session);
  const accepts = (event: DragEvent) => canDrop && event.dataTransfer.types.includes(SESSION_DRAG_TYPE);
  const highlighted = (hovered || (!!id && context?.touchOver === id)) && canDrop;

  const element = useRef<HTMLDivElement | null>(null);
  const gesture = useRef<{ x: number; y: number; armed: boolean; dragging: boolean; timer: ReturnType<typeof setTimeout> } | null>(null);
  const live = useLatestRef({ context, draggable, id, title: session.title || id });
  useEffect(() => {
    const node = element.current;
    if (!touch || !node) return;
    const clear = () => {
      const current = gesture.current;
      if (current) clearTimeout(current.timer);
      gesture.current = null;
      return current;
    };
    const cancel = () => { if (clear()?.dragging) live.current.context?.touchEnd(false); };
    const start = (event: TouchEvent) => {
      cancel();
      const target = event.target as Element | null;
      if (!live.current.draggable || event.touches.length !== 1 ||
          target?.closest?.("a, input, textarea, [contenteditable='true']")) return;
      const point = event.touches[0];
      const next = { x: point.clientX, y: point.clientY, armed: false, dragging: false, timer: setTimeout(() => {
        next.armed = true;
        navigator.vibrate?.(10);
      }, TOUCH_ARM_MS) };
      gesture.current = next;
    };
    const move = (event: TouchEvent) => {
      const current = gesture.current;
      const point = event.touches[0];
      if (!current) return;
      if (!point || event.touches.length !== 1) { cancel(); return; }
      if (!current.dragging) {
        const far = Math.abs(point.clientX - current.x) > TOUCH_SLOP || Math.abs(point.clientY - current.y) > TOUCH_SLOP;
        if (!current.armed) { if (far) clear(); return; }
        if (cancelable(event)) event.preventDefault();
        if (!far) return;
        current.dragging = true;
        live.current.context?.touchStart(live.current.id, live.current.title, point.clientX, point.clientY, node);
      }
      // The row's own swipe and the page scroll stay out of a lifted drag.
      if (cancelable(event)) event.preventDefault();
      event.stopPropagation();
      live.current.context?.touchMove(point.clientX, point.clientY);
    };
    const end = (event: TouchEvent) => {
      if (!clear()?.dragging) return;
      // No click on the row under the finger after a drop.
      if (cancelable(event)) event.preventDefault();
      live.current.context?.touchEnd(true);
    };
    node.addEventListener("touchstart", start, { passive: true });
    node.addEventListener("touchmove", move, { passive: false });
    node.addEventListener("touchend", end, { passive: false });
    node.addEventListener("touchcancel", cancel);
    return () => {
      node.removeEventListener("touchstart", start);
      node.removeEventListener("touchmove", move);
      node.removeEventListener("touchend", end);
      node.removeEventListener("touchcancel", cancel);
      cancel();
    };
  }, [touch]);

  return <div
    ref={(node) => {
      element.current = node;
      if (typeof ref === "function") ref(node);
      else if (ref) (ref as { current: HTMLDivElement | null }).current = node;
    }}
    draggable={draggable}
    data-session-drag-id={id || undefined}
    data-session-drop-target={highlighted || undefined}
    data-session-dragging={(!!id && context?.dragging === id) || undefined}
    title={highlighted ? `Move session under ${session.title || id}` : undefined}
    className={cn(
      "relative min-w-0",
      !!id && context?.dragging === id && "opacity-50",
      className,
    )}
    onDragStart={(event) => {
      // A finger is on the row: the touch gesture owns it, not the
      // browser's own drag (iOS starts one on a long press).
      if (gesture.current) { event.preventDefault(); return; }
      // Let file and link drags in nested controls keep their own behavior.
      if (!draggable || event.target !== event.currentTarget &&
          (event.target as Element).closest("a, input, textarea, [contenteditable='true']")) {
        if (event.target === event.currentTarget) event.preventDefault();
        return;
      }
      event.stopPropagation();
      event.dataTransfer.setData(SESSION_DRAG_TYPE, id);
      event.dataTransfer.effectAllowed = "move";
      context.setDragging(id);
    }}
    onDragEnd={() => { context?.setDragging(null); setHovered(false); }}
    onDragEnter={(event) => {
      if (!accepts(event)) return;
      event.preventDefault();
      event.stopPropagation();
      setHovered(true);
    }}
    onDragOver={(event) => {
      if (!accepts(event)) return;
      event.preventDefault();
      event.stopPropagation();
      event.dataTransfer.dropEffect = "move";
      setHovered(true);
    }}
    onDragLeave={(event) => {
      if (event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget)) return;
      setHovered(false);
    }}
    onDrop={(event) => {
      if (!accepts(event)) return;
      event.preventDefault();
      event.stopPropagation();
      setHovered(false);
      const childId = event.dataTransfer.getData(SESSION_DRAG_TYPE);
      if (childId !== context?.dragging) return;
      void context.move(childId, session);
    }}
    onClickCapture={(event) => {
      if (context?.dragging) { event.preventDefault(); event.stopPropagation(); }
    }}
  >
    {children}
    {/* Inset from the row's edges, so a rounded list card that clips its
        rows (overflow-hidden) never cuts the ring's corners. */}
    {highlighted ? <span data-session-drop-ring="" aria-hidden="true" className="pointer-events-none absolute inset-1 z-10 rounded-[12px] bg-primary/10 ring-2 ring-primary" /> : null}
    {/* Inside the row, centred: a list card clips anything above its first row. */}
    {highlighted && !context?.touchDragging ? <span className="pointer-events-none absolute left-1/2 top-1/2 z-20 max-w-[calc(100%-1.5rem)] -translate-x-1/2 -translate-y-1/2 truncate rounded-full bg-primary px-2 py-0.5 text-center text-[11px] font-medium text-primary-foreground shadow-sm">
      Move under {session.title || id}
    </span> : null}
  </div>;
}

function cancelable(event: TouchEvent) { return event.cancelable !== false; }
