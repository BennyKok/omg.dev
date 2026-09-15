import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mount, type Mounted } from "../test-support/render";
import { classifySystemMessage } from "../lib/system-message";

const { SystemMessageLine } = await import("./system-message-line");

let ui: Mounted;
beforeEach(() => {
  ui = mount();
});
afterEach(() => ui.cleanup());

describe("SystemMessageLine", () => {
  test("a fork opener is a label, not the raw launch prompt", () => {
    const raw = [
      "You are starting a fresh agent session from an existing omg.dev session.",
      "",
      "Source session id: 542a7801-118e-4740-a8df-eb9b1ded1fd5",
      "Source title: Show coding agent icons",
      "",
      "User's extra prompt:",
      "Finish the picker.",
    ].join("\n");
    const system = classifySystemMessage(raw)!;
    ui.render(<SystemMessageLine system={system} raw={raw} />);
    expect(ui.text()).toContain("Started from Show coding agent icons");
    expect(ui.text()).toContain("542a7801");
    expect(ui.text()).toContain("Finish the picker.");
    expect(ui.text()).not.toContain("You are starting a fresh agent session");
  });

  test("clicking the line reveals the full body", async () => {
    const raw = "[Background task ios app · 542a7801]\n\nExact shipping tip is 0964f06ea.";
    const system = classifySystemMessage(raw)!;
    ui.render(<SystemMessageLine system={system} raw={raw} />);
    expect(ui.text()).toContain("ios app reported in");
    expect(ui.text()).not.toContain("[Background task");
    const open = ui.query("button[aria-expanded]") as HTMLButtonElement;
    expect(open.getAttribute("aria-expanded")).toBe("false");
    await ui.flushAsync(() => open.click());
    expect(open.getAttribute("aria-expanded")).toBe("true");
    expect(ui.text()).toContain("Exact shipping tip is 0964f06ea.");
  });
});
