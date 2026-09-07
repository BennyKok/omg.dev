import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const APP = readFileSync(join(import.meta.dir, "App.tsx"), "utf8");
const SHEET = APP.slice(
  APP.indexOf("function SessionTitleSheet("),
  APP.indexOf("function SessionCard(", APP.indexOf("function SessionTitleSheet(")),
);

describe("mobile session sheet dismissal", () => {
  test("never turns a scroll starting in the session composer into sheet dismissal", () => {
    expect(SHEET).not.toContain("swipe up from the session composer to dismiss");
    expect(SHEET).not.toContain("finishDismiss");
    expect(SHEET).not.toMatch(/panel\.addEventListener\("touchstart"[\s\S]*?onClose\(\)/);
  });

  test("keeps explicit, unambiguous close controls", () => {
    expect(SHEET).toContain('aria-label="Close session details"');
    expect(SHEET).toContain("onClick={requestClose}");
    expect(SHEET).toContain('if (e.key === "Escape")');
  });
});
