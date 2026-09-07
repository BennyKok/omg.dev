import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mount, type Mounted } from "../test-support/render";
import { SessionComputerInspectionAction } from "./session-computer-inspection-action";

let ui: Mounted;
beforeEach(() => {
  ui = mount();
});
afterEach(() => ui.cleanup());

describe("session Computer inspection action", () => {
  test("opens Design Mode for exactly the session that owns the composer", () => {
    const opened: Array<[string, string | null]> = [];
    ui.render(
      <SessionComputerInspectionAction
        sessionId="target-session"
        sessionTitle="Checkout repair"
        pageUrl="https://example.test/checkout"
        onOpen={(sessionId, pageUrl) => opened.push([sessionId, pageUrl])}
      />,
    );

    const button = ui.query(
      '[aria-label="Select an element from Computer for Checkout repair"]',
    ) as HTMLButtonElement;
    expect(button.disabled).toBe(false);
    expect(button.className).toContain("size-10");
    ui.flush(() => button.click());
    expect(opened).toEqual([["target-session", "https://example.test/checkout"]]);
  });
});
