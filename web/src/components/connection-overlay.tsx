import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useRuntimeAvailability } from "../lib/runtime-availability";
import {
  connectionOverlayView,
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
  const [, setTick] = useState(0);
  useEffect(() => {
    if (nextChangeMs === null) return;
    const timer = setTimeout(() => setTick((n) => n + 1), Math.max(16, nextChangeMs));
    return () => clearTimeout(timer);
  }, [nextChangeMs]);
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
 * - A longer reconnect shows a pill at the top. The app stays usable.
 * - A long or hard failure dims the app and shows Boxy, Retry, and the
 *   computer switcher. The app stays visible behind it, so the screen is
 *   never blank, and the user can always move to another computer.
 * - When the connection returns, Boxy smiles for a moment and fades out.
 */
export function ConnectionOverlay({ machineSwitcher }: { machineSwitcher?: ReactNode }) {
  const availability = useRuntimeAvailability();
  const resuming = useResuming();
  const notLive = !(availability.ready && availability.status === "live" && !availability.error);

  const [notLiveSince, setNotLiveSince] = useState<number | null>(() => (notLive ? Date.now() : null));
  useEffect(() => {
    setNotLiveSince((since) => (notLive ? since ?? Date.now() : null));
  }, [notLive]);

  const view = connectionOverlayView({
    ...availability,
    notLiveMs: notLiveSince === null ? 0 : Date.now() - notLiveSince,
    resuming,
  });
  useNow(view.nextChangeMs);

  // Remember what was on screen so the recovery can answer in the same place.
  const lastShown = useRef<ConnectionOverlayMode>("hidden");
  const [back, setBack] = useState<ConnectionOverlayMode>("hidden");
  useEffect(() => {
    if (view.mode !== "hidden") {
      lastShown.current = view.mode;
      setBack("hidden");
      return;
    }
    // Not live but still under the pill threshold: say nothing, and do not
    // claim "Connected". Keep what was shown for when it really comes back.
    if (notLive) {
      setBack("hidden");
      return;
    }
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

  if (typeof document === "undefined") return null;
  if (view.mode !== "hidden") {
    return createPortal(
      <ConnectionSurface view={view} onRetry={availability.retry} machineSwitcher={machineSwitcher} />,
      document.body,
    );
  }
  if (back !== "hidden") {
    return createPortal(
      <ConnectionSurface
        view={{ mode: back, mood: "happy", title: "Connected", detail: null, canRetry: false, nextChangeMs: null }}
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
  if (view.mode === "pill") {
    return (
      <div
        role="status"
        aria-live="polite"
        data-connection-overlay="pill"
        className="lfg-connection-in pointer-events-none fixed inset-x-0 z-[96] flex justify-center px-4"
        style={{ top: "calc(var(--lfg-visual-offset-top, 0px) + env(safe-area-inset-top, 0px) + 60px)" }}
      >
        <div className="pointer-events-auto flex items-center gap-2 rounded-full border border-border bg-popover py-1 pl-1.5 pr-2 text-popover-foreground shadow-lg">
          <Boxy mood={view.mood} size={28} className="text-foreground" />
          <span className="text-sm font-medium">{view.title}</span>
          {view.canRetry ? (
            <button
              type="button"
              onClick={onRetry}
              className="rounded-full px-2 py-1 text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
            >
              Retry
            </button>
          ) : null}
        </div>
      </div>
    );
  }
  return (
    <div
      role="alertdialog"
      aria-modal="false"
      aria-label={view.title}
      data-connection-overlay="overlay"
      className="lfg-connection-in fixed inset-0 z-[96] flex items-center justify-center bg-background/30 px-6"
    >
      <div className="flex w-full max-w-[17rem] flex-col items-center gap-2 rounded-3xl border border-border bg-background px-5 pb-5 pt-4 text-center shadow-2xl" role="status" aria-live="polite">
        <Boxy mood={view.mood} size={80} className="text-foreground" />
        <p className="text-base font-semibold text-foreground">{view.title}</p>
        {view.detail ? <p className="text-sm text-muted-foreground">{view.detail}</p> : null}
        {view.canRetry || machineSwitcher ? (
          <div className="mt-1 flex w-full flex-col items-stretch gap-2">
            {view.canRetry ? (
              <button
                type="button"
                onClick={onRetry}
                className="h-10 rounded-full bg-foreground px-5 text-sm font-medium text-background transition-opacity hover:opacity-90"
              >
                Retry
              </button>
            ) : null}
            {machineSwitcher ? (
              <div className="rounded-xl border border-border bg-popover text-popover-foreground">
                {machineSwitcher}
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}
