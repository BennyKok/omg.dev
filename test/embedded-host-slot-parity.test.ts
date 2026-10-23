// Regression coverage for the host's floating Settings control.
//
// A host mounting @omg-dev/app's OmgAppSurface docks its own header actions
// into `[data-lfg-host-slot="header-actions"]` (see docs/embed-host-protocol.md
// and vibes' web/src/components/app/lfg-host-slot.ts). When no such node is in
// the DOM, the host floats its own Settings control over our page. When the
// node has no `data-lfg-host-settings="menu"` flag, the host docks a Settings
// gear into it. Either way a phone saw a Settings button in the top-right
// corner on some pages and not others.
//
// So every page offers the slot, and every slot carries the flag, because our
// page navigation (the phone drawer or the Pages menu) carries the host's
// Settings on every page. One builder makes the slot; this file pins that each
// chrome branch uses it:
//   1. phone Live header (Live, Bots and Scheduled share it)
//   2. shared page header (phone secondary pages and the tablet band)
//   3. the Computer, which has no header
//   4. desktop rail footer (its own `rail-footer` slot)

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

describe("embedded host slot on every page", () => {
  test("one builder makes the header-actions slot, flagged and embedded-only", () => {
    expect(APP.split(SLOT).length - 1).toBe(1);
    const builder = sliceBetween("const hostActionsSlot = ", ") : null;");
    expect(builder).toContain(SLOT);
    expect(builder).toContain("embedded ? (");
    expect(builder).toContain('data-lfg-host-settings={hostSettingsInMenu ? "menu" : undefined}');
    expect(builder).toContain('data-lfg-host-drawer={isMobile ? "footer" : undefined}');
  });

  test("the phone Live header uses it", () => {
    const body = sliceBetween("isMobile && isPrimarySurfaceTab(tab) ? (", ") : chromelessSurface ? null : (");
    expect(body).toContain("hostActionsSlot(");
    expect(body).toContain("{pageNavigation}");
  });

  test("the shared page header uses it on a phone and on a tablet", () => {
    const body = sliceBetween(") : chromelessSurface ? null : (", "{embedded || isWide ? null : <PwaInstallCallout");
    // Phone without scope filters, and the right island otherwise.
    expect(body.split("hostActionsSlot(").length - 1).toBe(2);
    expect(body).toContain("{isMobile ? pageNavigation : null}");
    expect(body).toContain("{isMobile ? null : pageNavigation}");
  });

  test("there is no separate embedded phone header without the drawer", () => {
    // It carried only a back button and an unflagged slot, so the host docked
    // its Settings gear there.
    expect(APP).not.toContain(") : embedded && isMobile ? (");
  });

  test("the Computer page gets the same navigation and slot", () => {
    const body = sliceBetween("<ComputerPage", "/>\n          </Suspense>");
    expect(body).toContain("navigation={");
    expect(body).toContain("{pageNavigation}");
    expect(body).toContain("hostActionsSlot(");
  });

  test("the desktop rail footer offers its own host slot", () => {
    expect(APP).toContain('data-lfg-host-slot="rail-footer"');
    const at = APP.indexOf('data-lfg-host-slot="rail-footer"');
    const before = APP.slice(Math.max(0, at - 400), at);
    expect(before, "rail-footer slot must be gated on `hosted`").toContain("hosted ? (");
  });
});
