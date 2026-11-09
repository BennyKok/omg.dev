// A session's terminals, docked under its chat like an editor's bottom panel.
//
// It is a sibling of the chat in the session's flex column, so opening it
// pushes the transcript and composer up instead of covering them. The divider
// drags to resize; the height is remembered as a fraction of the column.
import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { lazyWithReload } from "@/lib/lazy-with-reload";

// Code-split: the terminal pulls in ghostty-web's WASM, so it loads only when
// a dock opens. lazyWithReload recovers from a stale chunk after a deploy.
const TerminalPanel = lazyWithReload("TerminalPanel", () =>
  import("./terminal-panel").then((m) => ({ default: m.TerminalPanel })),
);

export const DOCK_HEIGHT_KEY = "lfg_term_dock_height";
const DEFAULT_FRACTION = 0.42;
const MIN_FRACTION = 0.18;
const MAX_FRACTION = 0.9;

export function clampDockFraction(f: number): number {
  if (!Number.isFinite(f)) return DEFAULT_FRACTION;
  return Math.min(MAX_FRACTION, Math.max(MIN_FRACTION, f));
}

function readFraction(): number {
  try {
    const raw = localStorage.getItem(DOCK_HEIGHT_KEY);
    return raw ? clampDockFraction(Number(raw)) : DEFAULT_FRACTION;
  } catch {
    return DEFAULT_FRACTION;
  }
}

export function SessionTerminalDock({
  sessionId,
  label,
  onClose,
}: {
  sessionId: string;
  label?: string;
  onClose: () => void;
}) {
  const dockRef = useRef<HTMLDivElement>(null);
  const [fraction, setFraction] = useState(readFraction);
  const [maximized, setMaximized] = useState(false);
  const [dragging, setDragging] = useState(false);
  const drag = useRef<{ top: number; height: number } | null>(null);

  const onPointerDown = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    const parent = dockRef.current?.parentElement;
    if (!parent || e.button !== 0) return;
    const rect = parent.getBoundingClientRect();
    if (rect.height <= 0) return;
    drag.current = { top: rect.top, height: rect.height };
    e.currentTarget.setPointerCapture(e.pointerId);
    setMaximized(false);
    setDragging(true);
    e.preventDefault();
  }, []);

  const onPointerMove = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d) return;
    setFraction(clampDockFraction((d.top + d.height - e.clientY) / d.height));
  }, []);

  const endDrag = useCallback(() => {
    if (!drag.current) return;
    drag.current = null;
    setDragging(false);
    setFraction((f) => {
      try {
        localStorage.setItem(DOCK_HEIGHT_KEY, String(Math.round(f * 1000) / 1000));
      } catch {}
      return f;
    });
  }, []);

  // ⌃` hides the dock, as in an editor's terminal panel. Escape stays with
  // the shell: it belongs to whatever TUI is running. Capture phase, so the
  // shell does not also get the NUL byte that ⌃` would type.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "`" || !e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return;
      e.preventDefault();
      e.stopPropagation();
      onClose();
    };
    const el = dockRef.current;
    el?.addEventListener("keydown", onKey, true);
    return () => el?.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  return (
    <div
      ref={dockRef}
      data-testid="session-terminal-dock"
      data-maximized={maximized ? "true" : "false"}
      className="lfg-term-dock relative flex min-h-[9rem] shrink-0 flex-col border-t border-border bg-[#0b0b0d]"
      style={{ height: maximized ? "100%" : `${(fraction * 100).toFixed(2)}%` }}
    >
      {/* The divider: a thin line with a generous hit area that straddles it. */}
      <div
        role="separator"
        aria-orientation="horizontal"
        aria-label="Resize terminal"
        aria-valuemin={Math.round(MIN_FRACTION * 100)}
        aria-valuemax={Math.round(MAX_FRACTION * 100)}
        aria-valuenow={Math.round((maximized ? 1 : fraction) * 100)}
        tabIndex={0}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onDoubleClick={() => setMaximized((m) => !m)}
        onKeyDown={(e) => {
          const step = e.shiftKey ? 0.1 : 0.04;
          if (e.key === "ArrowUp" || e.key === "ArrowDown") {
            e.preventDefault();
            setMaximized(false);
            setFraction((f) => {
              const next = clampDockFraction(f + (e.key === "ArrowUp" ? step : -step));
              try {
                localStorage.setItem(DOCK_HEIGHT_KEY, String(Math.round(next * 1000) / 1000));
              } catch {}
              return next;
            });
          }
        }}
        style={{ touchAction: "none" }}
        className={`absolute inset-x-0 -top-1.5 z-30 h-3 cursor-row-resize outline-none after:absolute after:inset-x-0 after:top-1.5 after:h-px after:transition-colors focus-visible:after:bg-sky-400 ${
          dragging ? "after:bg-sky-400" : "hover:after:bg-white/30"
        }`}
      />
      {/* While dragging, the canvas must not swallow pointer moves. */}
      <div className={`min-h-0 flex-1 ${dragging ? "pointer-events-none" : ""}`}>
        <Suspense
          fallback={
            <div className="grid h-full place-items-center text-xs text-white/50">Loading terminal…</div>
          }
        >
          <TerminalPanel
            scope={{ sessionId }}
            label={label}
            onClose={onClose}
            maximized={maximized}
            onToggleMaximize={() => setMaximized((m) => !m)}
          />
        </Suspense>
      </div>
    </div>
  );
}
