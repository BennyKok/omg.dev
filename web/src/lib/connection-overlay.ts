import type { ConnectionStatus } from "../useLiveSocket";
import { runtimeStatusText } from "./runtime-availability";
import type { RuntimeLifecycle } from "./runtime-lifecycle";

/**
 * The universal connection surface: one decision for every state in which the
 * app cannot talk to its computer (first connect, reconnect, resume after the
 * app was in the background, offline, and a computer the server stopped).
 *
 * The app stays mounted and visible behind it. Short blips stay silent, a
 * longer one gets a small pill, and a long or hard failure dims the app and
 * offers Retry and the computer switcher.
 */
export type ConnectionOverlayMode = "hidden" | "pill" | "overlay";
export type BoxyMood = "booting" | "searching" | "sleeping" | "error" | "happy";

export type ConnectionOverlayInput = {
  loading: boolean;
  ready: boolean;
  status: ConnectionStatus;
  error: string | null;
  lifecycle?: RuntimeLifecycle | null;
  /** Milliseconds since the runtime stopped being live. */
  notLiveMs: number;
  /** The app came back from the background and has not reconnected yet. */
  resuming: boolean;
};

export type ConnectionOverlayView = {
  mode: ConnectionOverlayMode;
  mood: BoxyMood;
  title: string;
  detail: string | null;
  /**
   * Offer Retry: only a real failure. While the app is still connecting or
   * reconnecting, a retry button reads as "it already failed".
   */
  canRetry: boolean;
  /** Offer the computer switcher: a real failure, or a long wait. */
  canSwitch: boolean;
  /** Milliseconds until the mode can change on time alone, or null. */
  nextChangeMs: number | null;
};

/** A blip shorter than this is not worth any UI. */
export const PILL_AFTER_MS = 2_000;
/** A reconnect longer than this dims the app. */
export const OVERLAY_AFTER_MS = 8_000;
/**
 * A failed bootstrap stays soft this long. The app retries it by itself, and
 * one network error or one 502 mid-resume is usually gone within seconds.
 */
export const FAIL_AFTER_MS = 20_000;
/** The first bootstrap gets the overlay quickly: there is nothing to use yet. */
export const STARTUP_OVERLAY_AFTER_MS = 600;

const HIDDEN: ConnectionOverlayView = {
  mode: "hidden",
  mood: "happy",
  title: "",
  detail: null,
  canRetry: false,
  canSwitch: false,
  nextChangeMs: null,
};

function hardLifecycle(input: ConnectionOverlayInput): boolean {
  if (input.status === "offline") return true;
  return input.lifecycle === "failed" || input.lifecycle === "paused" || input.lifecycle === "unavailable";
}

/** A bootstrap error the app is still retrying by itself. */
function softError(input: ConnectionOverlayInput): boolean {
  return !!input.error && !hardLifecycle(input) && input.notLiveMs < FAIL_AFTER_MS;
}

function hardFailure(input: ConnectionOverlayInput): boolean {
  return hardLifecycle(input) || (!!input.error && !softError(input));
}

function moodFor(input: ConnectionOverlayInput): BoxyMood {
  switch (input.lifecycle) {
    case "starting":
    case "waking":
      return "booting";
    case "paused":
      return "sleeping";
    case "failed":
    case "unavailable":
      return "error";
    default:
      break;
  }
  if (input.error) return "error";
  if (input.status === "offline") return "sleeping";
  if (input.loading) return "booting";
  return "searching";
}

function detailFor(input: ConnectionOverlayInput, mood: BoxyMood): string | null {
  if (input.lifecycle === "paused") return "This computer is paused. Resume it, or switch to another computer.";
  if (input.lifecycle === "starting" || input.lifecycle === "waking") return "This can take a moment.";
  if (mood === "error") return "Try again, or switch to another computer.";
  if (input.status === "offline") return "Check your connection, or switch to another computer.";
  if (input.loading) return null;
  return "Your sessions keep running. We will catch up when you are back.";
}

export function connectionOverlayView(input: ConnectionOverlayInput): ConnectionOverlayView {
  const view = baseView(input);
  // A soft error must be looked at again when it settles into a hard one.
  if (softError(input) && !(view.mode === "hidden" && view.nextChangeMs === null)) {
    const settle = FAIL_AFTER_MS - input.notLiveMs;
    return { ...view, nextChangeMs: Math.min(view.nextChangeMs ?? settle, settle) };
  }
  return view;
}

function baseView(input: ConnectionOverlayInput): ConnectionOverlayView {
  const label = runtimeStatusText(input);
  if (!label) return HIDDEN;

  const soft = softError(input);
  // Still retrying: read as connecting, not as a failure.
  const mood = soft ? (input.ready ? "searching" : "booting") : moodFor(input);
  const title = soft
    ? input.ready ? (input.resuming ? "Resuming…" : "Reconnecting…") : "Connecting…"
    : input.resuming && mood === "searching" ? "Resuming…" : label;
  const detail = soft ? null : detailFor(input, mood);
  const hard = hardFailure(input);
  const canRetry = hard;
  const longWait = input.notLiveMs >= OVERLAY_AFTER_MS;
  // Waking or resuming: the only thing to do is wait (Benny, 2026-10-07).
  const waiting = input.resuming || input.lifecycle === "starting" || input.lifecycle === "waking";
  const canSwitch = hard || (longWait && !waiting);

  if (hard) {
    return { mode: "overlay", mood, title, detail, canRetry, canSwitch, nextChangeMs: null };
  }
  if (input.loading) {
    const wait = STARTUP_OVERLAY_AFTER_MS - input.notLiveMs;
    if (wait > 0) return { ...HIDDEN, nextChangeMs: wait };
    // Recheck at the long-wait mark, when the switcher appears.
    return { mode: "overlay", mood, title, detail, canRetry, canSwitch, nextChangeMs: longWait ? null : OVERLAY_AFTER_MS - input.notLiveMs };
  }
  const pillAt = input.resuming ? 0 : PILL_AFTER_MS;
  if (input.notLiveMs < pillAt) {
    return { ...HIDDEN, nextChangeMs: pillAt - input.notLiveMs };
  }
  if (input.notLiveMs < OVERLAY_AFTER_MS) {
    return {
      mode: "pill",
      mood,
      title,
      detail,
      canRetry,
      canSwitch,
      nextChangeMs: OVERLAY_AFTER_MS - input.notLiveMs,
    };
  }
  return { mode: "overlay", mood, title, detail, canRetry, canSwitch, nextChangeMs: null };
}
