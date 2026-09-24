import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const APP = readFileSync(new URL("../web/src/App.tsx", import.meta.url), "utf8");
const CSS = readFileSync(new URL("../web/src/index.css", import.meta.url), "utf8");

/**
 * Regression coverage for a desktop-only bug: commit 1b3ca7d added a
 * `{!selectedBotId ? <SurfaceToggle/> : null}` guard to `RailStage`'s rail
 * header to keep the Chat/Bots switch out of the *mobile* full-screen bot
 * conversation (which has its own Back button, per v0.2.6). That guard was
 * folded into the desktop rail too, as a side effect of the merge, even
 * though the desktop rail is never replaced by a full-screen conversation —
 * it always keeps showing the roster, with the stage panes doing the
 * switching. The result: selecting any bot on desktop hid the switch bar
 * with no way back to the Chat surface.
 *
 * The mobile half of this rule no longer exists: the dock and its
 * `shouldShowMobileSurfaceToggle` guard were replaced by the side
 * navigation, which is an overlay and needs no such gate. This file pins
 * the desktop half, which does still apply: the rail's `SurfaceToggle`
 * mount must never be gated on `selectedBotId`.
 */
function railStageBody(): string {
  const start = APP.indexOf("function RailStage({");
  expect(start).toBeGreaterThan(-1);
  const end = APP.indexOf("\nfunction SurfaceToggle(", start);
  expect(end).toBeGreaterThan(start);
  return APP.slice(start, end);
}

describe("the desktop rail keeps its way between Chat and Bots", () => {
  test("RailStage's SurfaceToggle mount is not guarded by selectedBotId", () => {
    const body = railStageBody();
    // The exact regression: a bot-selection guard wrapped around the rail's
    // own SurfaceToggle mount.
    expect(body).not.toMatch(/\{!selectedBotId\s*\?\s*\(\s*<SurfaceToggle/);
    expect(body).not.toContain("selectedBotId ? null :");
  });

  test("RailStage mounts its menu, which replaced the rail's switch bar", () => {
    // The Chat / Bots / Schedules switch moved into the rail's menu (see
    // SideNavPanel, render-tested in web/src/components/side-nav.test.tsx).
    // The rule above still holds for it: nothing about a selected bot may
    // take away the way back to Chat.
    const body = railStageBody();
    expect(body).toContain("<SideNavPanel");
    expect(body).not.toMatch(/selectedBotId[^\n]*<SideNavPanel/);
  });

  test("the shared toggle exposes Schedules as its third destination", () => {
    const toggle = APP.slice(APP.indexOf("function SurfaceToggle("), APP.indexOf("function MobileSurfaceDock("));
    expect(toggle).toContain('["auto", "Schedules", onOpenAuto]');
    expect(toggle).toContain("<CalendarClock");
  });

  test("the compact dock keeps touch-sized targets and a visible focus ring", () => {
    expect(CSS).toMatch(/\.lfg-surface-toggle--dock \.t-tab,[\s\S]*?height: 44px;/);
    expect(CSS).toMatch(/\.t-tab:focus-visible \{[\s\S]*?outline: 2px solid var\(--ring\);/);
  });
});
