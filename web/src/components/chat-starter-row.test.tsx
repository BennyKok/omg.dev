import { beforeEach, afterEach, expect, test } from "bun:test";
import { mount, type Mounted } from "../test-support/render";
import { CHAT_STARTERS } from "../../../packages/protocol/src/chat-starters";

const { ChatStarterRow } = await import("./chat-starter-row");

let ui: Mounted;
beforeEach(() => {
  ui = mount();
});
afterEach(() => ui.cleanup());

test("offers every shared starter", () => {
  ui.render(<ChatStarterRow onStart={() => {}} />);
  for (const starter of CHAT_STARTERS) {
    expect(ui.query(`[data-testid="chat-starter-${starter.id}"]`)).not.toBeNull();
    expect(ui.text()).toContain(starter.label);
    // A pill shows the label; the description is its name and tooltip.
    const pill = ui.query(`[data-testid="chat-starter-${starter.id}"]`)!;
    expect(pill.getAttribute("aria-label")).toContain(starter.description);
    expect(pill.getAttribute("title")).toBe(starter.description);
  }
});

test("each starter wears its own icon colour", () => {
  ui.render(<ChatStarterRow onStart={() => {}} />);
  const tints = CHAT_STARTERS.map(
    (starter) => ui.query(`[data-testid="chat-starter-${starter.id}"] svg`)?.getAttribute("class") ?? "",
  );
  expect(new Set(tints).size).toBe(CHAT_STARTERS.length);
  expect(tints.some((cls) => cls.includes("text-primary"))).toBe(false);
});

test("a row with nothing to scroll has no faded edge", () => {
  ui.render(<ChatStarterRow onStart={() => {}} />);
  const row = ui.query<HTMLElement>('[data-testid="chat-starter-row"]')!;
  expect(row.dataset.fadeLeft).toBeUndefined();
  expect(row.dataset.fadeRight).toBeUndefined();
  expect(row.getAttribute("style")).toBeNull();
});

test("a tap sends that starter's prompt, not its label", () => {
  const sent: string[] = [];
  ui.render(<ChatStarterRow onStart={(prompt) => sent.push(prompt)} />);
  ui.query<HTMLButtonElement>('[data-testid="chat-starter-website"]')?.click();
  expect(sent).toEqual(["Help me create a website."]);
});

test("every starter is disabled while a session is being created", () => {
  const sent: string[] = [];
  ui.render(<ChatStarterRow disabled onStart={(prompt) => sent.push(prompt)} />);
  ui.query<HTMLButtonElement>('[data-testid="chat-starter-app"]')?.click();
  expect(sent).toEqual([]);
});
