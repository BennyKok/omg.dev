// A WebView navigate() resolves on the load event. A page that never fires it
// keeps Bun.WebView's single navigation slot taken, and every later navigate
// on that view throws "a navigation is already pending" (synchronously, as
// Bun 1.4.4 does). The view must be dropped so navigation works again.

import { describe, expect, test } from "bun:test";
import { navigateWithRecovery, withViewRecovery } from "./browser.ts";

type Mode = "ok" | "hang" | "hang-after-commit";

class FakeView {
  url = "about:blank";
  title = "";
  closed = false;
  pending = false;
  navigations = 0;
  constructor(private readonly mode: Mode) {}
  navigate(url: string): Promise<void> {
    // Bun throws this one synchronously, not as a rejected promise.
    if (this.pending) throw new Error("Invalid state: a navigation is already pending");
    this.navigations += 1;
    if (this.mode === "ok") {
      this.url = url;
      this.title = `title of ${url}`;
      return Promise.resolve();
    }
    this.pending = true;
    // The document committed but a subresource never finishes loading.
    if (this.mode === "hang-after-commit") this.url = url;
    return new Promise<void>(() => {});
  }
  async evaluate(script: string): Promise<unknown> {
    return script === "document.title" ? `live title of ${this.url}` : undefined;
  }
  close() { this.closed = true; }
}

function harness(views: FakeView[], timeoutMs = 30) {
  let cached: FakeView | null = null;
  let built = 0;
  const captured: FakeView[] = [];
  const deps = {
    view: async () => (cached ??= views[built++]!) as never,
    focus: async () => {},
    reset: () => { cached?.close(); cached = null; },
    capture: async (v: unknown) => { captured.push(v as FakeView); },
    timeoutMs,
  };
  return { deps, built: () => built, captured };
}

describe("navigateWithRecovery", () => {
  test("normal navigation returns the url and title and keeps the view", async () => {
    const v = new FakeView("ok");
    const h = harness([v]);
    const out = await navigateWithRecovery(h.deps, "https://example.com/");
    expect(out).toEqual({ url: "https://example.com/", title: "title of https://example.com/" });
    expect(v.closed).toBe(false);
    expect(h.captured).toEqual([v]);
  });

  test("a navigate that never resolves drops the view and retries on a fresh one", async () => {
    const stuck = new FakeView("hang");
    const fresh = new FakeView("ok");
    const h = harness([stuck, fresh]);
    const started = Date.now();
    const out = await navigateWithRecovery(h.deps, "https://example.com/");
    expect(Date.now() - started).toBeLessThan(1000);
    expect(out.url).toBe("https://example.com/");
    expect(stuck.closed).toBe(true);
    expect(h.built()).toBe(2);
    // The fresh tab is the one brought to the front.
    expect(h.captured).toEqual([fresh]);
  });

  test("an already-pending view is dropped and the navigation retried once", async () => {
    const wedged = new FakeView("ok");
    wedged.pending = true; // an earlier navigate never finished
    const fresh = new FakeView("ok");
    const h = harness([wedged, fresh]);
    const out = await navigateWithRecovery(h.deps, "https://example.com/next");
    expect(out.url).toBe("https://example.com/next");
    expect(wedged.closed).toBe(true);
    expect(wedged.navigations).toBe(0);
    expect(fresh.navigations).toBe(1);
  });

  test("a slow page whose address changed counts as loaded and keeps the view", async () => {
    const slow = new FakeView("hang-after-commit");
    const h = harness([slow]);
    const out = await navigateWithRecovery(h.deps, "https://mail.example.com/");
    expect(out.url).toBe("https://mail.example.com/");
    // Not the stale view.title, which still belongs to the previous page.
    expect(out.title).toBe("live title of https://mail.example.com/");
    expect(slow.closed).toBe(false);
    expect(h.built()).toBe(1);
    expect(h.captured).toEqual([slow]);
  });

  test("the navigate after a slow page moves to a fresh view", async () => {
    const slow = new FakeView("hang-after-commit");
    const fresh = new FakeView("ok");
    const h = harness([slow, fresh]);
    await navigateWithRecovery(h.deps, "https://mail.example.com/");
    const out = await navigateWithRecovery(h.deps, "https://example.com/");
    expect(out.url).toBe("https://example.com/");
    expect(slow.closed).toBe(true);
    expect(h.built()).toBe(2);
  });

  test("it gives up after one retry when the fresh view stalls too", async () => {
    const a = new FakeView("hang");
    const b = new FakeView("hang");
    const h = harness([a, b]);
    await expect(navigateWithRecovery(h.deps, "https://example.com/")).rejects.toThrow(
      "navigation timed out; try again",
    );
    expect(a.closed).toBe(true);
    expect(b.closed).toBe(true);
    expect(h.built()).toBe(2);
  });
});

describe("withViewRecovery for input", () => {
  test("a timed-out operation is not repeated, and the view is dropped", async () => {
    let typed = 0;
    let closed = false;
    const view = { close: () => { closed = true; } };
    const deps = {
      view: async () => view as never,
      focus: async () => {},
      reset: () => view.close(),
      timeoutMs: 30,
    };
    await expect(
      withViewRecovery(deps, "typing", async () => {
        typed += 1;
        await new Promise(() => {});
      }),
    ).rejects.toThrow("typing timed out; try again");
    expect(typed).toBe(1);
    expect(closed).toBe(true);
  });

  test("other errors pass through without dropping the view", async () => {
    let reset = 0;
    const deps = {
      view: async () => ({}) as never,
      focus: async () => {},
      reset: () => { reset += 1; },
      timeoutMs: 30,
    };
    await expect(
      withViewRecovery(deps, "click", async () => {
        throw new Error("timeout waiting for '#missing' to be actionable");
      }),
    ).rejects.toThrow("actionable");
    expect(reset).toBe(0);
  });
});
