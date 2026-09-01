// The confirm step is the whole point of this control: one stray click must
// not empty a findings backlog. These render the component and drive real DOM
// clicks rather than reading its source, per AGENTS.md.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import { mount, type Mounted } from "../test-support/render";

const { ClearFindingsButton } = await import("./clear-findings-button");

let ui: Mounted;
beforeEach(() => {
  ui = mount();
});
afterEach(() => ui.cleanup());

const button = () => ui.query("button") as HTMLElement | null;
const click = () => ui.flush(() => button()?.click());

describe("ClearFindingsButton", () => {
  test("the first click arms instead of clearing, and names the count it would clear", () => {
    let cleared = 0;
    ui.render(<ClearFindingsButton count={3} onClear={() => cleared++} />);
    expect(ui.text()).toContain("Clear all");
    expect(ui.text()).not.toContain("3");

    click();

    // Armed, not fired. The count moves into the label so the confirmation
    // states what it is about to do.
    expect(cleared).toBe(0);
    expect(ui.text()).toContain("Clear all 3?");
  });

  test("the second click clears once", () => {
    let cleared = 0;
    ui.render(<ClearFindingsButton count={3} onClear={() => cleared++} />);
    click();
    click();
    expect(cleared).toBe(1);
    // And it disarms, so a third click re-arms rather than clearing again.
    expect(ui.text()).toContain("Clear all");
    expect(ui.text()).not.toContain("Clear all 3?");
  });

  test("blurring disarms, so a primed button left behind cannot fire later", () => {
    let cleared = 0;
    ui.render(<ClearFindingsButton count={2} onClear={() => cleared++} />);
    click();
    expect(ui.text()).toContain("Clear all 2?");

    // React delegates onBlur from the bubbling "focusout" event, not the
    // non-bubbling native "blur" — dispatching the latter here would leave the
    // button armed and the test would pass on the substring alone.
    ui.flush(() => button()?.dispatchEvent(new Event("focusout", { bubbles: true })));
    expect(ui.text()).not.toContain("2?");

    // The next click only re-arms.
    click();
    expect(cleared).toBe(0);
    expect(ui.text()).toContain("Clear all 2?");
  });

  test("a feed that changes under a primed button disarms it — the old count must not answer for a new set", () => {
    let cleared = 0;
    ui.render(<ClearFindingsButton count={2} onClear={() => cleared++} />);
    click();
    expect(ui.text()).toContain("Clear all 2?");

    // A poll brings in a new finding while the button sits armed.
    ui.render(<ClearFindingsButton count={3} onClear={() => cleared++} />);
    expect(ui.text()).toContain("Clear all");
    expect(ui.text()).not.toContain("Clear all 2?");
    expect(cleared).toBe(0);
  });

  test("renders nothing when there is nothing to clear", () => {
    ui.render(<ClearFindingsButton count={0} onClear={() => {}} />);
    expect(button()).toBeNull();
  });

  test("while busy it says so and refuses further clicks", () => {
    let cleared = 0;
    ui.render(<ClearFindingsButton count={2} busy onClear={() => cleared++} />);
    expect(ui.text()).toContain("Clearing…");
    click();
    click();
    expect(cleared).toBe(0);
  });
});
