import { afterEach, beforeEach, expect, test } from "bun:test";
import { mount, type Mounted } from "../test-support/render";

const { FindingToastCard } = await import("./finding-toast-card");

let ui: Mounted;
beforeEach(() => {
  ui = mount();
});
afterEach(() => ui.cleanup());

test("names the agent and the finding, and View opens it", () => {
  let opened = 0;
  ui.render(<FindingToastCard agentName="house-computer-e2e" title="House Computer e2e FAILED" onOpen={() => opened++} />);
  expect(ui.text()).toContain("house-computer-e2e responded");
  expect(ui.text()).toContain("House Computer e2e FAILED");
  ui.flush(() => (ui.query("button") as HTMLButtonElement).click());
  expect(opened).toBe(1);
});
