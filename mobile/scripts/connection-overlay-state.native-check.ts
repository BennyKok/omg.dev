import { expect, test } from "bun:test";
import {
  OVERLAY_AFTER_MS,
  PILL_AFTER_MS,
  nativeOverlayView,
  type NativeOverlayInput,
} from "../src/omg/connection-overlay-state";

const live: NativeOverlayInput = {
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

test("the first connect belongs to the launch screen and the list", () => {
  expect(drop(OVERLAY_AFTER_MS, { everReady: false }).mode).toBe("hidden");
  expect(nativeOverlayView({ ...live, everReady: false, readiness: "unavailable" }).mode).toBe("hidden");
});

test("a reconnect grows from silent to pill to card", () => {
  expect(drop(500)).toMatchObject({ mode: "hidden", nextChangeMs: PILL_AFTER_MS - 500 });
  expect(drop(PILL_AFTER_MS)).toMatchObject({ mode: "pill", mood: "searching", title: "Reconnecting…" });
  expect(drop(OVERLAY_AFTER_MS)).toMatchObject({ mode: "overlay", canSwitch: true, nextChangeMs: null });
});

test("coming back from the background says Resuming at once", () => {
  expect(drop(0, { resuming: true })).toMatchObject({ mode: "pill", title: "Resuming…" });
});

test("hard failures show the card at once with the right mood", () => {
  expect(drop(0, { socket: "offline" })).toMatchObject({ mode: "overlay", mood: "sleeping" });
  expect(drop(0, { socket: "live", cloudPaused: true })).toMatchObject({
    mode: "overlay",
    mood: "sleeping",
    title: "Computer paused",
  });
  expect(drop(0, { socket: "live", readiness: "unavailable" })).toMatchObject({ mode: "overlay", mood: "error" });
  expect(drop(0, { socket: "live", readiness: "unauthorized" })).toMatchObject({
    mode: "overlay",
    title: "No longer available",
  });
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
