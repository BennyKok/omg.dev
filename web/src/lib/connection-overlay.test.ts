import { expect, test } from "bun:test";
import {
  OVERLAY_AFTER_MS,
  PILL_AFTER_MS,
  STARTUP_OVERLAY_AFTER_MS,
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

test("a reconnect grows from silent to pill to overlay", () => {
  const blip = reconnecting(500);
  expect(blip.mode).toBe("hidden");
  expect(blip.nextChangeMs).toBe(PILL_AFTER_MS - 500);

  const pill = reconnecting(PILL_AFTER_MS);
  expect(pill).toMatchObject({ mode: "pill", mood: "searching", title: "Reconnecting…", canRetry: true });
  expect(pill.nextChangeMs).toBe(OVERLAY_AFTER_MS - PILL_AFTER_MS);

  expect(reconnecting(OVERLAY_AFTER_MS)).toMatchObject({ mode: "overlay", nextChangeMs: null });
});

test("coming back from the background says Resuming and shows at once", () => {
  expect(reconnecting(0, { resuming: true })).toMatchObject({ mode: "pill", title: "Resuming…" });
});

test("offline and a server-stopped computer dim the app at once", () => {
  expect(reconnecting(0, { status: "offline" })).toMatchObject({ mode: "overlay", mood: "sleeping" });
  expect(reconnecting(0, { lifecycle: "paused" })).toMatchObject({
    mode: "overlay",
    mood: "sleeping",
    title: "Computer paused",
  });
  expect(reconnecting(0, { lifecycle: "unavailable" })).toMatchObject({ mode: "overlay", mood: "error" });
  expect(connectionOverlayView({ ...live, ready: false, error: "Failed to fetch" })).toMatchObject({
    mode: "overlay",
    mood: "error",
    title: "Connection unavailable",
    canRetry: true,
  });
});

test("a waking cloud computer boots Boxy and does not say Resuming", () => {
  expect(reconnecting(OVERLAY_AFTER_MS, { lifecycle: "waking", resuming: true })).toMatchObject({
    mode: "overlay",
    mood: "booting",
    title: "Waking your computer…",
  });
});

test("the first bootstrap waits briefly, then covers the empty shell without Retry", () => {
  const first = { ...live, loading: true, ready: false, status: "connecting" as const };
  expect(connectionOverlayView({ ...first, notLiveMs: 100 }).mode).toBe("hidden");
  expect(connectionOverlayView({ ...first, notLiveMs: STARTUP_OVERLAY_AFTER_MS })).toMatchObject({
    mode: "overlay",
    mood: "booting",
    title: "Connecting…",
    canRetry: false,
  });
});
