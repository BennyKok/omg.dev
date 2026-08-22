import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const app = readFileSync("web/src/App.tsx", "utf8");
const updateDrawer = readFileSync("web/src/components/update-drawer.tsx", "utf8");

function componentBody(name: string, source = app): string {
  const start = source.indexOf(`function ${name}(`);
  expect(start, `${name} was not found`).toBeGreaterThanOrEqual(0);
  const next = source.indexOf("\nfunction ", start + 1);
  return source.slice(start, next < 0 ? undefined : next);
}

describe("settings rendering", () => {
  // "Pause new agents" and "Archive idle agents" were removed entirely, not
  // just hidden (Benny: a soft off switch nobody can see is worse than no
  // switch), so the affordance this test used to pin no longer exists —
  // AgentConcurrencySettingsSection has neither a togglePause nor an
  // agentsPaused read to assert on.

  test("the updates row never reads install.channel without chaining through install", () => {
    const section = componentBody("UpdateProvider", updateDrawer);
    expect(section).toContain("info?.install?.channel");
    expect(section).not.toMatch(/info\?\.install\.channel/);
    expect(section).not.toMatch(/info\.install\.channel/);
  });

  test("mobile secondary chrome leaves clearance above page content", () => {
    // Anchor on the header's own explanatory comment rather than its full
    // className string: the comment identifies *which* header this is, and
    // the class-token checks below survive unrelated layout classes
    // (justify-between, gap-2, ordering) getting added around the padding
    // that actually creates the clearance.
    function headerTagAfter(comment: string): string {
      const commentIdx = app.indexOf(comment);
      expect(commentIdx, `comment "${comment}" not found`).toBeGreaterThanOrEqual(0);
      const tagStart = app.indexOf("<header", commentIdx);
      const tagEnd = app.indexOf(">", tagStart);
      expect(tagStart, `<header> after "${comment}" not found`).toBeGreaterThanOrEqual(0);
      return app.slice(tagStart, tagEnd);
    }

    const secondaryHeader = headerTagAfter("Secondary pages sit below Live in the mobile hierarchy");
    expect(secondaryHeader).toContain("pb-3");
    expect(secondaryHeader).toContain("pl-3");
    expect(secondaryHeader).toContain("pr-[calc(0.75rem+var(--lfg-host-top-inset))]");
    expect(secondaryHeader).toContain("pt-[calc(0.5rem+env(safe-area-inset-top))]");

    const pageHeader = headerTagAfter("Embedded used to be suppressed here too");
    expect(pageHeader).toContain("pb-3");
    expect(pageHeader).toContain("pt-[calc(0.5rem+env(safe-area-inset-top))]");
    expect(pageHeader).toContain("md:pb-1");
  });
});
