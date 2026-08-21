// Render-level guard for the hosted getting-started panel. The bug this whole
// change fixes was a surface that never rendered, so a state-only test would
// not have caught it: these assertions are about what reaches the DOM.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Window } from "happy-dom";

const window = new Window({ url: "https://app.omg.dev/" });
Object.assign(globalThis, {
  window,
  document: window.document,
  navigator: window.navigator,
  HTMLElement: window.HTMLElement,
  Element: window.Element,
  Node: window.Node,
  getComputedStyle: window.getComputedStyle.bind(window),
  IS_REACT_ACT_ENVIRONMENT: true,
});

const { createRoot } = await import("react-dom/client");
const { act } = await import("react");
const { HostedCoachCard } = await import("./hosted-coach-card");
const { hostedCoachSteps } = await import("../lib/hosted-coach");

let host: HTMLElement;
let root: ReturnType<typeof createRoot>;

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

const render = (ui: React.ReactElement) => act(() => root.render(ui));

describe("HostedCoachCard", () => {
  test("a fresh hosted box is told both things it can do", () => {
    render(
      <HostedCoachCard
        steps={hostedCoachSteps({ coach: null, sessionCount: 0, autoAgentCount: 0 })}
        onStep={() => {}}
        onDismiss={() => {}}
      />,
    );
    const text = host.textContent ?? "";
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
    const buttons = [...host.querySelectorAll("ol button")] as HTMLButtonElement[];
    act(() => buttons[1]!.click());
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
    expect(host.textContent).toContain("1 of 2 done");
    const buttons = [...host.querySelectorAll("ol button")] as HTMLButtonElement[];
    expect(buttons[0]!.disabled).toBe(true);
    act(() => buttons[0]!.click());
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
    const button = host.querySelector(
      '[aria-label="Dismiss getting started"]',
    ) as HTMLButtonElement | null;
    expect(button).not.toBeNull();
    act(() => button!.click());
    expect(dismissed).toBe(1);
  });
});
