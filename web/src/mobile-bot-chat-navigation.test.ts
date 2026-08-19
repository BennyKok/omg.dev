// Regression coverage for mobile bot chat navigation.
//
// History: the Chat/Bots switch was once rendered inside the open bot
// conversation, above the composer, and this file pinned that layout. An open
// conversation now owns its surface — the switch belongs to the roster and the
// list pages only — so the header Back button is the exit, and the switch's
// absence inside the conversation is pinned in
// test/bot-conversation-surface-toggle.test.ts.

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const APP = readFileSync(join(import.meta.dir, "App.tsx"), "utf8");
const BOTS_VIEW = APP.slice(APP.indexOf("function BotsView("));

describe("mobile bot chat navigation", () => {
  test("does not use the fixed composer-height dock inside a selected bot", () => {
    const selectedBotBranch = BOTS_VIEW.slice(0, BOTS_VIEW.indexOf("return (\n    <div className=\"mx-auto"));
    expect(selectedBotBranch).not.toContain("<MobileSurfaceDock");
    expect(selectedBotBranch).not.toContain("aboveComposer");
  });

  // The mobile chat is a full-screen portal over the app shell, so the shell's
  // own back affordance is not reachable. Without this control the bot chat had
  // no exit at all.
  test("gives the full-screen mobile chat its own way back to the roster", () => {
    const portal = BOTS_VIEW.slice(
      BOTS_VIEW.indexOf("if (isMobile) {"),
      BOTS_VIEW.indexOf("document.body,"),
    );
    expect(portal).toContain('aria-label="Back to bots"');
    expect(portal).toMatch(/onClick=\{onBack\}[\s\S]*?aria-label="Back to bots"/);
  });
});
