import { afterEach, beforeEach, expect, test } from "bun:test";
import { mount, type Mounted } from "../test-support/render";
const { ComputerGroupSection } = await import("./computer-group");

let ui: Mounted;
beforeEach(() => { ui = mount(); });
afterEach(() => ui.cleanup());

test("an open computer shows its chats, and its line says what is working", () => {
  let toggles = 0;
  ui.render(
    <ComputerGroupSection id="p1" name="studio" local={false} chats={4} working={2} open onToggle={() => toggles++}>
      <div>Fix the landing page</div>
    </ComputerGroupSection>,
  );
  expect(ui.text()).toContain("studio");
  expect(ui.text()).toContain("Linked");
  expect(ui.text()).toContain("2 working");
  expect(ui.text()).toContain("Fix the landing page");
  const line = ui.query("button") as HTMLButtonElement;
  expect(line.getAttribute("aria-expanded")).toBe("true");
  ui.flush(() => line.click());
  expect(toggles).toBe(1);
});

test("a closed computer is one line with a chat count and none of its chats", () => {
  ui.render(
    <ComputerGroupSection id="local" name="This computer" local chats={1} working={0} open={false} onToggle={() => {}}>
      <div>Hidden chat</div>
    </ComputerGroupSection>,
  );
  expect(ui.text()).toContain("This computer");
  expect(ui.text()).toContain("1 chat");
  expect(ui.text()).not.toContain("Linked");
  expect(ui.text()).not.toContain("Hidden chat");
  expect(ui.query("button")?.getAttribute("aria-expanded")).toBe("false");
});
