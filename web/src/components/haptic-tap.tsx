import { useSyncExternalStore, type MouseEvent, type PointerEvent, type TouchEvent } from "react";
import { noteFingerSwitchTap } from "@/lib/haptics";
import { useUiFeedbackPrefs } from "@/lib/ui-feedback-prefs";

/**
 * Makes the button it sits in buzz on iPhone.
 *
 * iOS plays a haptic only when a finger flips a real native switch
 * (`<input type="checkbox" switch>`). Flipping one from code, which is what
 * `haptic()` does, stopped buzzing in iOS 26.5. So this lays an almost
 * transparent switch over the whole button and lets the finger flip it.
 *
 * The tap still reaches the button: the switch's click bubbles to the
 * button's own `onClick`. Verified on an iPhone (iOS 27.2, 2026-10-30) with
 * the omg.dev haptics lab, test B.
 *
 * Rules for where it goes:
 * - The parent must be positioned (`relative`, `absolute` or `fixed`).
 * - Only on a `<button>` whose action is its own `onClick`, or a submit
 *   button. The switch takes the click's default action, so a submit button
 *   is submitted from here, and a link would not navigate at all: never put it
 *   in an `<a>`.
 * - Pass `disabled` along with the button's: a disabled button must not buzz.
 * - A swipe that starts on an iOS switch still flips it when the finger
 *   lifts, which would tap the button at the end of a scroll. So a touch that
 *   moved more than a tap, or that the browser took over for scrolling, is
 *   cancelled here: no flip and no click on the button. That makes it safe in
 *   short lists such as the nav drawer. Long, busy lists are still better
 *   without it.
 *
 * Renders nothing on phones without switch support, on Android (which buzzes
 * through `navigator.vibrate`), on desktop and when haptics are off in
 * Settings.
 */
export function HapticTap({ disabled = false }: { disabled?: boolean }) {
  const { haptics } = useUiFeedbackPrefs();
  const available = useSyncExternalStore(noopSubscribe, iosTapHapticsAvailable, serverSnapshot);
  if (disabled || !haptics || !available) return null;
  return (
    <input
      type="checkbox"
      {...{ switch: "" }}
      aria-hidden="true"
      tabIndex={-1}
      data-haptic-tap=""
      onTouchStart={onSwitchTouchStart}
      onTouchMove={onSwitchTouchMove}
      onPointerCancel={onSwitchPointerCancel}
      onClick={onSwitchClick}
      // Keep this styling as verified on the device. Do not add
      // `appearance: none`, `display: none`, `visibility: hidden` or
      // `pointer-events: none`: any of them may stop the haptic.
      style={{
        position: "absolute",
        inset: 0,
        width: "100%",
        height: "100%",
        margin: 0,
        opacity: 0.011,
        cursor: "pointer",
        zIndex: 1,
        touchAction: "manipulation",
      }}
    />
  );
}

/** Farther than this between touch-down and lift is a swipe, not a tap. */
const TAP_SLOP_PX = 10;
const touchStarts = new WeakMap<HTMLInputElement, { x: number; y: number; moved: boolean }>();

function onSwitchTouchStart(event: TouchEvent<HTMLInputElement>) {
  const touch = event.touches[0];
  if (touch) touchStarts.set(event.currentTarget, { x: touch.clientX, y: touch.clientY, moved: false });
}

function onSwitchTouchMove(event: TouchEvent<HTMLInputElement>) {
  const start = touchStarts.get(event.currentTarget);
  const touch = event.touches[0];
  if (start && touch && Math.hypot(touch.clientX - start.x, touch.clientY - start.y) > TAP_SLOP_PX) {
    start.moved = true;
  }
}

function onSwitchPointerCancel(event: PointerEvent<HTMLInputElement>) {
  // The browser took the touch for a scroll.
  const start = touchStarts.get(event.currentTarget);
  if (start) start.moved = true;
}

function onSwitchClick(event: MouseEvent<HTMLInputElement>) {
  const start = touchStarts.get(event.currentTarget);
  touchStarts.delete(event.currentTarget);
  if (start?.moved) {
    // The end of a swipe or a scroll: leave the switch and the button alone.
    event.preventDefault();
    event.stopPropagation();
    return;
  }
  noteFingerSwitchTap();
  // The click's default action is the switch flip, so a submit button around
  // it no longer submits by itself. Submit once the click has finished
  // bubbling, unless a handler on the way cancelled it.
  const button = event.currentTarget.closest("button");
  if (!button || button.type !== "submit" || button.disabled || !button.form) return;
  const native = event.nativeEvent;
  const form = button.form;
  setTimeout(() => {
    if (!native.defaultPrevented) form.requestSubmit(button);
  }, 0);
}

/** iPhone or iPad with native switches and no Vibration API. */
export function iosTapHapticsAvailable(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof HTMLInputElement !== "undefined" &&
    "switch" in HTMLInputElement.prototype &&
    typeof navigator.vibrate !== "function" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(pointer: coarse)").matches
  );
}

const noopSubscribe = () => () => {};
const serverSnapshot = () => false;
