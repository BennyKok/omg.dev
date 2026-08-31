import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mount, type Mounted } from "../test-support/render";

globalThis.requestAnimationFrame = ((callback: FrameRequestCallback) => {
  callback(performance.now());
  return 1;
}) as typeof requestAnimationFrame;
globalThis.cancelAnimationFrame = (() => {}) as typeof cancelAnimationFrame;

const { ComputerInspectionControl } = await import("./computer-inspection-control");

let ui: Mounted;
beforeEach(() => {
  ui = mount();
});
afterEach(() => ui.cleanup());

const session = {
  sessionId: "11111111-1111-4111-8111-111111111111",
  title: "Checkout repair",
  project: "shop",
};

describe("session-bound Computer inspection control", () => {
  test("keeps the launching session visible without a target picker", () => {
    let started = 0;
    ui.render(
      <ComputerInspectionControl
        active={false}
        session={session}
        onStart={() => {
          started += 1;
        }}
        onCancel={() => {}}
      />,
    );

    const start = ui.query(
      '[aria-label="Select an element for Checkout repair"]',
    ) as HTMLButtonElement;
    expect(start.disabled).toBe(false);
    expect(start.textContent).toContain("Select element for");
    expect(start.textContent).toContain("Checkout repair");
    expect(ui.query('[aria-label*="Choose the agent"]')).toBeNull();
    ui.flush(() => start.click());
    expect(started).toBe(1);
  });

  test("shows the immutable target while preparing", () => {
    ui.render(
      <ComputerInspectionControl
        active={false}
        starting
        session={session}
        onStart={() => {}}
        onCancel={() => {}}
      />,
    );
    const button = ui.query(
      '[aria-label="Preparing element selection for Checkout repair"]',
    ) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(button.textContent).toContain("Preparing selection");
    expect(button.textContent).toContain("Checkout repair");
  });

  test("cancels the named session-bound selection", () => {
    let cancelled = 0;
    ui.render(
      <ComputerInspectionControl
        active
        session={session}
        onStart={() => {}}
        onCancel={() => {
          cancelled += 1;
        }}
      />,
    );
    const button = ui.query(
      '[aria-label="Cancel element selection for Checkout repair"]',
    ) as HTMLButtonElement;
    expect(button.textContent).toContain("Selecting for this session");
    expect(button.textContent).toContain("Checkout repair");
    ui.flush(() => button.click());
    expect(cancelled).toBe(1);
  });
});
