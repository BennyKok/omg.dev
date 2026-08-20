import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const APP = readFileSync(new URL("../web/src/App.tsx", import.meta.url), "utf8");

const BOTS_VIEW = APP.slice(
  APP.indexOf("function BotsView("),
  APP.indexOf("function BotEditorPage("),
);
const railStart = APP.indexOf("const botRailList = (");
const railEnd = APP.indexOf("    </div>\n  );\n\n  return (\n    <div ref={workspaceRef}", railStart);
const BOT_RAIL = APP.slice(railStart, railEnd);
const PLACEHOLDER = APP.slice(
  APP.indexOf("function BotStagePlaceholder("),
  APP.indexOf("function BotsView("),
);
const ROSTER = BOTS_VIEW.slice(BOTS_VIEW.indexOf("return (\n    <div className=\"mx-auto"));

describe("bots roster copy", () => {
  test("drops the manifesto everywhere on the Bots surfaces", () => {
    expect(APP).not.toContain("persistent agent you talk to");
    expect(APP).not.toContain("Persistent agents you talk to");
    expect(APP).not.toContain("Give a persona a name");
    expect(APP).not.toContain("Say hi to get started.");
  });

  test("keeps one short empty-state line on each surface", () => {
    expect(ROSTER).toContain("No bots yet.");
    expect(ROSTER).not.toContain("Give a persona");
    expect(BOT_RAIL).toContain("No bots yet.");
    expect(BOT_RAIL).not.toContain("A bot is a persistent");
    expect(PLACEHOLDER).toContain("Pick one from the rail.");
    expect(PLACEHOLDER).not.toContain("A bot is a persistent");
  });

  test("the page header is Bots plus a New control", () => {
    expect(ROSTER).toContain(">Bots</h1>");
    expect(ROSTER).toContain('aria-label="New bot"');
    expect(ROSTER).toContain("\n          New\n");
    expect(ROSTER).not.toContain("<p className=\"text-sm text-muted-foreground\">");
  });
});

describe("bots roster preview wiring", () => {
  test("rail and page roster share the preview helper", () => {
    expect(BOT_RAIL).toContain("botRosterPreview(rawPreview, busy)");
    expect(ROSTER).toContain("botRosterPreview(rawPreview, working)");
    expect(BOT_RAIL).not.toContain("Say hi to get started.");
    expect(ROSTER).not.toContain("Say hi to get started.");
    expect(BOT_RAIL).not.toContain("Working…");
    expect(ROSTER).not.toContain("Working — ");
  });
});

describe("bots page roster chrome", () => {
  test("the mobile roster row has no trailing chevron", () => {
    expect(ROSTER).not.toContain("<ChevronRight");
  });

  test("the page roster is larger than the compact rail", () => {
    expect(ROSTER).toContain("text-[32px] font-bold");
    expect(ROSTER).toContain("size={56}");
    expect(ROSTER).toContain("text-base font-semibold");
    expect(ROSTER).toContain("text-sm");
    expect(ROSTER).toContain("text-xs tabular-nums");
    expect(ROSTER).toContain("isCodingAgentStoppedText(rawPreview)");
    expect(ROSTER).toContain("text-destructive");
    expect(ROSTER).not.toContain("size={44}");
    expect(ROSTER).not.toContain("text-[13px]");
    expect(BOT_RAIL).toContain("size={railCollapsed ? 24 : 28}");
    expect(BOT_RAIL).not.toContain("size={56}");
    expect(BOT_RAIL).not.toContain("text-[32px]");
  });

  test("create is a header New control, not a dashed row", () => {
    expect(ROSTER).toContain('aria-label="New bot"');
    expect(ROSTER).not.toContain("border-dashed");
    expect(ROSTER).not.toContain(">New bot<");
    expect(ROSTER).not.toContain("lfg-gborder--brand");
  });
});
