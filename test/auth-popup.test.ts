// The connect-agent sign-in: dialog first, tab second.
//
// The bug behind these tests was "onboarding connect Claude opens a blank
// page". The sign-in URL does not exist until the server has spawned a
// provider CLI and scraped its stdout, but `window.open` is only trusted
// inside the synchronous part of a click — so the original code opened a tab
// immediately and awaited the URL inside it, parking the user on
// `about:blank` for the length of the round trip.
//
// The first fix wrote a holding page into that tab. It removed the blankness
// but kept the shape: the address bar still read `about:blank`, and the popup
// still had to survive an await.
//
// This is the shape that removes the problem instead of dressing it: the CLICK
// opens the DIALOG, the dialog owns the wait, and its own button opens the tab
// from a fresh gesture straight at the provider. These tests pin that the wait
// is always visible and that nothing opens a tab speculatively.

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import { isAuthorizationUrl } from "../web/src/lib/auth-popup.ts";

const app = readFileSync("web/src/App.tsx", "utf8");

describe("authorization URL validation", () => {
  test("accepts the http(s) URLs a provider can actually serve", () => {
    expect(isAuthorizationUrl("https://claude.ai/oauth/authorize?code=true")).toBe(true);
    expect(isAuthorizationUrl("http://localhost:1455/auth")).toBe(true);
  });

  test("rejects everything that would open nowhere", () => {
    // The URL is regexed out of CLI output, so drift lands here rather than in
    // a tab the user is looking at.
    expect(isAuthorizationUrl(undefined)).toBe(false);
    expect(isAuthorizationUrl("")).toBe(false);
    expect(isAuthorizationUrl("about:blank")).toBe(false);
    expect(isAuthorizationUrl("Opening browser…")).toBe(false);
    expect(isAuthorizationUrl("javascript:alert(1)")).toBe(false);
    expect(isAuthorizationUrl("/api/coding-agents")).toBe(false);
  });
});

describe("no login path opens a tab speculatively", () => {
  test("nothing opens a blank or placeholder tab", () => {
    expect(app).not.toContain('window.open("about:blank"');
    expect(app).not.toContain('window.open("", "_blank")');
    expect(app).not.toContain("openAuthTab");
  });

  test("the only window.open is the dialog's own button, on a real URL", () => {
    // Call sites only — prose in a comment must not count, or this test
    // fails on documentation.
    const opens = app.match(/window\.open\([^)\s]/g) ?? [];
    expect(opens).toHaveLength(1);
    expect(app).toContain(
      'window.open(session.authorizationUrl, "_blank", "noopener,noreferrer")',
    );
    // Gated, so the button cannot exist for a URL that opens nowhere.
    expect(app).toContain("{isAuthorizationUrl(session.authorizationUrl) ? (");
  });
});

describe("the dialog owns the wait", () => {
  test("pending is set before the round trip, not after", () => {
    const fn = app.slice(
      app.indexOf("async function startBrowserAuth"),
      app.indexOf("async function loginCodingAgent"),
    );
    const pendingAt = fn.indexOf("setCodingAgentAuthPending(providerLabel)");
    const awaitAt = fn.indexOf("await api<CodingAgentAuthSession>");
    expect(pendingAt).toBeGreaterThan(-1);
    expect(awaitAt).toBeGreaterThan(-1);
    // This ordering IS the fix: set after the await and the click again
    // produces nothing on screen until the CLI has answered.
    expect(pendingAt).toBeLessThan(awaitAt);
  });

  test("every exit from the round trip clears pending", () => {
    const fn = app.slice(
      app.indexOf("async function startBrowserAuth"),
      app.indexOf("async function loginCodingAgent"),
    );
    // complete / waiting / throw — a missed one leaves a dialog that cannot
    // be dismissed, since pending also suppresses close.
    expect(fn.match(/setCodingAgentAuthPending\(null\)/g)).toHaveLength(3);
  });

  test("the dialog opens on pending as well as on a session", () => {
    expect(app).toContain("open={!!session || !!pendingLabel}");
  });

  test("preparing is not dismissible, because there is nothing to cancel yet", () => {
    expect(app).toContain("if (!open && !pendingLabel) void close();");
  });

  test("the wait states what is happening", () => {
    expect(app).toContain("Preparing your sign-in link…");
  });

  test("the loading title names the provider rather than falling back", () => {
    // Without the pending label the header would read "Connect Account" for
    // the whole wait, since the session that carries the provider is null.
    expect(app).toContain(
      'const providerLabel = session ? authProviderLabel(session.provider) : (pendingLabel ?? "your account")',
    );
  });

  test("inline auth suppresses the global dialog, pending included", () => {
    expect(app).toContain(
      "pendingLabel={codingAgentAuthInlineSid ? null : codingAgentAuthPending}",
    );
  });
});
