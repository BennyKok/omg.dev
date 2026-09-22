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
    expect(ui.text()).toContain(starter.description);
  }
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
