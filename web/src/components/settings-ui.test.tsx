import { afterEach, beforeEach, expect, test } from "bun:test";
import { mount, type Mounted } from "../test-support/render";
const { SettingsDisclosure, SettingsGroup, SettingsIcon, SettingsRow } = await import("./settings-ui");

let ui: Mounted;
beforeEach(() => {
  ui = mount();
});
afterEach(() => ui.cleanup());

test("a group shows its label, one card, and the note under the card", () => {
  ui.render(
    <SettingsGroup label="Computer" footer="A note.">
      <SettingsRow title="One" />
      <SettingsRow title="Two" />
    </SettingsGroup>,
  );
  const section = ui.query("section") as HTMLElement;
  const [label, card, note] = Array.from(section.children) as HTMLElement[];
  expect(label.textContent).toBe("Computer");
  expect(card.textContent).toBe("OneTwo");
  // The note is a sibling of the card, never inside it.
  expect(note.textContent).toBe("A note.");
});

test("a row with onClick is one button that calls it", () => {
  let clicks = 0;
  ui.render(
    <SettingsRow
      onClick={() => clicks++}
      icon={<SettingsIcon><svg /></SettingsIcon>}
      title="Coding agents"
      description="3 ready"
    />,
  );
  const buttons = ui.queryAll("button");
  expect(buttons.length).toBe(1);
  expect(buttons[0].textContent).toContain("Coding agents");
  expect(buttons[0].textContent).toContain("3 ready");
  ui.flush(() => (buttons[0] as HTMLElement).click());
  expect(clicks).toBe(1);
});

test("a row without onClick is not a button and keeps its trailing control", () => {
  ui.render(<SettingsRow title="Fast mode" trailing={<input aria-label="switch" />} />);
  expect(ui.queryAll("button").length).toBe(0);
  expect(ui.query('input[aria-label="switch"]')).not.toBeNull();
});

test("a disclosure hides its groups until the label is clicked", () => {
  ui.render(
    <SettingsDisclosure label="Advanced">
      <SettingsGroup label="Agent capacity">
        <SettingsRow title="Agent limit" />
      </SettingsGroup>
    </SettingsDisclosure>,
  );
  const toggle = ui.query('button[aria-expanded]') as HTMLElement;
  expect(toggle.getAttribute("aria-expanded")).toBe("false");
  expect(ui.text()).not.toContain("Agent limit");
  ui.flush(() => toggle.click());
  expect(toggle.getAttribute("aria-expanded")).toBe("true");
  expect(ui.text()).toContain("Agent limit");
});
