import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useRuntimeAvailability, runtimeIsLive } from "../lib/runtime-availability";
import {
  connectionOverlayView,
  PILL_AFTER_MS,
  type ConnectionOverlayMode,
  type ConnectionOverlayView,
} from "../lib/connection-overlay";
import { Boxy } from "./boxy";

/** Hidden at least this long counts as leaving and coming back. */
const RESUME_AWAY_MS = 5_000;
/** How long "Resuming…" can stand in for "Reconnecting…" after a return. */
const RESUME_WINDOW_MS = 15_000;
/** How long the happy "Connected" moment stays before it fades. */
const BACK_MS = 1_200;

function useNow(nextChangeMs: number | null): void {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (nextChangeMs === null) return;
    const timer = setTimeout(() => setTick((n) => n + 1), Math.max(16, nextChangeMs));
    return () => clearTimeout(timer);
  }, [nextChangeMs, tick]);
}

/** True for a short window after the page returns from the background. */
function useResuming(): boolean {
  const [until, setUntil] = useState(0);
  const hiddenAt = useRef<number | null>(null);
  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === "hidden") {
        hiddenAt.current = Date.now();
        return;
      }
      const away = hiddenAt.current === null ? 0 : Date.now() - hiddenAt.current;
      hiddenAt.current = null;
      if (away >= RESUME_AWAY_MS) setUntil(Date.now() + RESUME_WINDOW_MS);
    };
    const onPageShow = (event: PageTransitionEvent) => {
      if (event.persisted) setUntil(Date.now() + RESUME_WINDOW_MS);
    };
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pageshow", onPageShow);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pageshow", onPageShow);
    };
  }, []);
  const remaining = until - Date.now();
  useNow(remaining > 0 ? remaining : null);
  return remaining > 0;
}

/**
 * The one connection surface for the whole app. It reads the runtime state
 * that App owns and never keeps its own copy of the connection.
 *
 * - A short blip shows nothing.
 * - A longer reconnect, resume, or wake shows a pill at the top for as long
 *   as it lasts. The app stays usable.
 * - A hard failure, or a first load with nothing to show, dims the app and
 *   shows Boxy, Retry, and the computer switcher. The app stays visible behind it, so the screen is
 *   never blank, and the user can always move to another computer.
 * - When the connection returns, Boxy smiles for a moment in the same place
 *   and fades out. The surface is never unmounted in between.
 */
export function ConnectionOverlay({ machineSwitcher }: { machineSwitcher?: ReactNode }) {
  const availability = useRuntimeAvailability();
  const resuming = useResuming();
  const notLive = !runtimeIsLive(availability);

  const [notLiveSince, setNotLiveSince] = useState<number | null>(() => (notLive ? Date.now() : null));
  useEffect(() => {
    setNotLiveSince((since) => (notLive ? since ?? Date.now() : null));
  }, [notLive]);

  // Once a surface is visible, a change of wait state must not remove it
  // during the next state's quiet threshold. Move straight into its pill.
  const lastShown = useRef<ConnectionOverlayMode>("hidden");
  const view = connectionOverlayView({
    ...availability,
    notLiveMs: Math.max(lastShown.current === "hidden" ? 0 : PILL_AFTER_MS, notLiveSince === null ? 0 : Date.now() - notLiveSince),
    resuming,
  });
  useNow(view.nextChangeMs);

  // Remember what was on screen so the recovery can answer in the same place.
  const [back, setBack] = useState<ConnectionOverlayMode>("hidden");
  useEffect(() => {
    if (view.mode !== "hidden") {
      lastShown.current = view.mode;
      setBack("hidden");
      return;
    }
    // Not live but still under the pill threshold: wait. A short flap (the
    // first connect reloads its bootstrap at once) must not cut "Connected"
    // short; its own timer closes it, and a real drop brings the pill.
    if (notLive) return;
    if (lastShown.current === "hidden") return;
    setBack(lastShown.current);
    lastShown.current = "hidden";
  }, [view.mode, notLive]);
  // The close timer belongs to the "Connected" moment alone. When it shared
  // the effect above, a brief flap right after recovery (the runtime reloads
  // its bootstrap) cancelled it and nothing restarted it, so "Connected"
  // stayed on screen for good.
  useEffect(() => {
    if (back === "hidden") return;
    const timer = setTimeout(() => setBack("hidden"), BACK_MS);
    return () => clearTimeout(timer);
  }, [back]);

  // Recovery answers in the same render that hides the wait. Waiting for the
  // effect above left one frame with nothing mounted, so "Connected" faded in
  // as a new surface: the card vanished and came back.
  const recovered = view.mode === "hidden" && !notLive && lastShown.current !== "hidden" ? lastShown.current : "hidden";
  const closing = back !== "hidden" ? back : recovered;

  if (typeof document === "undefined") return null;
  if (view.mode !== "hidden") {
    return createPortal(
      <ConnectionSurface view={view} onRetry={availability.retry} machineSwitcher={machineSwitcher} />,
      document.body,
    );
  }
  if (closing !== "hidden") {
    return createPortal(
      <ConnectionSurface
        view={{ mode: closing, mood: "happy", title: "Connected", detail: null, canRetry: false, canSwitch: false, nextChangeMs: null }}
        onRetry={availability.retry}
      />,
      document.body,
    );
  }
  return null;
}

