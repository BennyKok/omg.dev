// UI blips must not hold the audio session between sounds.
//
// A running AudioContext is an active audio session on iOS. Kept running for
// the life of the page, it held the session after a dictation take, and the
// user's music stayed paused (Benny, 2026-11-01). The context now suspends
// once the last voice has ended.
import { afterAll, expect, test } from "bun:test";

const events: string[] = [];
class FakeContext {
  state: "running" | "suspended" = "running";
  currentTime = 0;
  destination = {};
  createGain() { return { gain: { value: 0, setValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect() {} }; }
  createOscillator() {
    return { type: "sine", frequency: { setValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect() {}, start() {}, stop() {} };
  }
  resume() { this.state = "running"; events.push("resume"); return Promise.resolve(); }
  suspend() { this.state = "suspended"; events.push("suspend"); return Promise.resolve(); }
}
// Other test files can share this process's globals, so patch and restore.
const hadWindow = typeof globalThis.window !== "undefined";
if (!hadWindow) Object.assign(globalThis, { window: {} });
const host = globalThis.window as unknown as { AudioContext?: unknown };
const previousContext = host.AudioContext;
host.AudioContext = FakeContext;
afterAll(() => {
  host.AudioContext = previousContext;
  if (!hadWindow) delete (globalThis as { window?: unknown }).window;
});

// A fresh module instance: another file in this process may already have
// built the shared context (App warms it on the first gesture).
const { playSfx } = await import("./sfx.ts?isolated");
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

test("the context suspends after a blip ends and resumes for the next one", async () => {
  playSfx("tap");
  expect(events).toEqual([]);
  await wait(300);
  expect(events).toEqual([]);
  await wait(400);
  expect(events).toEqual(["suspend"]);
  playSfx("success");
  expect(events).toEqual(["suspend", "resume"]);
  await wait(800);
  expect(events).toEqual(["suspend", "resume", "suspend"]);
});
