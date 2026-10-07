import { expect, test } from "bun:test";
import {
  OVERLAY_AFTER_MS,
  FAIL_AFTER_MS,
  PILL_AFTER_MS,
  STARTUP_OVERLAY_AFTER_MS,
  nativeOverlayView,
  type NativeOverlayInput,
} from "../src/omg/connection-overlay-state";

const live: NativeOverlayInput = {
  selected: true,
  everReady: true,
  readiness: "ready",
  socket: "live",
  cloudPaused: false,
  notLiveMs: 0,
  resuming: false,
  suppressed: false,
};
const drop = (notLiveMs: number, extra: Partial<NativeOverlayInput> = {}) =>
  nativeOverlayView({ ...live, socket: "reconnecting", notLiveMs, ...extra });

test("a live computer shows nothing", () => {
  expect(nativeOverlayView(live).mode).toBe("hidden");
  expect(nativeOverlayView({ ...live, readiness: "agent-limit" }).mode).toBe("hidden");
});

test("the first connect shows Connecting after a short wait, as on the web", () => {
  const first = (notLiveMs: number, extra: Partial<NativeOverlayInput> = {}) =>
    nativeOverlayView({ ...live, everReady: false, readiness: "connecting", socket: "connecting", notLiveMs, ...extra });
  expect(first(100)).toMatchObject({ mode: "hidden", nextChangeMs: STARTUP_OVERLAY_AFTER_MS - 100 });
  // Still connecting: no buttons, nothing that reads as a failure.
  expect(first(STARTUP_OVERLAY_AFTER_MS)).toMatchObject({
    mode: "overlay", mood: "booting", title: "Connecting…", canRetry: false, canSwitch: false,
    nextChangeMs: OVERLAY_AFTER_MS - STARTUP_OVERLAY_AFTER_MS,
  });
  // A long wait offers another computer, still not a retry.
  expect(first(OVERLAY_AFTER_MS)).toMatchObject({ mode: "overlay", canRetry: false, canSwitch: true, nextChangeMs: null });
  expect(first(0, { readiness: null, socket: null }).nextChangeMs).toBe(STARTUP_OVERLAY_AFTER_MS);
  expect(first(STARTUP_OVERLAY_AFTER_MS, { readiness: "waking" })).toMatchObject({
    mode: "overlay",
    title: "Waking your computer…",
  });
  expect(first(FAIL_AFTER_MS, { readiness: "unavailable" })).toMatchObject({ mode: "overlay", mood: "error" });
});

test("nothing to connect to shows nothing", () => {
  expect(drop(OVERLAY_AFTER_MS, { selected: false, everReady: false }).mode).toBe("hidden");
});

test("a reconnect grows from silent to pill to card", () => {
  expect(drop(500)).toMatchObject({ mode: "hidden", nextChangeMs: PILL_AFTER_MS - 500 });
  expect(drop(PILL_AFTER_MS)).toMatchObject({ mode: "pill", mood: "searching", title: "Reconnecting…", canRetry: false });
  expect(drop(OVERLAY_AFTER_MS)).toMatchObject({ mode: "overlay", canSwitch: true, canRetry: false, nextChangeMs: null });
});

test("coming back from the background says Resuming at once", () => {
  expect(drop(0, { resuming: true })).toMatchObject({ mode: "pill", title: "Resuming…" });
});

test("hard failures show the card at once with the right mood", () => {
  expect(drop(0, { socket: "offline" })).toMatchObject({ mode: "overlay", mood: "sleeping", canRetry: true });
  expect(drop(FAIL_AFTER_MS, { socket: "live", readiness: "unavailable" })).toMatchObject({ mode: "overlay", mood: "error", canRetry: true });
  expect(drop(FAIL_AFTER_MS, { socket: "live", readiness: "error" })).toMatchObject({ mode: "overlay", canRetry: true });
  // Retrying cannot bring back a withdrawn share.
  expect(drop(0, { socket: "live", readiness: "unauthorized" })).toMatchObject({
    mode: "overlay",
    title: "No longer available",
    canRetry: false,
  });
});

test("a paused cloud computer reads as waking, because the app wakes it", () => {
  // A computer that answers is live, whatever the computer list last said.
  expect(nativeOverlayView({ ...live, cloudPaused: true }).mode).toBe("hidden");
  const first = nativeOverlayView({
    ...live, everReady: false, readiness: "connecting", socket: "connecting", cloudPaused: true, notLiveMs: STARTUP_OVERLAY_AFTER_MS,
  });
  expect(first).toMatchObject({ mode: "overlay", mood: "booting", title: "Waking your computer…", canRetry: false, canSwitch: false });
  expect(drop(PILL_AFTER_MS, { cloudPaused: true })).toMatchObject({ mode: "pill", title: "Waking your computer…", canRetry: false });
});

test("a waking computer boots Boxy", () => {
  expect(drop(OVERLAY_AFTER_MS, { socket: "live", readiness: "waking" })).toMatchObject({
    mode: "overlay",
    mood: "booting",
    title: "Waking your computer…",
  });
});

test("screens that own machine UI keep the overlay away", () => {
  expect(drop(0, { socket: "offline", suppressed: true }).mode).toBe("hidden");
});

test("a failed check stays soft while the app retries it", () => {
  // One 502 or one network error: no failure card, no Try again yet.
  expect(drop(0, { socket: "live", readiness: "unavailable" })).toMatchObject({ mode: "hidden" });
  expect(drop(PILL_AFTER_MS, { socket: "live", readiness: "unavailable" })).toMatchObject({
    mode: "pill", title: "Reconnecting…", canRetry: false,
  });
  const long = drop(OVERLAY_AFTER_MS, { socket: "live", readiness: "error" });
  expect(long).toMatchObject({ mode: "overlay", title: "Reconnecting…", canRetry: false, nextChangeMs: FAIL_AFTER_MS - OVERLAY_AFTER_MS });
  // On the first connect it reads as connecting.
  expect(nativeOverlayView({ ...live, everReady: false, readiness: "unavailable", notLiveMs: STARTUP_OVERLAY_AFTER_MS })).toMatchObject({
    mode: "overlay", title: "Connecting…", canRetry: false,
  });
});

test("waking or resuming only asks the user to wait", () => {
  // No switcher and no retry, however long the wake takes.
  expect(drop(OVERLAY_AFTER_MS * 3, { socket: "live", readiness: "waking" })).toMatchObject({
    mode: "overlay", title: "Waking your computer…", canSwitch: false, canRetry: false,
  });
  expect(drop(OVERLAY_AFTER_MS * 3, { cloudPaused: true })).toMatchObject({ canSwitch: false, canRetry: false });
  expect(drop(OVERLAY_AFTER_MS, { resuming: true })).toMatchObject({ title: "Resuming…", canSwitch: false, canRetry: false });
  // A plain long reconnect still offers another computer.
  expect(drop(OVERLAY_AFTER_MS)).toMatchObject({ canSwitch: true });
});
