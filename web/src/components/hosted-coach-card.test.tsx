// Render-level guard for the hosted getting-started panel. The bug this whole
// change fixes was a surface that never rendered, so a state-only test would
// not have caught it: these assertions are about what reaches the DOM.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
// Shared DOM + React setup. Must come before importing the component, so the
// globals exist by the time react-dom binds to them: see test-support/render.
import { mount, type Mounted } from "../test-support/render";

const { HostedCoachCard } = await import("./hosted-coach-card");
const { hostedCoachSteps } = await import("../lib/hosted-coach");

let ui: Mounted;
beforeEach(() => {
  ui = mount();
});
afterEach(() => ui.cleanup());

const render = (el: React.ReactElement) => ui.render(el);

describe("HostedCoachCard", () => {
  test("a fresh hosted box is told both things it can do", () => {
    render(
      <HostedCoachCard
        steps={hostedCoachSteps({ coach: null, sessionCount: 0, autoAgentCount: 0 })}
        onStep={() => {}}
        onDismiss={() => {}}
      />,
    );
    const text = ui.text() ?? "";
    expect(text).toContain("Getting started");
    expect(text).toContain("Start your first session");
    expect(text).toContain("Put an agent on a schedule");
    expect(text).toContain("0 of 2 done");
  });

  test("clicking an open step runs it", () => {
    const clicked: string[] = [];
    render(
      <HostedCoachCard
        steps={hostedCoachSteps({ coach: null, sessionCount: 0, autoAgentCount: 0 })}
        onStep={(key) => clicked.push(key)}
        onDismiss={() => {}}
      />,
    );
    const buttons = [...ui.host.querySelectorAll("ol button")] as HTMLButtonElement[];
    ui.flush(() => buttons[1]!.click());
    expect(clicked).toEqual(["schedule"]);
  });

  // A finished step is the record of what you did, not an offer to redo it.
  test("a finished step is not clickable and counts toward progress", () => {
    const clicked: string[] = [];
    render(
      <HostedCoachCard
        steps={hostedCoachSteps({ coach: null, sessionCount: 1, autoAgentCount: 0 })}
        onStep={(key) => clicked.push(key)}
        onDismiss={() => {}}
      />,
    );
    expect(ui.text()).toContain("1 of 2 done");
    const buttons = [...ui.host.querySelectorAll("ol button")] as HTMLButtonElement[];
    expect(buttons[0]!.disabled).toBe(true);
    ui.flush(() => buttons[0]!.click());
    expect(clicked).toEqual([]);
  });

  test("dismiss is reachable as its own control", () => {
    let dismissed = 0;
    render(
      <HostedCoachCard
        steps={hostedCoachSteps({ coach: null, sessionCount: 0, autoAgentCount: 0 })}
        onStep={() => {}}
        onDismiss={() => {
          dismissed += 1;
        }}
      />,
    );
    const button = ui.host.querySelector(
      '[aria-label="Dismiss getting started"]',
    ) as HTMLButtonElement | null;
    expect(button).not.toBeNull();
    ui.flush(() => button!.click());
    expect(dismissed).toBe(1);
  });
});
