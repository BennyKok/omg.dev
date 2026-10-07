import type { BoxyMood } from "./boxy";

/**
 * The native connection overlay's rules. Same timing and moods as the web
 * overlay (web/src/lib/connection-overlay.ts), fed from the native owners:
 * `readiness` from OmgProvider and the live socket's status from the client.
 *
 * The card blocks the app, so it is only for a screen with nothing to use:
 * a real failure, or a first connect with no saved sessions to show. Every
 * other wait (reconnect, resume, waking) is a pill, however long it takes,
 * because the saved sessions behind it stay readable and the composer still
 * works (Benny, 2026-10-07). A cold start with saved sessions lifts the
 * launch screen at once, so it gets the pill quickly ("Connecting…").
 */
export type ConnectionOverlayMode = "hidden" | "pill" | "overlay";

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
  /**
   * Saved sessions for the selected computer are on screen. A first connect
   * then has something to use, so it is a pill, not the card.
   */
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
  /** The app came back from the background and is not live yet. */
  resuming: boolean;
  /** A screen that owns its own machine UI is on top (Computers, sign-in). */
  suppressed: boolean;
};

export type NativeOverlayView = {
  mode: ConnectionOverlayMode;
  mood: BoxyMood;
  title: string;
  detail: string | null;
  /** Offer "Choose another computer": a real failure, or a long wait. */
  canSwitch: boolean;
  /**
   * Offer "Try again": only a real failure. While the app is still
   * connecting or waking, a retry button reads as "it already failed".
   */
  canRetry: boolean;
  nextChangeMs: number | null;
};

export const PILL_AFTER_MS = 2_000;
/** A wait longer than this offers another computer (never while waking). */
export const LONG_WAIT_MS = 8_000;
/**
 * A failed check stays soft this long. The provider retries it by itself, and
 * one network error or one 502 mid-resume is usually gone within seconds.
 */
export const FAIL_AFTER_MS = 20_000;
/** The first connect shows quickly: there is nothing live to use yet. */
export const STARTUP_SHOW_AFTER_MS = 600;

const HIDDEN: NativeOverlayView = {
  mode: "hidden",
  mood: "happy",
  title: "",
  detail: null,
  canSwitch: false,
  canRetry: false,
  nextChangeMs: null,
};

/** Usable means: bootstrap answered and the live socket is not down. */
export function isLive(input: Pick<NativeOverlayInput, "readiness" | "socket">): boolean {
  if (input.readiness !== "ready" && input.readiness !== "agent-limit") return false;
  return input.socket !== "reconnecting" && input.socket !== "offline";
}

export function nativeOverlayView(input: NativeOverlayInput): NativeOverlayView {
  const view = baseView(input);
  // A soft failure must be looked at again when it settles into a hard one.
  const failing = input.readiness === "unavailable" || input.readiness === "error";
  if (view.mode === "hidden" && view.nextChangeMs === null) return view;
  if (failing && input.notLiveMs < FAIL_AFTER_MS) {
    const settle = FAIL_AFTER_MS - input.notLiveMs;
    return { ...view, nextChangeMs: Math.min(view.nextChangeMs ?? settle, settle) };
  }
  return view;
}

function baseView(input: NativeOverlayInput): NativeOverlayView {
  if (!input.selected || input.suppressed || isLive(input)) return HIDDEN;
  const startup = !input.everReady;
  // Only an empty first connect blocks: nothing behind the card to use.
  const blocking = startup && !input.hasSaved;

  let mood: BoxyMood = "searching";
  let title = input.resuming ? "Resuming…" : "Reconnecting…";
  let detail: string | null = "Your sessions keep running. We will catch up when you are back.";
  let hard = false;
  let canRetry = false;
  // Waking or resuming: the only thing to do is wait (Benny, 2026-10-07).
  let waiting = input.resuming;
  const failing = input.readiness === "unavailable" || input.readiness === "error";
  const settledFailure = failing && input.notLiveMs >= FAIL_AFTER_MS;

  if (failing && !settledFailure) {
    // Still retrying: read as a reconnect, not as a failure.
    mood = startup ? "booting" : "searching";
    title = startup ? "Connecting…" : title;
    detail = startup ? null : detail;
  } else if (input.readiness === "unavailable") {
    mood = "error";
    title = "Your computer isn't responding";
    detail = "Try again, or choose another computer.";
    hard = true;
    canRetry = true;
  } else if (input.readiness === "unauthorized") {
    mood = "error";
    title = "No longer available";
    detail = "This computer is no longer shared with you. Choose another computer.";
    hard = true;
  } else if (input.readiness === "error") {
    mood = "error";
    title = "Couldn't reach your computer";
    detail = "Try again, or choose another computer.";
    hard = true;
    canRetry = true;
  } else if (input.readiness === "waking" || input.cloudPaused) {
    waiting = true;
    mood = "booting";
    title = "Waking your computer…";
    detail = "This can take a moment.";
  } else if (startup) {
    mood = "booting";
    title = "Connecting…";
    detail = null;
  } else if (input.socket === "offline") {
    mood = "sleeping";
    title = "Connection unavailable";
    detail = "Check your connection, or choose another computer.";
    hard = true;
    canRetry = true;
  }

  const longWait = input.notLiveMs >= LONG_WAIT_MS;
  const base = { mood, title, detail, canSwitch: hard || (longWait && !waiting), canRetry };
  if (hard) return { mode: "overlay", ...base, nextChangeMs: null };

  const showAt = input.resuming ? 0 : startup ? STARTUP_SHOW_AFTER_MS : PILL_AFTER_MS;
  if (input.notLiveMs < showAt) return { ...HIDDEN, nextChangeMs: showAt - input.notLiveMs };
  // Recheck at the long-wait mark, when "Choose another computer" appears.
  const nextChangeMs = longWait ? null : LONG_WAIT_MS - input.notLiveMs;
  return { mode: blocking ? "overlay" : "pill", ...base, nextChangeMs };
}
