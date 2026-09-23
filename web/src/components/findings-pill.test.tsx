import { afterEach, beforeEach, expect, test } from "bun:test";
import { mount, type Mounted } from "../test-support/render";

const { FindingsPill, findingsLabel, findingsPillBottom } = await import("./findings-pill");

let ui: Mounted;
beforeEach(() => {
  ui = mount();
});
afterEach(() => ui.cleanup());

const pill = () => ui.query('[data-testid="findings-pill"]') as HTMLButtonElement | null;

test("the label is singular for one update", () => {
  expect(findingsLabel(1)).toBe("1 update");
  expect(findingsLabel(2)).toBe("2 updates");
  expect(findingsLabel(80)).toBe("80 updates");
});

test("nothing is drawn when nothing is open", () => {
  // The group this replaced followed the same rule. A pill reading
  // "0 updates" is a control that does nothing, permanently.
  ui.render(<FindingsPill count={0} onOpen={() => {}} aboveComposer />);
  expect(pill()).toBeNull();
});

test("the pill shows the count and opens", () => {
  let opened = 0;
  ui.render(<FindingsPill count={3} onOpen={() => (opened += 1)} aboveComposer />);
  expect(pill()?.textContent).toContain("3 updates");
  expect(pill()?.getAttribute("aria-label")).toBe("3 updates from auto agents. Open");
  ui.flush(() => pill()!.click());
  expect(opened).toBe(1);
});

test("it clears the composer when the composer is on screen, and the safe area when it is not", () => {
  // The pill floats OVER the list, so where it sits and how much room the
  // list leaves for it have to come from this one function.
  expect(findingsPillBottom(true)).toContain("--lfg-inline-composer-height");
  expect(findingsPillBottom(false)).toContain("--lfg-safe-bottom");
  for (const above of [true, false]) {
    expect(findingsPillBottom(above)).toContain("0.5rem");
  }
});
