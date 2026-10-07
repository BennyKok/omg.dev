import { expect, test } from "bun:test";
import {
  FAIL_AFTER_MS,
  LONG_WAIT_MS,
  PILL_AFTER_MS,
  STARTUP_SHOW_AFTER_MS,
  connectionOverlayView,
  type ConnectionOverlayInput,
} from "./connection-overlay";

const live: ConnectionOverlayInput = {
  loading: false,
  ready: true,
  status: "live",
  error: null,
  lifecycle: null,
  notLiveMs: 0,
  resuming: false,
};
const reconnecting = (notLiveMs: number, extra: Partial<ConnectionOverlayInput> = {}) =>
  connectionOverlayView({ ...live, status: "reconnecting", notLiveMs, ...extra });

test("a live runtime shows nothing", () => {
  expect(connectionOverlayView(live).mode).toBe("hidden");
});

test("a reconnect stays a pill however long it takes", () => {
  const blip = reconnecting(500);
  expect(blip.mode).toBe("hidden");
  expect(blip.nextChangeMs).toBe(PILL_AFTER_MS - 500);

  const pill = reconnecting(PILL_AFTER_MS);
  // Still reconnecting: no Retry, nothing that reads as a failure.
  expect(pill).toMatchObject({ mode: "pill", mood: "searching", title: "Reconnecting…", canRetry: false });
  expect(pill.nextChangeMs).toBe(LONG_WAIT_MS - PILL_AFTER_MS);

  // The app behind stays usable, so a long wait never dims it.
  expect(reconnecting(LONG_WAIT_MS)).toMatchObject({ mode: "pill", canRetry: false, canSwitch: true, nextChangeMs: null });
  expect(reconnecting(LONG_WAIT_MS * 10)).toMatchObject({ mode: "pill" });
});

test("coming back from the background says Resuming and shows at once", () => {
  expect(reconnecting(0, { resuming: true })).toMatchObject({ mode: "pill", title: "Resuming…" });
});

test("offline waits before a card; a server-stopped computer shows it at once", () => {
  expect(reconnecting(FAIL_AFTER_MS, { status: "offline" })).toMatchObject({ mode: "overlay", mood: "sleeping", canRetry: true, canSwitch: true });
  expect(reconnecting(0, { lifecycle: "paused" })).toMatchObject({
    mode: "overlay",
    mood: "sleeping",
    title: "Computer paused",
  });
  expect(reconnecting(0, { lifecycle: "unavailable" })).toMatchObject({ mode: "overlay", mood: "error" });
  expect(connectionOverlayView({ ...live, ready: false, error: "Failed to fetch", notLiveMs: FAIL_AFTER_MS })).toMatchObject({
    mode: "overlay",
    mood: "error",
    title: "Connection unavailable",
    canRetry: true,
  });
});

test("a waking cloud computer boots Boxy and does not say Resuming", () => {
  expect(reconnecting(LONG_WAIT_MS, { lifecycle: "waking", resuming: true })).toMatchObject({
    mode: "pill",
    mood: "booting",
    title: "Waking your computer…",
  });
});

test("the first bootstrap waits briefly, then covers the empty shell without Retry", () => {
  const first = { ...live, loading: true, ready: false, status: "connecting" as const };
  expect(connectionOverlayView({ ...first, notLiveMs: 100 }).mode).toBe("hidden");
  expect(connectionOverlayView({ ...first, notLiveMs: STARTUP_SHOW_AFTER_MS })).toMatchObject({
    mode: "overlay",
    mood: "booting",
    title: "Connecting…",
    canRetry: false,
    canSwitch: false,
    nextChangeMs: LONG_WAIT_MS - STARTUP_SHOW_AFTER_MS,
  });
  expect(connectionOverlayView({ ...first, notLiveMs: LONG_WAIT_MS })).toMatchObject({
    canRetry: false,
    canSwitch: true,
  });
});

test("a failed bootstrap stays soft while the app retries it", () => {
  const failed = { ...live, status: "reconnecting" as const, ready: true, error: "Failed to fetch" };
  expect(connectionOverlayView({ ...failed, notLiveMs: 0 }).mode).toBe("hidden");
  expect(connectionOverlayView({ ...failed, notLiveMs: PILL_AFTER_MS })).toMatchObject({
    mode: "pill", title: "Reconnecting…", canRetry: false,
  });
  expect(connectionOverlayView({ ...failed, notLiveMs: LONG_WAIT_MS })).toMatchObject({
    mode: "pill", title: "Reconnecting…", canRetry: false, nextChangeMs: FAIL_AFTER_MS - LONG_WAIT_MS,
  });
  expect(connectionOverlayView({ ...failed, notLiveMs: FAIL_AFTER_MS })).toMatchObject({
    mode: "overlay", mood: "error", canRetry: true,
  });
  // Offline also gets the same grace period.
  expect(connectionOverlayView({ ...failed, status: "offline", notLiveMs: FAIL_AFTER_MS })).toMatchObject({ mode: "overlay", canRetry: true });
});

test("waking or resuming only asks the user to wait", () => {
  for (const extra of [{ lifecycle: "waking" as const }, { lifecycle: "starting" as const }, { resuming: true }]) {
    expect(reconnecting(LONG_WAIT_MS * 3, extra)).toMatchObject({ mode: "pill", canSwitch: false, canRetry: false });
  }
  expect(reconnecting(LONG_WAIT_MS)).toMatchObject({ canSwitch: true });
});

test("brief offline drops do not open a dialog", () => {
  expect(reconnecting(100, { status: "offline" })).toMatchObject({ mode: "hidden" });
  expect(reconnecting(PILL_AFTER_MS, { status: "offline" })).toMatchObject({ mode: "pill", canRetry: false });
  expect(reconnecting(FAIL_AFTER_MS - 1, { status: "offline" })).toMatchObject({ mode: "pill", nextChangeMs: 1 });
});

test("a recovered socket clears an older bootstrap error", () => {
  expect(connectionOverlayView({ ...live, error: "old 503", notLiveMs: FAIL_AFTER_MS * 2 }).mode).toBe("hidden");
});
