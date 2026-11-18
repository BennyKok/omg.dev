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
  test("marks leading /btw token and syncs scroll offset", () => {
    const text = "/btw what changed?\n";
    const segments = tokenizeComposerText(text);
    ui.render(
      <ComposerHighlightBackdrop
        segments={segments}
        value={text}
        scrollTop={24}
      />,
    );

    const mark = ui.query("mark");
    expect(mark).toBeTruthy();
    expect(mark!.textContent).toBe("/btw");
    const backdrop = ui.query("[data-composer-highlight-backdrop]");
    expect(backdrop).toBeTruthy();
    expect(backdrop!.textContent).toBe("/btw what changed?\n ");
  });
});
