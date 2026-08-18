// The sign-in tab, and the guarantee that it is never blank.
//
// The bug this covers: "onboarding connect Claude opens a blank page". The tab
// has to be opened inside the click, but the URL it needs only exists a server
// round trip later — so the old code parked the user on `about:blank` for the
// length of that trip, and closed the tab outright whenever the trip failed.
// These tests pin the property that replaced it: a tab opened through
// openAuthTab always has content, and every exit path either navigates it or
// explains itself in it.

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import {
  escapeHtml,
  failureDocument,
  isAuthorizationUrl,
  openAuthTab,
  waitingDocument,
} from "../web/src/lib/auth-popup.ts";

/** The parts of a popup handle the carrier actually touches. */
function fakeTab() {
  const written: string[] = [];
  const tab = {
    closed: false,
    opener: {} as unknown,
    focused: 0,
    location: {
      replaced: [] as string[],
      replace(url: string) {
        this.replaced.push(url);
      },
    },
    document: {
      open() {},
      write(html: string) {
        written.push(html);
      },
      close() {},
    },
    focus() {
      tab.focused += 1;
    },
    close() {
      tab.closed = true;
    },
  };
  return { tab, written };
}

function withWindow(
  open: (url: string, target: string) => unknown,
  run: () => void,
): void {
  const previous = (globalThis as { window?: unknown }).window;
  (globalThis as { window?: unknown }).window = { open };
  try {
    run();
  } finally {
    (globalThis as { window?: unknown }).window = previous;
  }
}

describe("authorization URL validation", () => {
  test("accepts the http(s) URLs a provider can actually serve", () => {
    expect(isAuthorizationUrl("https://claude.ai/oauth/authorize?code=true")).toBe(true);
    expect(isAuthorizationUrl("http://localhost:1455/auth")).toBe(true);
  });

  test("rejects everything that would leave the tab blank or worse", () => {
    // A CLI's URL is scraped out of its stdout, so drift lands here rather
    // than in the tab.
    expect(isAuthorizationUrl(undefined)).toBe(false);
    expect(isAuthorizationUrl("")).toBe(false);
    expect(isAuthorizationUrl("about:blank")).toBe(false);
    expect(isAuthorizationUrl("Opening browser…")).toBe(false);
    expect(isAuthorizationUrl("javascript:alert(1)")).toBe(false);
    expect(isAuthorizationUrl("/api/coding-agents")).toBe(false);
  });
});

describe("the tab is never contentless", () => {
  test("opening one writes its document in the same call", () => {
    const { tab, written } = fakeTab();
    withWindow(
      () => tab,
      () => {
        const pending = openAuthTab("Claude");
        expect(pending.opened).toBe(true);
        // Written BEFORE any caller can await: this is the whole fix.
        expect(written).toHaveLength(1);
        expect(written[0]).toContain("Opening Claude sign in…");
      },
    );
  });

  test("severs the child's back-reference to the host", () => {
    const { tab } = fakeTab();
    withWindow(
      () => tab,
      () => {
        openAuthTab("Claude");
        expect(tab.opener).toBeNull();
      },
    );
  });

  test("settling navigates the tab it already holds", () => {
    const { tab } = fakeTab();
    withWindow(
      () => tab,
      () => {
        const pending = openAuthTab("Codex");
        expect(pending.settle("https://auth.openai.com/codex/device")).toBe(true);
        expect(tab.location.replaced).toEqual(["https://auth.openai.com/codex/device"]);
        expect(tab.focused).toBe(1);
      },
    );
  });

  test("refuses to settle on a URL that is not a sign-in page", () => {
    const { tab } = fakeTab();
    withWindow(
      () => tab,
      () => {
        const pending = openAuthTab("Claude");
        expect(pending.settle(undefined)).toBe(false);
        expect(pending.settle("javascript:alert(1)")).toBe(false);
        expect(tab.location.replaced).toEqual([]);
        // Still open, still showing the waiting document — never navigated
        // somewhere blank.
        expect(tab.closed).toBe(false);
      },
    );
  });

  test("failing repaints the tab instead of closing it", () => {
    const { tab, written } = fakeTab();
    withWindow(
      () => tab,
      () => {
        const pending = openAuthTab("Claude");
        pending.fail("Install the Claude CLI before signing in");
        // The popup holds focus, so the reason has to be IN it — a toast on
        // the host page is behind the window the user is looking at.
        expect(tab.closed).toBe(false);
        expect(written).toHaveLength(2);
        expect(written[1]).toContain("Install the Claude CLI before signing in");
      },
    );
  });

  test("settling a closed tab reports failure rather than throwing", () => {
    const { tab } = fakeTab();
    withWindow(
      () => tab,
      () => {
        const pending = openAuthTab("Claude");
        tab.closed = true;
        expect(pending.settle("https://claude.ai/oauth/authorize")).toBe(false);
        expect(() => pending.fail("gone")).not.toThrow();
        expect(() => pending.close()).not.toThrow();
      },
    );
  });

  test("a blocked popup is reported, not faked", () => {
    withWindow(
      () => null,
      () => {
        const pending = openAuthTab("Claude");
        expect(pending.opened).toBe(false);
        expect(pending.settle("https://claude.ai/oauth/authorize")).toBe(false);
        // The caller falls back to the in-page button; nothing here throws.
        expect(() => pending.fail("blocked")).not.toThrow();
      },
    );
  });

  test("a window.open that throws degrades to 'not opened'", () => {
    withWindow(
      () => {
        throw new Error("blocked by policy");
      },
      () => {
        expect(openAuthTab("Claude").opened).toBe(false);
      },
    );
  });
});

describe("the documents it writes", () => {
  test("both are complete documents, not fragments", () => {
    for (const html of [waitingDocument("Claude"), failureDocument("nope")]) {
      expect(html.startsWith("<!doctype html>")).toBe(true);
      expect(html).toContain("<body>");
    }
  });

  test("provider names and server errors are escaped, never markup", () => {
    expect(escapeHtml('<img src=x onerror="alert(1)">')).toBe(
      "&lt;img src=x onerror=&quot;alert(1)&quot;&gt;",
    );
    expect(waitingDocument("<script>")).not.toContain("<script>");
    expect(failureDocument("<script>bad</script>")).not.toContain("<script>bad");
  });

  test("reduced motion keeps a live affordance instead of a frozen ring", () => {
    // A still spinner reads as hung, which is the same failure this module
    // exists to remove.
    expect(waitingDocument("Claude")).toContain("prefers-reduced-motion");
  });
});

describe("App wiring", () => {
  const app = readFileSync("web/src/App.tsx", "utf8");

  test("no login path opens a raw blank tab any more", () => {
    expect(app).not.toContain('window.open("about:blank"');
  });

  test("startBrowserAuth drives the carrier", () => {
    expect(app).toContain("const authTab = openAuthTab(providerLabel)");
    expect(app).toContain("if (authTab.settle(session.authorizationUrl)) return;");
  });

  test("a failed start explains itself in the tab", () => {
    expect(app).toContain("authTab.fail(message)");
  });

  test("the tab is only closed when the host owns what happens next", () => {
    // Exactly one close(): the "already connected" branch, which has no page
    // left to show and reports on the host surface instead.
    expect(app.match(/authTab\.close\(\)/g)).toHaveLength(1);
  });

  test("the in-panel button refuses a URL that is not a sign-in page", () => {
    expect(app).toContain("{isAuthorizationUrl(session.authorizationUrl) ? (");
  });
});