function ConnectionSurface({
  view,
  onRetry,
  machineSwitcher,
}: {
  view: ConnectionOverlayView;
  onRetry: () => void;
  machineSwitcher?: ReactNode;
}) {
  const pill = view.mode === "pill";
  const slot = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<{ x: number; y: number; scale: number } | null>(null);
  useLayoutEffect(() => {
    const place = () => {
      const rect = slot.current?.getBoundingClientRect();
      if (!rect) return;
      const next = { x: rect.left + rect.width / 2 - 40, y: rect.top + rect.height / 2 - 40, scale: pill ? 0.35 : 1 };
      setPosition((old) => old?.x === next.x && old.y === next.y && old.scale === next.scale ? old : next);
    };
    place();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(place);
    if (slot.current?.parentElement) observer?.observe(slot.current.parentElement);
    window.addEventListener("resize", place);
    window.visualViewport?.addEventListener("resize", place);
    window.visualViewport?.addEventListener("scroll", place);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", place);
      window.visualViewport?.removeEventListener("resize", place);
      window.visualViewport?.removeEventListener("scroll", place);
    };
  }, [pill, view.title, view.canRetry, view.canSwitch, machineSwitcher]);

  return (
    <div
      role={pill ? "status" : "alertdialog"}
      aria-live={pill ? "polite" : undefined}
      aria-modal={pill ? undefined : false}
      aria-label={pill ? undefined : view.title}
      data-connection-overlay={view.mode}
      className={pill
        ? "lfg-connection-in pointer-events-none fixed inset-x-0 z-[96] flex justify-center px-4"
        : `lfg-connection-in fixed inset-0 z-[96] flex items-start justify-center bg-background/30 px-6${view.mood === "happy" ? " pointer-events-none" : ""}`}
      style={pill
        ? { top: "calc(var(--lfg-visual-offset-top, 0px) + env(safe-area-inset-top, 0px) + 48px)" }
        : { paddingTop: "max(env(safe-area-inset-top, 0px), calc(50dvh - 56px))" }}
    >
      <div
        className={pill
          ? "pointer-events-auto flex items-center gap-2 rounded-full border border-border bg-popover py-1 pl-1.5 pr-2 text-popover-foreground shadow-lg"
          : "flex w-full max-w-[17rem] flex-col items-center gap-2 rounded-3xl border border-border bg-background px-5 pb-5 pt-4 text-center shadow-2xl"}
        role={pill ? undefined : "status"}
        aria-live={pill ? undefined : "polite"}
      >
        <div ref={slot} aria-hidden="true" style={{ width: pill ? 28 : 80, height: pill ? 28 : 80, flexShrink: 0 }} />
        <div className={pill && view.progress !== undefined ? "min-w-0 py-1 pr-1" : "contents"}>
          <p className={pill ? "text-sm font-medium" : "text-base font-semibold text-foreground"}>{view.title}</p>
          {view.progress !== undefined ? (
            <div className="mt-2 w-full">
              <div role="progressbar" aria-label="Estimated computer resume progress"
                aria-valuemin={0} aria-valuemax={100} aria-valuenow={view.progress}
                aria-valuetext={`${view.progress}% estimated. ${view.detail}`}
                className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                <div className="h-full rounded-full bg-foreground motion-safe:transition-[width] motion-safe:duration-300"
                  style={{ width: `${view.progress}%` }} />
              </div>
              <p className="mt-1 text-xs text-muted-foreground">{view.detail}</p>
            </div>
          ) : !pill && view.detail ? <p className="text-sm text-muted-foreground">{view.detail}</p> : null}
        </div>
        {view.canRetry || (!pill && view.canSwitch && machineSwitcher) ? (
          <div className={pill ? "contents" : "mt-1 flex w-full flex-col items-stretch gap-2"}>
            {view.canRetry ? (
              <button type="button" onClick={onRetry} className={pill
                ? "rounded-full px-2 py-1 text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
                : "h-10 rounded-full bg-foreground px-5 text-sm font-medium text-background transition-opacity hover:opacity-90"}>
                Retry
              </button>
            ) : null}
            {!pill && view.canSwitch && machineSwitcher ? (
              <div className="rounded-xl border border-border bg-popover text-popover-foreground">{machineSwitcher}</div>
            ) : null}
          </div>
        ) : null}
      </div>
      <div
        aria-hidden="true"
        className="pointer-events-none fixed left-0 top-0 motion-safe:transition-transform motion-safe:duration-300"
        style={{ width: 80, height: 80, visibility: position ? "visible" : "hidden",
          transform: position ? `translate(${position.x}px, ${position.y}px) scale(${position.scale})` : undefined }}
      >
        <Boxy mood={view.mood} size={80} className="text-foreground" />
      </div>
    </div>
  );
}
