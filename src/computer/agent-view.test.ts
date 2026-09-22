// The agent's view must hold a PAGE session before any tool touches it.
//
// Bun.WebView has no CDP session until its first navigate(). Without one, its
// calls land on the browser-level target, where the Page and Runtime domains
// do not exist, and the tools that do not navigate first -- computer_screenshot
// and computer_read -- failed with "'Page.captureScreenshot' wasn't found" and
// "'Runtime.evaluate' wasn't found". Measured against the real desktop before
// the fix; both now pass there.
//
// The fake below reproduces that rule rather than the whole protocol: it
// refuses a screenshot until it has been navigated, exactly as Chrome does.

import { describe, expect, test } from "bun:test";
import { openAgentView, type AgentViewDeps } from "./browser.ts";

class FakeWebView {
  static built = 0;
  navigated: string[] = [];
  constructor(readonly opts: unknown) {
    FakeWebView.built += 1;
  }
  async navigate(url: string): Promise<void> {
    this.navigated.push(url);
  }
  async screenshot(): Promise<Blob> {
    if (this.navigated.length === 0) {
      throw new Error("'Page.captureScreenshot' wasn't found");
    }
    return new Blob([new Uint8Array([137, 80, 78, 71])], { type: "image/png" });
  }
  async evaluate(): Promise<unknown> {
    if (this.navigated.length === 0) throw new Error("'Runtime.evaluate' wasn't found");
    return "";
  }
}

function deps(over: Partial<AgentViewDeps> = {}): AgentViewDeps {
  return {
    ctor: () => FakeWebView as unknown as ReturnType<AgentViewDeps["ctor"]>,
    status: () => ({ running: true, width: 1280, height: 800 }),
    cdpUrl: async () => "ws://127.0.0.1:9222/devtools/browser/fake",
    ...over,
  };
}

describe("openAgentView", () => {
  test("returns a view that already has a page session", async () => {
    const view = (await openAgentView(deps())) as unknown as FakeWebView;
    expect(view.navigated).toEqual(["about:blank"]);
    // The regression: this threw before the navigate moved into the opener.
    expect((await view.screenshot()).type).toBe("image/png");
    expect(await view.evaluate()).toBe("");
  });

  test("sizes the view to the desktop, less the browser chrome", async () => {
    const view = (await openAgentView(deps())) as unknown as FakeWebView;
    expect(view.opts).toMatchObject({
      backend: { type: "chrome", url: "ws://127.0.0.1:9222/devtools/browser/fake" },
      width: 1280,
      height: 760,
    });
  });

  test("refuses to build a view when the desktop is down", async () => {
    const before = FakeWebView.built;
    await expect(
      openAgentView(deps({ status: () => ({ running: false, width: 1280, height: 800 }) })),
    ).rejects.toThrow("the computer is not running");
    expect(FakeWebView.built).toBe(before);
  });

  test("refuses to build a view when the DevTools endpoint is unreachable", async () => {
    const before = FakeWebView.built;
    await expect(openAgentView(deps({ cdpUrl: async () => null }))).rejects.toThrow(
      "cannot reach the desktop browser's DevTools endpoint",
    );
    expect(FakeWebView.built).toBe(before);
  });

  test("refuses to build a view on a Bun with no WebView", async () => {
    await expect(openAgentView(deps({ ctor: () => null }))).rejects.toThrow("Bun.WebView");
  });
});
