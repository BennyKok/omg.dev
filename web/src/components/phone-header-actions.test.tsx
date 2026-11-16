import { afterEach, beforeEach, expect, test } from "bun:test";
import { mount, type Mounted } from "../test-support/render";
const { PhoneHeaderActions, PhoneHeaderSlotContext } = await import("./phone-header-actions");

let ui: Mounted;
beforeEach(() => { ui = mount(); });
afterEach(() => ui.cleanup());

test("off a phone the actions stay where the page put them", () => {
  ui.render(
    <div data-testid="page">
      <PhoneHeaderActions><button type="button">New</button></PhoneHeaderActions>
    </div>,
  );
  expect(ui.query('[data-testid="page"] button')?.textContent).toBe("New");
});

test("on a phone the actions are drawn in the header slot, and still work", () => {
  const slot = document.createElement("div");
  document.body.appendChild(slot);
  let taps = 0;
  try {
    ui.render(
      <PhoneHeaderSlotContext.Provider value={slot}>
        <div data-testid="page">
          <PhoneHeaderActions><button type="button" onClick={() => taps++}>New</button></PhoneHeaderActions>
        </div>
      </PhoneHeaderSlotContext.Provider>,
    );
    expect(ui.query('[data-testid="page"] button')).toBeNull();
    const moved = slot.querySelector("button") as HTMLButtonElement;
    expect(moved.textContent).toBe("New");
    ui.flush(() => moved.click());
    expect(taps).toBe(1);
  } finally {
    ui.render(<div />);
    slot.remove();
  }
});
