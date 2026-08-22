import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const APP = readFileSync(new URL("../web/src/App.tsx", import.meta.url), "utf8");

const BOTS_VIEW = APP.slice(
  APP.indexOf("function BotsView("),
  APP.indexOf("function BotEditorPage("),
);
const railStart = APP.indexOf("const botRailList = (");
const railEnd = APP.indexOf("    </RailGroup>\n  );\n\n  return (\n    <div ref={workspaceRef}", railStart);
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

  // The page had a 32px "Bots" heading under a switch bar that already said
  // Bots, and a "New" control in that heading. The heading said it twice and
  // pushed the first row off the fold; creating is the first row of the list
  // now, the way the desktop rail does it.
  test("the roster has no page heading, and creating is its first row", () => {
    expect(ROSTER).not.toContain(">Bots</h1>");
    expect(ROSTER).not.toContain("text-[32px] font-bold");
    expect(ROSTER).toContain('aria-label="New bot"');
    expect(ROSTER).toContain(">New bot</span>");
    // Same row treatment as the bots it sits above, not a bespoke banner.
    expect(ROSTER).toContain("cn(BOT_ROSTER_ROW_CLASS");
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

  test("page and rail rosters render the same row", () => {
    // 44px, not 56px: that size (paired with the mockup's padding) made the
    // row pitch 84px, which read as a settings list on a phone rather than a
    // scannable roster. See mobile-bots-nav.ts.
    expect(ROSTER).toContain("size={44}");
    expect(ROSTER).toContain("text-base font-semibold");
    expect(ROSTER).toContain("text-sm");
    expect(ROSTER).toContain("text-xs tabular-nums");
    expect(ROSTER).toContain("isCodingAgentStoppedText(rawPreview)");
    expect(ROSTER).toContain("text-destructive");
    expect(ROSTER).not.toContain("size={56}");
    expect(ROSTER).not.toContain("text-[13px]");
    // The rail roster used to run at 24/28px — the session rows' density,
    // which turned the creature into a bullet point and clipped the preview
    // after a few words. A bot row is the same object on both surfaces, so it
    // is the same row: the page's 44px face, and 32px when the rail collapses
    // to 56px and the face IS the row.
    expect(BOT_RAIL).toContain("size={railCollapsed ? 32 : 44}");
    expect(BOT_RAIL).not.toContain("size={railCollapsed ? 24 : 28}");
    expect(BOT_RAIL).not.toContain("size={56}");
  });

  test("the rail roster is labelled like every other rail list", () => {
    // Small-caps category header with a count, the same one the Chat rail puts
    // over Working and Idle. The switch bar says which surface you are on; the
    // header says what the list is and how many.
    expect(BOT_RAIL).toContain('<RailGroup label="Bots" count={botRailRows.length}');
  });

  test("rail rows are a fixed height so a late preview cannot resize them", () => {
    // The preview line arrives after the row does. Sized to its own text, the
    // row grew under the cursor and shoved every row below it.
    expect(BOT_RAIL).toContain("h-[3.75rem]");
    expect(BOT_RAIL).not.toContain("py-1.5");
  });

  // This deliberately reverses an earlier decision. Creating used to be a
  // "New" control in the page header specifically so it was NOT a dashed row.
  // The page header is gone — the switch bar above already names the surface —
  // and with it went the only place that control could live. The dashed row is
  // what the desktop rail has always used, so the two rosters now agree.
  test("create is the list's first row, in the list's own row style", () => {
    expect(ROSTER).toContain('aria-label="New bot"');
    expect(ROSTER).toContain("border-dashed");
    expect(ROSTER).toContain(">New bot</span>");
    // Never the brand-gradient treatment: it is a row, not a call to action.
    expect(ROSTER).not.toContain("lfg-gborder--brand");
  });
});
