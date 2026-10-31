// How far an embedding host's toasts must keep from the bottom of the screen to
// clear the phone chat box: `--lfg-host-toast-clear` on <html>
// (docs/embedding.md). This module is the one owner of that property. Every
// chat box registers its element, and only the box a person can actually see
// sets the value.
//
// Several chat boxes are mounted at once. The Create chat box stays mounted
// under an open chat, and it is display:none on Apps. When only the Create box
// published the value, omg.dev's toasts inside a chat were lifted above that
// covered box. On omg.dev's Create page that box sits mid-screen, over the
// tutorial cards, so the toast floated in the middle of the conversation.

const PROPERTY = "--lfg-host-toast-clear";

const boxes: HTMLElement[] = [];
let observer: ResizeObserver | null = null;
let frame = 0;
// Its own frame, so a transitionend in between cannot cancel the wait.
let settleFrame = 0;

/** True when a person can see `el`: laid out, in the viewport, not covered. */
function visibleBox(el: HTMLElement): DOMRect | null {
  const rect = el.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return null;
  if (rect.bottom <= 0 || rect.top >= window.innerHeight) return null;
  if (rect.right <= 0 || rect.left >= window.innerWidth) return null;
  // A box under an open page still has a layout box. Ask what is drawn on top
  // of its text field: the field always takes taps, while the box's padding may
  // be pointer-events:none and would read as covered.
  const field = el.querySelector("textarea")?.getBoundingClientRect();
  const probe = field && field.width > 0 && field.height > 0 ? field : rect;
  const x = Math.min(Math.max(probe.left + probe.width / 2, 0), window.innerWidth - 1);
  const y = Math.min(Math.max(probe.top + probe.height / 2, 0), window.innerHeight - 1);
  const hit = document.elementFromPoint?.(x, y);
  if (hit && !el.contains(hit)) return null;
  return rect;
}

/** Recompute the property from the registered boxes. */
export function measureHostToastClear(): void {
  const root = document.documentElement;
  // The newest box wins when more than one is visible.
  for (let i = boxes.length - 1; i >= 0; i -= 1) {
    const rect = visibleBox(boxes[i]!);
    if (!rect) continue;
    root.style.setProperty(PROPERTY, `${Math.max(0, Math.ceil(window.innerHeight - rect.top))}px`);
    return;
  }
  root.style.removeProperty(PROPERTY);
}

// Now, and again once layout has settled. Opening a chat, a sheet's slide, a
// keyboard or a swipe moves a box without resizing it.
function schedule(): void {
  measureHostToastClear();
  cancelAnimationFrame(frame);
  frame = requestAnimationFrame(measureHostToastClear);
}

// A chat box mounts or unmounts as its page starts or ends a slide. The slide
// is a Web Animation, which fires no transitionend, and a closing page's
// backdrop leaves the DOM in the same commit as the box. So measure on the
// next frame, then again when every slide running by then has finished.
function settle(): void {
  measureHostToastClear();
  cancelAnimationFrame(settleFrame);
  settleFrame = requestAnimationFrame(() => {
    measureHostToastClear();
    const running = (document.getAnimations?.() ?? []).filter((animation) => {
      if (animation.playState !== "running") return false;
      // A spinner never finishes; only wait for animations with an end.
      return Number.isFinite(Number(animation.effect?.getComputedTiming().endTime));
    });
    if (running.length) void Promise.allSettled(running.map((animation) => animation.finished)).then(schedule);
  });
}

function listen(on: boolean): void {
  const targets: Array<[EventTarget | null | undefined, string, boolean]> = [
    [window, "resize", false],
    [window.visualViewport, "resize", false],
    [window.visualViewport, "scroll", false],
    // Capture: page and sheet animations end on elements deep in the tree.
    [document, "transitionend", true],
    [document, "animationend", true],
  ];
  for (const [target, type, capture] of targets) {
    if (on) target?.addEventListener(type, schedule, capture);
    else target?.removeEventListener(type, schedule, capture);
  }
}

/**
 * Register a chat box. Returns the cleanup, so it works as a React 19 callback
 * ref: `ref={trackHostToastClear}`.
 */
export function trackHostToastClear(el: HTMLElement | null): (() => void) | undefined {
  if (!el) return undefined;
  boxes.push(el);
  if (boxes.length === 1) {
    observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(schedule);
    listen(true);
  }
  observer?.observe(el);
  settle();
  return () => {
    const index = boxes.lastIndexOf(el);
    if (index >= 0) boxes.splice(index, 1);
    observer?.unobserve(el);
    if (boxes.length === 0) {
      observer?.disconnect();
      observer = null;
      listen(false);
      cancelAnimationFrame(frame);
      cancelAnimationFrame(settleFrame);
      measureHostToastClear();
      return;
    }
    settle();
  };
}
