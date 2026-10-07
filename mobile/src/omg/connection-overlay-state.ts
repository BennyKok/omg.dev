import type { BoxyMood } from "./boxy";

/**
 * The native connection overlay's rules. Same timing and moods as the web
 * overlay (web/src/lib/connection-overlay.ts), fed from the native owners:
 * `readiness` from OmgProvider and the live socket's status from the client.
 *
 * One rule for every state, the first connect included, as on the web. A
 * cold start with saved sessions lifts the launch screen at once, so without
 * this the app connected with no sign at all. The first connect gets the card
 * quickly ("Connecting…"), because there is nothing live to use yet; a later
 * drop grows from silent to pill to card.
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
  readiness: ReadinessKind | null;
  socket: SocketStatus | null;
  /** The cloud computer is paused by the server. */
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
  /** Offer "Choose another computer". */
  canSwitch: boolean;
  nextChangeMs: number | null;
};

export const PILL_AFTER_MS = 2_000;
export const OVERLAY_AFTER_MS = 8_000;
/** The first connect gets the card quickly: there is nothing to use yet. */
export const STARTUP_OVERLAY_AFTER_MS = 600;

const HIDDEN: NativeOverlayView = {
  mode: "hidden",
  mood: "happy",
  title: "",
  detail: null,
  canSwitch: false,
  nextChangeMs: null,
};

/** Usable means: bootstrap answered and the live socket is not down. */
export function isLive(input: Pick<NativeOverlayInput, "readiness" | "socket" | "cloudPaused">): boolean {
  if (input.cloudPaused) return false;
  if (input.readiness !== "ready" && input.readiness !== "agent-limit") return false;
  return input.socket !== "reconnecting" && input.socket !== "offline";
}

export function nativeOverlayView(input: NativeOverlayInput): NativeOverlayView {
  if (!input.selected || input.suppressed || isLive(input)) return HIDDEN;
  const startup = !input.everReady;

  let mood: BoxyMood = "searching";
  let title = input.resuming ? "Resuming…" : "Reconnecting…";
  let detail: string | null = "Your sessions keep running. We will catch up when you are back.";
  let hard = false;

  if (input.cloudPaused) {
    mood = "sleeping";
    title = "Computer paused";
    detail = "This computer is paused. Resume it, or choose another computer.";
    hard = true;
  } else if (input.readiness === "unavailable") {
    mood = "error";
    title = "Your computer isn't responding";
    detail = "Try again, or choose another computer.";
    hard = true;
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
  } else if (input.readiness === "waking") {
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
  }

  const base = { mood, title, detail, canSwitch: true };
  if (hard) return { mode: "overlay", ...base, nextChangeMs: null };

  if (startup) {
    const wait = STARTUP_OVERLAY_AFTER_MS - input.notLiveMs;
    if (wait > 0) return { ...HIDDEN, nextChangeMs: wait };
    return { mode: "overlay", ...base, nextChangeMs: null };
  }

  const pillAt = input.resuming ? 0 : PILL_AFTER_MS;
  if (input.notLiveMs < pillAt) return { ...HIDDEN, nextChangeMs: pillAt - input.notLiveMs };
  if (input.notLiveMs < OVERLAY_AFTER_MS) {
    return { mode: "pill", ...base, nextChangeMs: OVERLAY_AFTER_MS - input.notLiveMs };
  }
  return { mode: "overlay", ...base, nextChangeMs: null };
}
