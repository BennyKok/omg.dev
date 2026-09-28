import { useRef, useState, type ReactNode, type TouchEvent } from "react";
import { MessageSquarePlus } from "lucide-react";
import { threadPullStage } from "../../../packages/protocol/src/threads";
import { cn } from "@/lib/utils";

/**
 * PULL THE LIST DOWN TO START A THREAD, on a touch screen. The same gesture
 * and the same distances as iOS Home (threadPullStage in the shared module):
 * a short pull does nothing new, a long pull arms a thread with a haptic
 * tick where the browser has one, and releasing opens it.
 *
 * It only starts when the page is scrolled to the top, so it never fights an
 * ordinary scroll. The list follows the finger at a damped rate, as iOS does.
 */
export function PullToThread({
  onStart,
  children,
  scrollTop,
}: {
  onStart: () => void;
  children: ReactNode;
  /** How far the list's scroller is from its top. Injected for tests. */
  scrollTop?: () => number;
}) {
  const root = useRef<HTMLDivElement>(null);
  const start = useRef<number | null>(null);
  // The narrow app scrolls inside <main>, not the page.
  const distanceFromTop = () =>
    scrollTop?.() ?? root.current?.closest("main")?.scrollTop ?? document.scrollingElement?.scrollTop ?? 0;
  const [pull, setPull] = useState(0);
  const stage = threadPullStage(pull);
  const armed = useRef(false);

  const onTouchStart = (event: TouchEvent) => {
    start.current = distanceFromTop() <= 0 ? event.touches[0].clientY : null;
    armed.current = false;
  };
  const onTouchMove = (event: TouchEvent) => {
    if (start.current === null) return;
    const next = Math.max(0, event.touches[0].clientY - start.current);
    const nowArmed = threadPullStage(next) === 2;
    if (nowArmed && !armed.current) navigator.vibrate?.(10);
    armed.current = nowArmed;
    setPull(next);
  };
  const onTouchEnd = () => {
    const open = armed.current;
    start.current = null;
    armed.current = false;
    setPull(0);
    if (open) onStart();
  };

  return (
    <div
      ref={root}
      data-testid="pull-to-thread"
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
      onTouchCancel={onTouchEnd}
      // Tall enough that a short list can still be pulled from the empty space under it.
      className="relative min-h-[60dvh]"
    >
      {stage ? (
        <div
          aria-live="polite"
          className="pointer-events-none absolute inset-x-0 top-0 flex flex-col items-center gap-1 text-[13px]"
        >
          <MessageSquarePlus className={cn("size-5", stage === 2 ? "text-[#FF5530]" : "text-muted-foreground")} />
          <span className={stage === 2 ? "font-semibold text-foreground" : "text-muted-foreground"}>
            {stage === 2 ? "Release to start a thread" : "Pull more to start a thread"}
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
