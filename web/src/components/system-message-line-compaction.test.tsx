import { afterEach, beforeEach, expect, test } from "bun:test";
import { mount, type Mounted } from "../test-support/render";
import { classifyUserTurn } from "../lib/system-message";

const { SystemMessageLine } = await import("./system-message-line");

let ui: Mounted;
beforeEach(() => {
  ui = mount();
});
afterEach(() => ui.cleanup());

const raw =
  "This session is being continued from a previous conversation that ran out of context. The summary below covers the earlier portion of the conversation.\n\nSummary:\n1. Primary Request and Intent: ship City Pop.";

test("a compaction draws one line, with the summary behind a tap", () => {
  ui.render(<SystemMessageLine system={classifyUserTurn(raw)!} raw={raw} />);
  expect(ui.text()).toContain("Conversation compacted");
  // No two-line preview of a summary written for the model.
  expect(ui.text()).not.toContain("Primary Request");

  ui.flush(() => (ui.query("button") as HTMLButtonElement).click());
  expect(ui.text()).toContain("Primary Request and Intent: ship City Pop.");
});
