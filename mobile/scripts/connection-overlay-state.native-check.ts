import { expect, test } from "bun:test";
import {
  FAIL_AFTER_MS,
  GIVE_UP_MS,
  LONG_WAIT_MS,
  QUIET_MS,
  isLive,
  nativeOverlayView,
  type NativeOverlayInput,
} from "../src/omg/connection-overlay-state";

// The rules a person sees, and the same rules as the hosted web app
// (vibes computer-connection-screen.ts): one full page, never a pill or a
// card over a screen in use.

const live: NativeOverlayInput = {
  selected: true,
  everReady: true,
  hasSaved: false,
  readiness: "ready",
  socket: "live",
  cloudPaused: false,
  notLiveMs: 0,
  suppressed: false,
};
const view = (extra: Partial<NativeOverlayInput>) => nativeOverlayView({ ...live, ...extra });
const first = (notLiveMs: number, extra: Partial<NativeOverlayInput> = {}) =>
  view({ everReady: false, readiness: "connecting", socket: "connecting", notLiveMs, ...extra });

test("a live computer shows nothing", () => {
  expect(view({}).mode).toBe("hidden");
  expect(view({ readiness: "agent-limit" }).mode).toBe("hidden");
});

test("a first connect with nothing saved shows the full page at once, one step at a time", () => {
  expect(first(0)).toMatchObject({ mode: "page", title: "Connecting to your computer", canRetry: false, canSwitch: false });
  expect(first(0, { readiness: "waking" })).toMatchObject({ mode: "page", title: "Waking your computer" });
  expect(first(0, { cloudPaused: true })).toMatchObject({ mode: "page", title: "Waking your computer" });
});

test("a screen with something usable stays quiet, then the full page takes over", () => {
  // Saved sessions on a cold start.
  expect(first(2_000, { hasSaved: true })).toEqual(expect.objectContaining({ mode: "hidden", nextChangeMs: QUIET_MS - 2_000 }));
  expect(first(QUIET_MS, { hasSaved: true })).toMatchObject({ mode: "page", title: "Connecting to your computer" });
  // A drop after the computer was ready.
  expect(view({ socket: "reconnecting", notLiveMs: 3_000 }).mode).toBe("hidden");
  expect(view({ socket: "reconnecting", notLiveMs: QUIET_MS })).toMatchObject({ mode: "page", title: "Reconnecting to your computer", canRetry: false });
});

test("every wait offers Try again and another computer after the limit", () => {
  expect(first(LONG_WAIT_MS)).toMatchObject({ detail: "Still working. This can take up to a minute.", canRetry: false, nextChangeMs: GIVE_UP_MS - LONG_WAIT_MS });
  expect(first(GIVE_UP_MS)).toMatchObject({ mode: "page", canRetry: true, canSwitch: true, nextChangeMs: null });
  expect(view({ socket: "reconnecting", notLiveMs: GIVE_UP_MS })).toMatchObject({ mode: "page", canRetry: true, canSwitch: true });
});

test("a failed check stays a wait while the provider retries it, then names the failure", () => {
  const unavailable = { readiness: "unavailable" as const, socket: "offline" as const };
  expect(view({ ...unavailable, notLiveMs: 1_000 }).mode).toBe("hidden");
  expect(first(1_000, unavailable)).toMatchObject({ mode: "page", title: "Connecting to your computer", canRetry: false });
  // The soft window is looked at again when it settles.
  expect(first(1_000, unavailable).nextChangeMs).toBe(FAIL_AFTER_MS - 1_000);
  expect(view({ ...unavailable, notLiveMs: FAIL_AFTER_MS })).toMatchObject({
    mode: "page", mood: "error", title: "Your computer is not available", canRetry: true, canSwitch: true,
  });
  expect(view({ readiness: "error", socket: "offline", notLiveMs: FAIL_AFTER_MS })).toMatchObject({ title: "Could not reach your computer", canRetry: true });
  expect(view({ socket: "offline", notLiveMs: FAIL_AFTER_MS })).toMatchObject({ title: "Could not reach your computer", canRetry: true });
});

test("revoked access says so at once and offers only another computer", () => {
  expect(view({ readiness: "unauthorized", socket: "live", notLiveMs: 0 })).toMatchObject({
    mode: "page", title: "This computer is no longer shared with you", canRetry: false, canSwitch: true,
  });
});

test("a screen that owns machine UI, or no selected computer, shows nothing", () => {
  expect(first(GIVE_UP_MS, { suppressed: true }).mode).toBe("hidden");
  expect(first(GIVE_UP_MS, { selected: false }).mode).toBe("hidden");
});

test("a fresh socket beats an older failed probe when there is content to show", () => {
  expect(isLive({ readiness: "unavailable", socket: "live", everReady: true, hasSaved: false })).toBe(true);
  expect(isLive({ readiness: "unavailable", socket: "live", everReady: false, hasSaved: false })).toBe(false);
  expect(isLive({ readiness: "unauthorized", socket: "live", everReady: true, hasSaved: true })).toBe(false);
});
