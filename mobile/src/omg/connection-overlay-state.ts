import type { BoxyMood } from "./boxy";

/**
 * The native connection screen's rules. The same rules, timings and words as
 * the hosted web app (vibes apps/web/src/components/computer/
 * computer-connection-screen.ts), fed from the native owners: `readiness` from
 * OmgProvider and the live socket's status from the client.
 *
 * There is one connection display, and it is a full page. The pill and the
 * translucent card it replaced drew in the middle of a screen the person was
 * using, and read as broken (Benny, 2026-10-16).
 *
 * - First connect with nothing saved to show: the page at once, one step at
 *   a time. LaunchGate draws it until the first connect, ConnectionOverlay
 *   after; both read this function, so the two look and read the same.
 * - Saved sessions on screen, or a computer that stops answering after it
 *   was ready: silent for QUIET_MS, then the page.
 * - A socket that drops while the computer still answers leaves a usable
 *   screen, so it stays silent for SOCKET_GRACE_MS, then the page offers Try
 *   again. Covering a working screen after 10 s read as one screen sliding
 *   over another (Benny, 2026-10-17).
 * - After LONG_WAIT_MS the page says the wait is longer than usual. After
 *   GIVE_UP_MS it offers Try again and another computer. No wait is without a
 *   way out.
 * - A real failure says so at once, with Try again.
 */
export type ConnectionOverlayMode = "hidden" | "page";

export type ReadinessKind =
  | "ready"
  | "connecting"
  | "waking"
  | "agent-limit"
  | "unavailable"
  | "unauthorized"
  | "error";
export type SocketStatus = "connecting" | "live" | "reconnecting" | "offline";

export type NativeOverlayInput = {
  /** Signed in with a computer selected: there is something to connect to. */
  selected: boolean;
  /** The selected computer reached `ready` at least once in this run. */
  everReady: boolean;
  /** Saved sessions for the selected computer are on screen. */
  hasSaved: boolean;
  readiness: ReadinessKind | null;
  socket: SocketStatus | null;
  /**
   * The computer list last said the cloud computer is paused. The app wakes
   * it by itself (presence plus probe), so this reads as waking, never as a
   * stop, and a computer that answers is live whatever the list said.
   */
  cloudPaused: boolean;
  /** Milliseconds since the computer stopped being usable. */
  notLiveMs: number;
  /** A screen that owns its own machine UI is on top (Computers, sign-in). */
  suppressed: boolean;
};

export type NativeOverlayView = {
  mode: ConnectionOverlayMode;
  mood: BoxyMood;
  title: string;
  detail: string | null;
  /** Offer "Choose another computer". */
  canSwitch: boolean;
  /** Offer "Try again". */
  canRetry: boolean;
  nextChangeMs: number | null;
};

/** A drop shorter than this, with something usable on screen, shows nothing. */
export const QUIET_MS = 10_000;
/** After this, the page says the wait is longer than usual. */
export const LONG_WAIT_MS = 20_000;
/** After this, the page offers Try again and another computer. */
export const GIVE_UP_MS = 60_000;
/** A socket drop under a computer that still answers stays silent this long. */
export const SOCKET_GRACE_MS = GIVE_UP_MS;
/**
 * A failed check stays soft this long. The provider retries it by itself, and
 * one network error or one 502 mid-resume is usually gone within seconds.
 */
export const FAIL_AFTER_MS = 20_000;

const HIDDEN: NativeOverlayView = {
  mode: "hidden",
  mood: "happy",
  title: "",
  detail: null,
  canSwitch: false,
  canRetry: false,
  nextChangeMs: null,
};

/** A recovered socket can use prior content while bootstrap is refreshed. */
export function isLive(input: Pick<NativeOverlayInput, "readiness" | "socket" | "everReady" | "hasSaved">): boolean {
  // A fresh socket is stronger evidence than an older failed HTTP probe.
  // Keep explicit access revocation blocking, and require usable prior content.
  if (input.readiness !== "unauthorized" && input.socket === "live" && (input.everReady || input.hasSaved)) return true;
  if (input.readiness !== "ready" && input.readiness !== "agent-limit") return false;
  return input.socket !== "reconnecting" && input.socket !== "offline";
}

function nextMark(ms: number, marks: number[]): number | null {
  const next = marks.find((mark) => mark > ms);
  return next === undefined ? null : next - ms;
}

function failure(title: string, detail: string, canRetry: boolean): NativeOverlayView {
  return { mode: "page", mood: "error", title, detail, canRetry, canSwitch: true, nextChangeMs: null };
}

export function nativeOverlayView(input: NativeOverlayInput): NativeOverlayView {
  if (!input.selected || input.suppressed || isLive(input)) return HIDDEN;
  const ms = input.notLiveMs;

  // Revoked access does not come back by waiting.
  if (input.readiness === "unauthorized") {
    return failure("This computer is no longer shared with you", "Choose another computer.", false);
  }
  const failing = input.readiness === "unavailable" || input.readiness === "error";
  const offline = input.socket === "offline";
  if (failing && ms >= FAIL_AFTER_MS) {
    return input.readiness === "unavailable"
      ? failure("Your computer is not available", "Try again, or choose another computer.", true)
      : failure("Could not reach your computer", "Try again, or choose another computer.", true);
  }
  // Only the socket dropped: the computer still answers and the screen is usable.
  const answering = input.readiness === "ready" || input.readiness === "agent-limit";
  if (answering && input.everReady && (offline || input.socket === "reconnecting")) {
    if (ms < SOCKET_GRACE_MS) return { ...HIDDEN, nextChangeMs: SOCKET_GRACE_MS - ms };
    return {
      mode: "page",
      mood: "searching",
      title: "Reconnecting to your computer",
      detail: "This is taking longer than it should. You can try again.",
      canRetry: true,
      canSwitch: true,
      nextChangeMs: null,
    };
  }
  if (offline && input.everReady && ms >= FAIL_AFTER_MS) {
    return failure("Could not reach your computer", "Check your connection, then try again.", true);
  }

  // Something usable is on screen: stay out of the way for a while.
  const usableBehind = input.everReady || input.hasSaved;
  // A soft failure must be looked at again when it settles into a hard one.
  const settleMs = (failing || offline) && ms < FAIL_AFTER_MS ? FAIL_AFTER_MS - ms : null;
  if (usableBehind && ms < QUIET_MS) {
    const quiet = QUIET_MS - ms;
    return { ...HIDDEN, nextChangeMs: settleMs === null ? quiet : Math.min(quiet, settleMs) };
  }

  const waking = input.readiness === "waking" || input.cloudPaused;
  const title = waking
    ? "Waking your computer"
    : input.everReady
      ? "Reconnecting to your computer"
      : "Connecting to your computer";
  const gaveUp = ms >= GIVE_UP_MS;
  const detail = gaveUp
    ? "This is taking longer than it should. You can try again."
    : ms >= LONG_WAIT_MS
      ? "Still working. This can take up to a minute."
      : null;
  const next = nextMark(ms, [LONG_WAIT_MS, GIVE_UP_MS]);
  return {
    mode: "page",
    mood: waking ? "booting" : input.everReady ? "searching" : "booting",
    title,
    detail,
    canRetry: gaveUp,
    canSwitch: gaveUp,
    nextChangeMs: settleMs === null ? next : next === null ? settleMs : Math.min(next, settleMs),
  };
}
