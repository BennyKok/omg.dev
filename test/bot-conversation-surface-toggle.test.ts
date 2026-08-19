import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import {
  shouldShowInlineBotsSurfaceToggle,
  shouldShowMobileSurfaceToggle,
} from "../web/src/lib/mobile-bots-nav.ts";

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
  // The branch ends where the roster (non-selected) render begins.
  const end = APP.indexOf('\n    <div className="mx-auto flex max-w-3xl flex-col gap-2" data-lfg-page-column>', start);
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
  test("the app shell dock renders, guarded by the helper alone", () => {
    expect(APP).toContain("{shouldShowMobileSurfaceToggle(isMobile, tab, selectedBotId) ? (");
    expect(APP).toContain("<MobileSurfaceDock");
    // The guard lives in the helper; no second inline copy to drift out of sync.
    expect(APP).not.toContain('&& !(tab === "bots" && selectedBotId)');
  });

  test("the helper shows the switch on the lists and hides it in a conversation", () => {
    expect(shouldShowMobileSurfaceToggle(true, "live")).toBe(true);
    expect(shouldShowMobileSurfaceToggle(true, "bots")).toBe(true);
    expect(shouldShowMobileSurfaceToggle(true, "bots", "bot_scout")).toBe(false);
    // A bot open while the user is on Live must not resurrect the dock's twin.
    expect(shouldShowMobileSurfaceToggle(false, "bots")).toBe(false);
  });

  test("the inline roster toggle stays tablet-only so mobile shows exactly one", () => {
    expect(shouldShowInlineBotsSurfaceToggle(true)).toBe(false);
    expect(shouldShowInlineBotsSurfaceToggle(false)).toBe(true);
  });
});
