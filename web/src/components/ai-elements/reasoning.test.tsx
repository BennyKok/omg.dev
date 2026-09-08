// The thinking row, rendered. It used to be checked by string-matching the
// component source, which could not tell the chevron's removal from a broken
// row; this mounts it and reads the DOM instead.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import { mount, type Mounted } from "../../test-support/render";

const { Reasoning, ReasoningTrigger, formatThinkingDuration } = await import("./reasoning");

let ui: Mounted;
beforeEach(() => {
  ui = mount();
});
afterEach(() => ui.cleanup());

describe("the thinking row", () => {
  test("is the words alone: no icon, no chevron", async () => {
    await ui.flushAsync(() => {
      ui.render(
        <Reasoning>
          <ReasoningTrigger />
        </Reasoning>,
      );
    });
    const trigger = ui.query("button");
    expect(trigger?.textContent).toBe("Thought");
    expect(trigger?.querySelector("svg")).toBeNull();
  });

  // Nothing upstream records how long a thinking block took, so a transcript
  // loaded already complete says plain "Thought" rather than inventing a
  // duration from a timestamp that is not a start.
  test("says Thinking… while streaming and counts once it has seen a second", async () => {
    await ui.flushAsync(() => {
      ui.render(
        <Reasoning>
          <ReasoningTrigger isStreaming />
        </Reasoning>,
      );
    });
    // The first tick lands on mount, and a block that is happening never
    // reads as zero seconds.
    expect(ui.query("button")?.textContent).toBe("Thinking… 1s");
    await ui.flushAsync(() => new Promise((resolve) => setTimeout(resolve, 2200)));
    expect(ui.query("button")?.textContent).toBe("Thinking… 2s");
  });
});

describe("formatThinkingDuration", () => {
  test("never reports zero for a block that did happen", () => {
    expect(formatThinkingDuration(0)).toBe("1s");
    expect(formatThinkingDuration(200)).toBe("1s");
  });

  test("reads in seconds under a minute", () => {
    expect(formatThinkingDuration(4_400)).toBe("4s");
    expect(formatThinkingDuration(59_000)).toBe("59s");
  });

  test("splits into minutes past that, and drops a zero remainder", () => {
    expect(formatThinkingDuration(60_000)).toBe("1m");
    expect(formatThinkingDuration(80_000)).toBe("1m 20s");
    expect(formatThinkingDuration(120_000)).toBe("2m");
  });
});
