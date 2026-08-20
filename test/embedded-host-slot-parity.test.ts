// Regression coverage for the "compact floating Computer + Settings pill"
// bug: a host mounting @omg-dev/app's OmgAppSurface (the native library
// build, not the legacy `?embed=1` iframe) docks its own global switcher
// into the `[data-lfg-host-slot="header-actions"]` node this app renders
// inside its embedded mobile header — see docs/embed-host-protocol.md and
// vibes' web/src/components/app/lfg-host-slot.ts. When no such node exists
// in the DOM, the host's `GlobalNavIslandBar` falls back to floating its own
// fixed-position pill over the page instead of docking into ours, which is
// what produced the foreign-looking overlapping pill.
//
// App.tsx renders FOUR distinct chrome branches depending on breakpoint and
// route, and the slot has to be wired into every one that can render while
// embedded, or a host mounted at that exact width/route falls back to
// floating:
//   1. mobile Live header       (isMobile && tab === "live")
//   2. mobile secondary header  (embedded && isMobile, tab !== "live")
//   3. generic/tablet header    (!isMobile, not desktop-rail: ~768-1023px)
//   4. desktop rail footer      (isWide workspace, RailStage aside)
//
// This file pins that all four expose the slot when embedded, so a future
// edit to any one branch can't reopen the gap that branch 3 shipped with.

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const APP = readFileSync(new URL("../web/src/App.tsx", import.meta.url), "utf8");

const SLOT = 'data-lfg-host-slot="header-actions"';

function sliceBetween(startAnchor: string, endAnchor: string): string {
  const start = APP.indexOf(startAnchor);
  expect(start, `could not find start anchor: ${startAnchor}`).toBeGreaterThan(-1);
  const end = APP.indexOf(endAnchor, start);
  expect(end, `could not find end anchor after start: ${endAnchor}`).toBeGreaterThan(start);
  return APP.slice(start, end);
}

describe("embedded header host-slot parity across breakpoints", () => {
  test("mobile Live header offers the header-actions slot", () => {
    const body = sliceBetween(
      'isMobile && tab === "live" ? (',
      ") : embedded && isMobile ? (",
    );
    expect(body).toContain(SLOT);
  });

  test("mobile secondary-page header offers the header-actions slot", () => {
    const body = sliceBetween(
      ") : embedded && isMobile ? (",
      ") : liveDesktopWorkspace ? null : (",
    );
    expect(body).toContain(SLOT);
  });

  test("the generic/tablet header (~768-1023px) offers the header-actions slot", () => {
    // This is the branch that shipped without the slot: not mobile (<768px)
    // and not the wide desktop rail workspace (>=1024px). A host mounted in
    // that band — tablet portrait, split view, a resized embedded window —
    // had no node to dock into and fell back to floating its own pill.
    const body = sliceBetween(") : liveDesktopWorkspace ? null : (", "{embedded ? null : <PwaInstallCallout");
    expect(body).toContain(SLOT);
    // The slot must be conditional on `embedded` — standalone LFG owns this
    // header itself and must never advertise a host dock target.
    expect(body).toMatch(/embedded \? \(\s*<span[\s\S]*?data-lfg-host-slot="header-actions"/);
  });

  test("the desktop rail footer offers its own host slot", () => {
    expect(APP).toContain('data-lfg-host-slot="rail-footer"');
    const at = APP.indexOf('data-lfg-host-slot="rail-footer"');
    const before = APP.slice(Math.max(0, at - 400), at);
    expect(before, "rail-footer slot must be gated on `hosted`").toContain("hosted ? (");
  });

  test("there are exactly three header-actions slot instances", () => {
    // Mobile Live, mobile secondary-page, and the generic/tablet header. A
    // fourth would mean a new chrome branch shipped without this test's
    // knowledge; fewer would mean one regressed back to no slot.
    const occurrences = APP.split(SLOT).length - 1;
    expect(occurrences).toBe(3);
  });

  test("slots that mount a PagesMenu also carry the host-settings flag", () => {
    // useLfgHostSettingsInMenu (vibes) reads this attribute off the SAME node
    // it finds via useLfgHostSlot, to decide whether the host's own Settings
    // chip is redundant. Only meaningful where LFG's menu can actually carry
    // a Settings item back to the host (mobile Live, generic/tablet) — the
    // mobile secondary-page header has no PagesMenu at all (just a back
    // button), so it correctly leaves the flag unset and the host keeps
    // drawing its own gear there.
    const liveHeader = sliceBetween(
      'isMobile && tab === "live" ? (',
      ") : embedded && isMobile ? (",
    );
    const tabletHeader = sliceBetween(") : liveDesktopWorkspace ? null : (", "{embedded ? null : <PwaInstallCallout");
    for (const [name, body] of [["mobile Live", liveHeader], ["generic/tablet", tabletHeader]] as const) {
      expect(body, `${name} header slot is missing the host-settings flag`).toContain(
        "data-lfg-host-settings={hostSettingsInMenu",
      );
    }
  });
});
