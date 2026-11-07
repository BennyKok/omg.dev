// The harness proving itself, and the worked example the convention points at.
//
// The point is the contrast with source-text tests. They asked "does App.tsx
// contain this string"; this asks "does the user see the result".
import { afterEach, describe, expect, test } from "bun:test";
import { mount } from "./render";

const React = await import("react");
const { Spinner } = await import("../components/apps-home");

let ui: ReturnType<typeof mount> | null = null;
afterEach(() => {
  ui?.cleanup();
  ui = null;
});

describe("render harness", () => {
  test("mounts a component and exposes what reached the DOM", () => {
    ui = mount();
    ui.render(React.createElement(Spinner) as never);
    expect(ui.query('[role="status"]')?.getAttribute("aria-label")).toBe("Working");
  });

  test("re-rendering the same root replaces the tree instead of stacking it", () => {
    ui = mount();
    const el = (label: string) => React.createElement("p", null, label);
    ui.render(el("first") as never);
    expect(ui.text()).toContain("first");
    ui.render(el("second") as never);
    expect(ui.text()).toContain("second");
    expect(ui.text()).not.toContain("first");
  });

  test("flush wraps a state update so React commits before the assertion", () => {
    ui = mount();
    let bump: (() => void) | null = null;
    function Counter() {
      const [n, setN] = React.useState(0);
      bump = () => setN((v) => v + 1);
      return React.createElement("span", null, `n=${n}`);
    }
    ui.render(React.createElement(Counter) as never);
    expect(ui.text()).toBe("n=0");
    ui.flush(() => bump?.());
    expect(ui.text()).toBe("n=1");
  });

  test("cleanup is idempotent", () => {
    const local = mount();
    local.render(React.createElement("p", null, "x") as never);
    local.cleanup();
    expect(() => local.cleanup()).not.toThrow();
  });

  test("query and queryAll reach into the rendered tree", () => {
    ui = mount();
    ui.render(
      React.createElement(
        "ul",
        null,
        React.createElement("li", { className: "row" }, "a"),
        React.createElement("li", { className: "row" }, "b"),
      ) as never,
    );
    expect(ui.queryAll(".row").length).toBe(2);
    expect(ui.query(".row")?.textContent).toBe("a");
    expect(ui.query(".missing")).toBeNull();
  });
});
