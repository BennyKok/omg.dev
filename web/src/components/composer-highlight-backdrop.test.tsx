import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mount, type Mounted } from "../test-support/render";
import { tokenizeComposerText } from "../lib/composer-highlight";

const { ComposerHighlightBackdrop } = await import("./composer-highlight-backdrop");

let ui: Mounted;
beforeEach(() => {
  ui = mount();
});
afterEach(() => {
  ui.cleanup();
});

describe("ComposerHighlightBackdrop", () => {
  test("marks command and mention tokens as pills and preserves exact text", () => {
    const text = "/btw ask @reviewer what changed?\n";
    const segments = tokenizeComposerText(text);
    ui.render(
      <ComposerHighlightBackdrop
        segments={segments}
        value={text}
        scrollTop={24}
      />,
    );

    const marks = ui.queryAll("mark");
    expect(marks.length).toBe(2);
    expect(marks[0]!.textContent).toBe("/btw");
    expect(marks[1]!.textContent).toBe("@reviewer");
    const backdrop = ui.query("[data-composer-highlight-backdrop]");
    expect(backdrop).toBeTruthy();
    expect(backdrop!.textContent).toBe("/btw ask @reviewer what changed?\n ");
  });
});
