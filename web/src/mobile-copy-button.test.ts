// Regression coverage for keeping native text selection and whole-message copy
// as two separate actions on touch devices.
//
// App.tsx is a large, side-effect-bearing entry module (mounts the app on
// import in a browser context), so — following the same pattern already used
// in embedded-lib-smoke.release-check.ts for other App.tsx/CSS behavior that isn't
// cheap to render — this asserts against the source text rather than
// mounting the component tree.

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const WEB = join(import.meta.dir, "..");
const CSS = readFileSync(join(WEB, "src/index.css"), "utf8");
const APP = readFileSync(join(WEB, "src/App.tsx"), "utf8");

describe("mobile message copy button", () => {
  test("is hidden by default (revealed only on hover/focus, for pointer-precise devices)", () => {
    // The rule also turns pointer-events off now that the button is
    // positioned out of flow beside the bubble — see
    // message-copy-button-layout.test.ts. Match the opacity declaration
    // inside the rule rather than the whole rule body, so adding a
    // hidden-state property here is not a test failure.
    const rule = /\.message-copy-button\s*\{[^}]*\bopacity:\s*0;[^}]*\}/;
    expect(CSS).toMatch(rule);
  });

  test("is visible and tappable for a coarse pointer", () => {
    const coarseStart = CSS.indexOf(
      "@media (pointer: coarse) {",
      CSS.indexOf(".group\\/message:hover"),
    );
    const coarseEnd = CSS.indexOf("  .msg-text.markdown hr", coarseStart);
    expect(coarseStart).toBeGreaterThan(-1);
    expect(coarseEnd).toBeGreaterThan(coarseStart);
    const coarseBlock = CSS.slice(coarseStart, coarseEnd);
    expect(coarseBlock).toMatch(/\.message-copy-button\s*\{[^}]*opacity:\s*1;[^}]*pointer-events:\s*auto;/);
  });

  test("hover reveals only for a fine pointer, while keyboard focus works everywhere", () => {
    expect(CSS).toContain("@media (hover: hover) and (pointer: fine) {");
    expect(CSS).toContain(".group\\/message:hover .message-copy-button {");
    expect(CSS).toContain(".group\\/message:focus-within .message-copy-button {");
  });
});

describe("native mobile message selection", () => {
  const messageActions = APP.slice(
    APP.indexOf("function MessageActions("),
    APP.indexOf("// Memoized:", APP.indexOf("function MessageActions(")),
  );
  const coarseStart = CSS.indexOf(
    "@media (pointer: coarse) {",
    CSS.indexOf(".group\\/message:hover"),
  );
  const coarseEnd = CSS.indexOf("  .msg-text.markdown hr", coarseStart);
  const coarseBlock = CSS.slice(coarseStart, coarseEnd);

  test("does not suppress the native iOS callout or text selection", () => {
    expect(coarseBlock).not.toContain("-webkit-touch-callout: none");
    expect(coarseBlock).not.toContain("-webkit-user-select: none");
    expect(coarseBlock).not.toContain("user-select: none");
  });

  test("does not intercept long-press or replace it with a custom menu", () => {
    expect(APP).not.toContain("MESSAGE_LONG_PRESS_MS");
    expect(APP).not.toContain("TextSelect");
    expect(messageActions).not.toContain("MESSAGE_LONG_PRESS_MS");
    expect(messageActions).not.toContain("onPointerDown=");
    expect(messageActions).not.toContain("onContextMenu=");
    expect(messageActions).not.toContain("Select text");
    expect(messageActions).not.toContain("removeAllRanges");
  });

  test("tracks native selections so WebKit handles can escape message clipping", () => {
    // Subscribes to the SHARED document listener (lib/selection-change.ts)
    // rather than registering one per message. This asserted the inline
    // addEventListener call before that was lifted out, which made a pure
    // refactor look like a regression.
    expect(messageActions).toContain("return subscribeSelectionChange(onSelectionChange)");
    expect(messageActions).toContain("content.contains(selection.anchorNode) ||");
    expect(messageActions).toContain("content.contains(selection.focusNode)");
  });

  test("keeps whole-message copy as a separate button", () => {
    expect(messageActions).toContain("message-copy-button");
    expect(messageActions).toContain("onClick={() => void copy()}");
    expect(messageActions).toContain('aria-label={copied ? "Message copied" : "Copy message"}');
  });
});
