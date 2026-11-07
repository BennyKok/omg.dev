import { expect, test } from "bun:test";
import {
  FAIL_AFTER_MS,
  LONG_WAIT_MS,
  LOCAL_RECONNECT_AFTER_MS,
  STARTUP_SHOW_AFTER_MS,
  RESUME_ESTIMATE_MS,
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

test("a loaded local page stays quiet for a minute, then shows one full-page recovery screen", () => {
  for (const status of ["connecting", "reconnecting", "offline"] as const) {
    for (const error of [null, "Failed to fetch"]) {
      const extra = { status, error };
      expect(reconnecting(500, extra)).toMatchObject({ mode: "hidden", nextChangeMs: LOCAL_RECONNECT_AFTER_MS - 500 });
      expect(reconnecting(LOCAL_RECONNECT_AFTER_MS - 1, extra)).toMatchObject({ mode: "hidden", nextChangeMs: 1 });
      expect(reconnecting(LOCAL_RECONNECT_AFTER_MS, extra)).toMatchObject({
        mode: "page", title: "Reconnecting to your computer", mood: "searching", canRetry: true, canSwitch: false, nextChangeMs: null,
      });
      expect(reconnecting(300_000, extra).mode).toBe("page");
    }
  }
});

test("returning from the background does not skip the local grace period", () => {
  expect(reconnecting(0, { resuming: true })).toMatchObject({ mode: "hidden", nextChangeMs: LOCAL_RECONNECT_AFTER_MS });
});

test("loading data ends the first screen while the socket connects quietly", () => {
  expect(reconnecting(1_000, { status: "connecting" })).toMatchObject({
    mode: "hidden", nextChangeMs: LOCAL_RECONNECT_AFTER_MS - 1_000,
  });
});

test("an unavailable computer offers recovery", () => {
  expect(reconnecting(0, { lifecycle: "unavailable" })).toMatchObject({ mode: "overlay", mood: "error" });
});

test("a waking cloud computer shows resume progress", () => {
  expect(reconnecting(LONG_WAIT_MS, { lifecycle: "waking", resuming: true })).toMatchObject({
    mode: "pill",
    mood: "booting",
    title: "Resuming your computer…",
  });
});

test("paused and waking stay in progress beyond the failure grace period", () => {
  for (const lifecycle of ["paused", "waking", "starting", "ready"] as const) {
    const initial = reconnecting(0, { lifecycle, loading: true, ready: false });
    expect(initial).toMatchObject({ mode: "overlay", progress: 0, canRetry: false, canSwitch: false });
    expect(initial.detail).toContain("about 30 seconds");
    const delayed = reconnecting(RESUME_ESTIMATE_MS, { lifecycle, status: "offline", error: "old 425" });
    expect(delayed).toMatchObject({ mode: "pill", mood: "booting", canRetry: false, canSwitch: false });
    expect(delayed.detail).toContain("longer than expected");
    expect(delayed.progress).toBeGreaterThan(initial.progress!);
    expect(reconnecting(300_000, { lifecycle }).progress).toBeLessThan(100);
  }
  expect(connectionOverlayView({ ...live, lifecycle: "waking" }).mode).toBe("hidden");
});

test("a first load uses one full page and offers a retry after a minute", () => {
  for (const error of [null, "Failed to fetch"]) {
    const first = { ...live, loading: true, ready: false, status: "connecting" as const, error };
    expect(connectionOverlayView({ ...first, notLiveMs: 100 }).mode).toBe("hidden");
    expect(connectionOverlayView({ ...first, notLiveMs: STARTUP_SHOW_AFTER_MS })).toMatchObject({
      mode: "page", mood: "booting", canRetry: false, canSwitch: false,
      nextChangeMs: FAIL_AFTER_MS - STARTUP_SHOW_AFTER_MS,
    });
    expect(connectionOverlayView({ ...first, notLiveMs: FAIL_AFTER_MS })).toMatchObject({
      mode: "page", canRetry: false, nextChangeMs: LOCAL_RECONNECT_AFTER_MS - FAIL_AFTER_MS,
    });
    expect(connectionOverlayView({ ...first, notLiveMs: LOCAL_RECONNECT_AFTER_MS })).toMatchObject({
      mode: "page", canRetry: true, canSwitch: false, nextChangeMs: null,
    });
  }
});

test("a recovered socket clears an older bootstrap error", () => {
  expect(connectionOverlayView({ ...live, error: "old 503", notLiveMs: FAIL_AFTER_MS * 2 }).mode).toBe("hidden");
});

test("an update restart says so and only asks the user to wait", () => {
  const view = reconnecting(LONG_WAIT_MS + FAIL_AFTER_MS, { lifecycle: "updating" });
  expect(view).toMatchObject({ mode: "pill", mood: "booting", canRetry: false, canSwitch: false });
  expect(view.title).toMatch(/updat/i);
});

test("a failed or unavailable computer names the failure even while the socket is newly offline", () => {
  // The title and Retry once came from two different rules. Within the first
  // FAIL_AFTER_MS of an offline socket, a failed computer read "Connecting…"
  // beside a Retry button.
  for (const lifecycle of ["failed", "unavailable"] as const) {
    const view = connectionOverlayView({ ...live, ready: false, status: "offline", lifecycle, notLiveMs: 1_000 });
    expect(view).toMatchObject({ mode: "overlay", mood: "error", canRetry: true });
    expect(view.title).not.toBe("Connecting…");
    expect(view.title).toBe(lifecycle === "failed" ? "Could not start your computer" : "Computer unavailable");
  }
});
