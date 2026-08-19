// Regression coverage for the mobile bot switch. The switch must participate
// in the bot chat layout so it cannot float over transcript messages.

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const APP = readFileSync(join(import.meta.dir, "App.tsx"), "utf8");
const BOTS_VIEW = APP.slice(APP.indexOf("function BotsView("));

describe("mobile bot chat navigation", () => {
  test("renders the surface switch in normal layout flow", () => {
    expect(BOTS_VIEW).toContain('className="flex shrink-0 justify-center bg-background px-4 py-2"');
    expect(BOTS_VIEW).toContain("beforeComposer={mobileNavigation}");
  });

  test("does not use the fixed composer-height dock inside a selected bot", () => {
    const selectedBotBranch = BOTS_VIEW.slice(0, BOTS_VIEW.indexOf("return (\n    <div className=\"mx-auto"));
    expect(selectedBotBranch).not.toContain("<MobileSurfaceDock");
    expect(selectedBotBranch).not.toContain("aboveComposer");
  });

  test("keeps Chat active and returns to the Bots roster", () => {
    expect(BOTS_VIEW).toMatch(/const mobileNavigation[\s\S]*?active="sessions"[\s\S]*?onOpenBots=\{onBack\}/);
  });
});
