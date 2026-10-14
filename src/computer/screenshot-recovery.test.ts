// A WebView screenshot() that never resolves keeps Bun.WebView's single
// capture slot taken, and every later call on that view is rejected with
// "already pending". The view must be dropped so the next call works.

import { describe, expect, test } from "bun:test";
import { screenshotWithRecovery } from "./browser.ts";

const PNG = () => new Blob([new Uint8Array([137, 80, 78, 71])], { type: "image/png" });

class FakeView {
  calls = 0;
  closed = false;
  constructor(private readonly stuck: boolean) {}
  async screenshot(): Promise<Blob> {
    this.calls += 1;
    if (this.calls > 1) throw new Error("Invalid state: a screenshot() is already pending");
    if (this.stuck) return await new Promise<Blob>(() => {});
    return PNG();
  }
  close() { this.closed = true; }
}

function harness(views: FakeView[], timeoutMs = 30) {
  let cached: FakeView | null = null;
  let built = 0;
  const deps = {
    view: async () => (cached ??= views[built++]!) as never,
    focus: async () => {},
    reset: () => { cached?.close(); cached = null; },
    timeoutMs,
  };
  return { deps, built: () => built };
}

describe("screenshotWithRecovery", () => {
  test("a stuck capture times out and the next call uses a fresh view", async () => {
    const stuck = new FakeView(true);
    const fresh = new FakeView(false);
    const h = harness([stuck, fresh]);
    const started = Date.now();
    await expect(screenshotWithRecovery(h.deps)).rejects.toThrow(/timed out/);
    expect(Date.now() - started).toBeLessThan(1000);
    expect(stuck.closed).toBe(true);
    const blob = await screenshotWithRecovery(h.deps);
    expect(blob.size).toBeGreaterThan(0);
    expect(h.built()).toBe(2);
  });

  test("an already-pending rejection resets the view and retries once", async () => {
    const wedged = new FakeView(false);
    wedged.calls = 1; // the slot is already taken
    const fresh = new FakeView(false);
    const h = harness([wedged, fresh]);
    const blob = await screenshotWithRecovery(h.deps);
    expect(blob.size).toBeGreaterThan(0);
    expect(wedged.closed).toBe(true);
  });

  test("other errors pass through without resetting the view", async () => {
    const v = new FakeView(false);
    v.screenshot = async () => { throw new Error("boom"); };
    const h = harness([v]);
    await expect(screenshotWithRecovery(h.deps)).rejects.toThrow("boom");
    expect(v.closed).toBe(false);
  });
});
