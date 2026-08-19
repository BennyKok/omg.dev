// Regression coverage for hiding the always-visible per-message copy button
// on mobile while keeping the long-press copy gesture and the desktop button.
//
// App.tsx is a large, side-effect-bearing entry module (mounts the app on
// import in a browser context), so — following the same pattern already used
// in embedded-lib-smoke.test.ts for other App.tsx/CSS behavior that isn't
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
    const rule = /\.message-copy-button\s*\{\s*opacity:\s*0;\s*\}/;
    expect(CSS).toMatch(rule);
  });

  test("the pointer-coarse (touch) media block no longer forces the button visible", () => {
    const coarseBlockMatch = /@media \(pointer: coarse\) \{([\s\S]*?)\n  \}/.exec(CSS);
    expect(coarseBlockMatch).not.toBeNull();
    const coarseBlock = coarseBlockMatch![1];
    // This is exactly the regression this test guards: touch devices used to
    // get `.message-copy-button { opacity: 1; }` here, duplicating the
    // long-press gesture with an always-visible button on every bubble.
    expect(coarseBlock).not.toContain(".message-copy-button");
  });

  test("hover/focus-within still reveals the button for mouse and keyboard users", () => {
    expect(CSS).toContain(".group\\/message:hover .message-copy-button,");
    expect(CSS).toContain(".group\\/message:focus-within .message-copy-button {");
  });
});

describe("mobile long-press copy gesture (App.tsx MessageActions)", () => {
  test("long-press is still wired up for touch/pen pointers", () => {
    expect(APP).toContain('event.pointerType !== "touch" && event.pointerType !== "pen"');
    expect(APP).toMatch(/MESSAGE_LONG_PRESS_MS\s*=\s*\d+/);
  });

  test("the long-press action menu still offers Copy", () => {
    const menuSection = APP.slice(APP.indexOf("Message actions"));
    expect(menuSection.slice(0, 800)).toContain("Copy");
  });

  test("the visible (desktop) copy button and its copied/uncopied labels are still rendered", () => {
    expect(APP).toContain("message-copy-button");
    expect(APP).toContain('aria-label={copied ? "Message copied" : "Copy message"}');
  });
});
