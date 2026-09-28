import { useRef, useState, type ReactNode, type TouchEvent, type WheelEvent } from "react";
import { MessageSquare } from "lucide-react";
import { THREAD_PULL_ARM, threadPullStage } from "../../../packages/protocol/src/threads";
import { cn } from "@/lib/utils";

const OMG_ORANGE = "#FF5530";
/** A wheel pull ends when the wheel has been still this long. */
const WHEEL_SETTLE_MS = 220;

/** The nearest box that scrolls vertically: `main` on the phone layout, the rail on desktop. */
function scrollParent(from: HTMLElement | null): HTMLElement | null {
  for (let el = from?.parentElement ?? null; el; el = el.parentElement) {
    const overflow = getComputedStyle(el).overflowY;
    if (overflow === "auto" || overflow === "scroll") return el;
  }
  return null;
}

/**
 * PULL THE LIST DOWN TO START A THREAD, as on iOS: the same distances
 * (threadPullStage in the shared module) and the same indicator, a chat mark
 * in a ring that fills orange as you pull and turns solid with "Release to
 * start a thread".
 *
 * A finger pulls on a touch screen. On a desktop the same gesture is a scroll
 * up past the top of the list (a trackpad's two-finger pull, or the wheel);
 * the pull ends when the wheel settles. It only starts at the top, so it
 * never fights an ordinary scroll.
 */
export function PullToThread({
  onStart,
  children,
  scrollTop,
  fill = true,
}: {
  onStart: () => void;
  children: ReactNode;
  /** How far the list's scroller is from its top. Injected for tests. */
  scrollTop?: () => number;
  /** Stretch to at least most of the screen, so a short list can still be pulled from its empty space. */
  fill?: boolean;
}) {
  const root = useRef<HTMLDivElement>(null);
  const start = useRef<number | null>(null);
  const armed = useRef(false);
  const wheelTimer = useRef<number | null>(null);
  const wheelPull = useRef(0);
  const [pull, setPull] = useState(0);
  const distanceFromTop = () =>
    scrollTop?.() ?? scrollParent(root.current)?.scrollTop ?? document.scrollingElement?.scrollTop ?? 0;

  const move = (next: number) => {
    const nowArmed = threadPullStage(next) === 2;
    if (nowArmed && !armed.current) navigator.vibrate?.(10);
    armed.current = nowArmed;
    setPull(next);
  };
  const release = () => {
    const open = armed.current;
    start.current = null;
    armed.current = false;
    wheelPull.current = 0;
    setPull(0);
    if (open) onStart();
  };

  const onTouchStart = (event: TouchEvent) => {
    start.current = distanceFromTop() <= 0 ? event.touches[0].clientY : null;
    armed.current = false;
  };
  const onTouchMove = (event: TouchEvent) => {
    if (start.current === null) return;
    move(Math.max(0, event.touches[0].clientY - start.current));
  };
  const onWheel = (event: WheelEvent) => {
    // Scrolling down, or not at the top yet: an ordinary scroll.
    if (event.deltaY >= 0 && !wheelPull.current) return;
    if (!wheelPull.current && distanceFromTop() > 0) return;
    // Capped just past the arm point: a long scroll must not shove the list away.
    wheelPull.current = Math.min(THREAD_PULL_ARM * 1.25, Math.max(0, wheelPull.current - event.deltaY * 0.5));
    move(wheelPull.current);
    if (wheelTimer.current) window.clearTimeout(wheelTimer.current);
    wheelTimer.current = window.setTimeout(release, WHEEL_SETTLE_MS);
  };

  const progress = Math.min(1, pull / THREAD_PULL_ARM);
  const isArmed = threadPullStage(pull) === 2;
  return (
    <div
      ref={root}
      data-testid="pull-to-thread"
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={release}
      onTouchCancel={release}
      onWheel={onWheel}
      className={cn("relative", fill && "min-h-[60dvh]")}
    >
      {pull ? (
        <div
          aria-live="polite"
          className="pointer-events-none absolute inset-x-0 top-0 z-10 flex flex-col items-center gap-2"
          style={{ opacity: Math.min(1, Math.max(0, (pull - 20) / 50)), transform: `translateY(${Math.round(pull * 0.45) - 64}px)` }}
        >
          <div
            className="relative flex size-11 items-center justify-center rounded-full"
            style={{
              // The ring fills clockwise with the pull; armed, it is a solid disc.
              background: isArmed ? OMG_ORANGE : `conic-gradient(${OMG_ORANGE} ${progress * 360}deg, var(--border) 0deg)`,
            }}
          >
            {isArmed ? null : <span className="absolute inset-[2px] rounded-full bg-background" />}
            <MessageSquare className={cn("relative size-[18px]", isArmed ? "text-white" : "text-muted-foreground")} />
          </div>
          <span className={cn("text-[13px]", isArmed ? "font-semibold text-foreground" : "text-muted-foreground")}>
            {isArmed ? "Release to start a thread" : "Pull to start a thread"}
          </span>
        </div>
      ) : null}
      <div
        style={pull ? { transform: `translateY(${Math.round(pull * 0.45)}px)` } : undefined}
        className={cn(!pull && "transition-transform duration-200")}
      >
        {children}
      </div>
    </div>
  );
}
