import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const app = readFileSync("web/src/App.tsx", "utf8");
const start = app.indexOf("// Swipe right anywhere on the chat to go back to the page under it");
const end = app.indexOf("// Escape-to-close, arrow-keys-to-switch", start);
const effect = app.slice(start, end);

// The chat page's swipe-back stuck mid-way: its touch listeners were attached
// in an effect keyed on `onClose`, which the parent passes as a new arrow on
// every render. A live session update landing mid-drag re-attached them with
// fresh state, so the release found "no drag" and the page stayed where the
// finger left it (reproduced on a phone viewport, 3 of 3 holds).
describe("chat swipe-back listeners", () => {
  test("survive re-renders: the effect does not depend on onClose", () => {
    expect(start).toBeGreaterThan(-1);
    expect(effect).toContain("const closeFromSwipe = useLatestCallback(onClose);");
    expect(effect).toContain("}, [closeFromSwipe]);");
    expect(effect).not.toContain("}, [onClose]);");
    expect(effect).not.toMatch(/\bonClose\(\)/);
  });

  test("a torn-down drag springs back instead of freezing", () => {
    expect(effect).toContain('if (st.active && st.intent === "back" && !closingRef.current) springBack();');
  });

  test("a cancelled touch never closes the page", () => {
    expect(effect).toContain('panel.addEventListener("touchcancel", onCancel');
    expect(effect).not.toContain('panel.addEventListener("touchcancel", onEnd');
  });
});
