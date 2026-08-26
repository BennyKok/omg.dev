// Source-level integration coverage follows the existing App.tsx regression
// tests: importing App mounts the full browser app, so the focused seam is its
// actual hook, touch-listener effect, and Settings switch wiring.

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const WEB = join(import.meta.dir, "..");
const APP = readFileSync(join(WEB, "src/App.tsx"), "utf8");

describe("swipe-between-chats device preference", () => {
  test("gates only the full-session horizontal swipe listener", () => {
    const sheet = APP.slice(
      APP.indexOf("function SessionTitleSheet("),
      APP.indexOf("function SessionCard(", APP.indexOf("function SessionTitleSheet(")),
    );
    expect(sheet).toContain("useNavigationPrefs()");
    expect(sheet).toContain("if (!navigationPrefs.swipeBetweenChats) return;");
    expect(sheet).toContain('body.addEventListener("touchmove", onMove, { passive: false })');
    expect(sheet).toContain("[go, navigationPrefs.swipeBetweenChats, prevSid, nextSid]");
  });

  test("exposes a browser-local Settings switch", () => {
    const more = APP.slice(APP.indexOf("function MoreView("), APP.indexOf("function UsageView("));
    expect(more).toContain("useNavigationPrefs()");
    expect(more).toContain("Swipe between chats");
    expect(more).toContain("checked={navigationPrefs.swipeBetweenChats}");
    expect(more).toContain("setNavigationPrefs({ swipeBetweenChats: v })");
    expect(more).toContain('aria-label="Toggle swipe between chats"');
  });
});
