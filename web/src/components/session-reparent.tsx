import { createContext, useContext, useEffect, useRef, useState, type DragEvent, type ReactNode, type Ref } from "react";
import { toast } from "sonner";
import type { Session } from "../App";
import { api } from "../lib/omg-client";
import { setSubagentGroupOpen } from "../lib/subagent-group-open";
import { cn } from "../lib/utils";

export const SESSION_DRAG_TYPE = "application/x-omg-session";
const sessionId = (session: Session) => session.sessionId || session.nativeSessionId || "";
const matches = (session: Session, id: string) => session.sessionId === id || session.nativeSessionId === id;

type ReparentResult = { changed?: boolean; parentNotified?: boolean; notificationError?: string };
const ReparentContext = createContext<{
  sessions: readonly Session[];
  dragging: string | null;
  pending: boolean;
  setDragging: (id: string | null) => void;
  move: (childId: string, parent: Session) => Promise<void>;
} | null>(null);

export function SessionReparentProvider({ sessions, onRefresh, request = api, children }: {
  sessions: readonly Session[];
  onRefresh: () => Promise<void>;
  request?: typeof api;
  children: ReactNode;
}) {
  const [dragging, setDragging] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const inFlight = useRef(false);
  const move = async (childId: string, parent: Session) => {
    if (inFlight.current) return;
    inFlight.current = true;
    setPending(true);
    setDragging(null);
    try {
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
        ancestor = up ? sessions.find((item) => matches(item, up)) : undefined;
      }
      if (result.parentNotified === false) {
        toast.warning(`Session moved. Parent notice failed: ${result.notificationError || "Could not send the notice"}`);
      } else if (result.changed !== false) {
        toast.success(result.parentNotified ? "Session moved. Parent session notified." : "Session moved.");
      }
      try {
        await onRefresh();
      } catch {
        toast.warning("Session moved. Refresh the session list to see the change.");
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not move the session");
    } finally {
      inFlight.current = false;
      setPending(false);
    }
  };
  return <ReparentContext.Provider value={{ sessions, dragging, pending, setDragging, move }}>
    {children}
  </ReparentContext.Provider>;
}

export function SessionReparentTarget({ session, children, className, ref }: {
  session: Session;
  children: ReactNode;
  className?: string;
  ref?: Ref<HTMLDivElement>;
}) {
  const context = useContext(ReparentContext);
  const [hovered, setHovered] = useState(false);
  useEffect(() => setHovered(false), [context?.dragging]);
  const id = sessionId(session);
  const child = context?.sessions.find((item) => matches(item, context.dragging || ""));
  const draggable = !!context && !context.pending && !!id && !!session.managed && !!session.tmuxName;
  const canDrop = (() => {
    if (!context || context.pending || !child?.managed || !child.tmuxName || !id ||
        !context.sessions.some((item) => matches(item, id))) return false;
    const currentParent = child.parentSessionId || child.parentNativeSessionId;
    if (currentParent && matches(session, currentParent)) return false;
    const seen = new Set<string>();
    let cursor: Session | undefined = session;
    while (cursor) {
      const cursorId = sessionId(cursor);
      if (matches(child, cursorId) || seen.has(cursorId)) return false;
      seen.add(cursorId);
      const up: string | null | undefined = cursor.parentSessionId || cursor.parentNativeSessionId;
      cursor = up ? context.sessions.find((item) => matches(item, up)) : undefined;
    }
    return true;
  })();
  const accepts = (event: DragEvent) => canDrop && event.dataTransfer.types.includes(SESSION_DRAG_TYPE);
  const highlighted = hovered && canDrop;

  return <div
    ref={ref}
    draggable={draggable}
    data-session-drag-id={id || undefined}
    data-session-drop-target={highlighted || undefined}
    title={highlighted ? `Move session under ${session.title || id}` : undefined}
    className={cn("relative min-w-0", highlighted && "rounded-lg ring-2 ring-inset ring-primary bg-primary/10", className)}
    onDragStart={(event) => {
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
    {highlighted ? <span className="pointer-events-none absolute inset-x-1 -top-2 z-20 truncate rounded bg-primary px-1.5 py-0.5 text-center text-[10px] font-medium text-primary-foreground">
      Move under {session.title || id}
    </span> : null}
  </div>;
}
