import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mount, type Mounted } from "../test-support/render";

const { ComputerInspectionControl } = await import("./computer-inspection-control");

let ui: Mounted;
beforeEach(() => {
  ui = mount();
});
afterEach(() => ui.cleanup());

const sessions = [
  {
    sessionId: "11111111-1111-4111-8111-111111111111",
    title: "Checkout repair",
    project: "shop",
  },
  {
    sessionId: "22222222-2222-4222-8222-222222222222",
    title: "Homepage polish",
    project: "portfolio",
  },
];

describe("Computer inspection control", () => {
  test("requires an explicit target session before starting", () => {
    ui.render(
      <ComputerInspectionControl
        active={false}
        sessions={sessions}
        onCancel={() => {}}
      />,
    );
    const start = ui.query('[aria-label="Choose an agent before pointing an element"]') as HTMLButtonElement;
    expect(start.disabled).toBe(true);
    expect(ui.query('[aria-label="Choose the agent for the selected element"]')).not.toBeNull();
  });

  test("starts for the named target without sending a message", () => {
    let started = 0;
    ui.render(
      <ComputerInspectionControl
        active={false}
        sessions={sessions}
        selectedSessionId={sessions[0]!.sessionId}
        onStart={() => {
          started += 1;
        }}
        onCancel={() => {}}
      />,
    );
    const start = ui.query(
      '[aria-label="Point an element for Checkout repair"]',
    ) as HTMLButtonElement;
    expect(start.disabled).toBe(false);
    expect(start.textContent).toContain("Point element");
    expect(start.textContent).toContain("Checkout repair");
    ui.flush(() => start.click());
    expect(started).toBe(1);
  });

  test("shows a non-interactive starting state", () => {
    ui.render(
      <ComputerInspectionControl
        active={false}
        starting
        sessions={sessions}
        selectedSessionId={sessions[0]!.sessionId}
        onCancel={() => {}}
      />,
    );
    const button = ui.query('[aria-label="Point an element for Checkout repair"]') as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(button.textContent).toContain("Starting");
  });

  test("shows one named cancel control while the person is selecting", () => {
    let cancelled = 0;
    ui.render(
      <ComputerInspectionControl
        active
        sessions={sessions}
        selectedSessionId={sessions[0]!.sessionId}
        onCancel={() => {
          cancelled += 1;
        }}
      />,
    );
    const button = ui.query('[aria-label="Cancel element inspection"]') as HTMLButtonElement;
    expect(button.textContent).toContain("Inspecting");
    expect(button.getAttribute("title")).toBe("Cancel element inspection");
    expect(ui.query('[aria-label="Choose the agent for the selected element"]')).toBeNull();
    ui.flush(() => button.click());
    expect(cancelled).toBe(1);
  });
});
