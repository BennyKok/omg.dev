import { expect, test } from "bun:test";
import { composerSendMode } from "./runtime-availability";

// On the saved screen (last visit's state, while the Computer wakes) a new
// session can be sent at once and goes out when the runtime is live.
// Failures this must catch: a send dropped on the saved screen; a send queued
// over a load error the person never sees; a live runtime that queues.
const base = { loading: false, ready: true, status: "live" as const, error: null, saved: false };

test("a live runtime sends now", () => {
  expect(composerSendMode(base)).toBe("send");
});

test("the saved screen waits for the runtime, then sends", () => {
  const waking = { ...base, loading: true, ready: false, status: "connecting" as const, saved: true };
  expect(composerSendMode(waking)).toBe("wait");
  expect(composerSendMode({ ...waking, loading: false, ready: true, status: "live" as const, saved: false })).toBe("send");
});

test("no saved screen, or a load error, neither sends nor waits", () => {
  expect(composerSendMode({ ...base, loading: true, ready: false, status: "connecting" })).toBe("none");
  expect(composerSendMode({ ...base, ready: false, saved: true, error: "bootstrap failed" })).toBe("none");
});
