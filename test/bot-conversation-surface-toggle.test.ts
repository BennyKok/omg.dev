import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import { shouldShowInlineBotsSurfaceToggle } from "../web/src/lib/mobile-bots-nav.ts";

const APP = readFileSync(new URL("../web/src/App.tsx", import.meta.url), "utf8");

/**
 * There are two distinct Chat/Bots switch sites, and they are not
 * interchangeable:
 *
 *  1. the app shell's `MobileSurfaceDock`, which belongs to the Live and Bots
 *     *list* pages, and
 *  2. a conversation-level switch `BotsView` used to hand `SessionChat` as
 *     `beforeComposer`, which put the switch inside an open bot conversation.
 *
 * Guarding (1) never affected (2), so the switch kept appearing above the
 * composer in an open mobile bot conversation even though the shell guard was
 * correct. These tests pin both halves separately.
 */

/** The open-conversation branch of `BotsView` (`if (bot) { … }`). */
function openBotConversationBranch(): string {
  const view = APP.indexOf("function BotsView({");
  expect(view).toBeGreaterThan(-1);
  const start = APP.indexOf("\n  if (bot) {", view);
  expect(start).toBeGreaterThan(-1);
  // The branch ends where the roster (non-selected) render begins. Anchor on
  // the page-column shell only, not on its spacing utilities: the roster's gap
  // is a design value that moves, and pinning it here made a padding tweak
  // look like a SurfaceToggle regression.
  const end = APP.indexOf('\n    <div className="mx-auto flex max-w-3xl', start);
  expect(end).toBeGreaterThan(start);
  return APP.slice(start, end);
}

describe("the Chat/Bots switch stays out of an open bot conversation", () => {
  test("the open-conversation branch renders no SurfaceToggle at all", () => {
    const branch = openBotConversationBranch();
    expect(branch).not.toContain("<SurfaceToggle");
    expect(branch).not.toContain("MobileSurfaceDock");
  });

  test("no switch is passed to the bot chat as beforeComposer", () => {
    const branch = openBotConversationBranch();
    expect(branch).not.toMatch(/beforeComposer=\{(?!undefined)/);
    // The removed site was built as a `mobileNavigation` node; keep the name retired.
    expect(APP).not.toContain("mobileNavigation");
  });

  test("the open conversation still has a Back button as its exit", () => {
    const branch = openBotConversationBranch();
    expect(branch).toContain('aria-label="Back to bots"');
  });
});

describe("the list surfaces keep their switch", () => {
  test("the app shell mounts the side navigation that replaced the dock", () => {
    // The dock is gone. Its three surfaces are rows in the side navigation,
    // which is an overlay and so never has to be hidden inside a bot chat.
    expect(APP).toContain("<SideNavDrawer");
    expect(APP).not.toContain("<MobileSurfaceDock");
    // No inline copy of a visibility guard to drift out of sync.
    expect(APP).not.toContain('&& !(tab === "bots" && selectedBotId)');
  });

  // The helper this used to exercise (shouldShowMobileSurfaceToggle) went
  // with the dock. The side navigation is an overlay, so it has no
  // equivalent rule: it is never hidden by an open bot conversation because
  // it is never in the way of one. What replaced this coverage is
  // web/src/lib/side-nav-items.test.ts.

  test("the inline roster toggle stays tablet-only so mobile shows exactly one", () => {
    expect(shouldShowInlineBotsSurfaceToggle(true)).toBe(false);
    expect(shouldShowInlineBotsSurfaceToggle(false)).toBe(true);
  });
});
