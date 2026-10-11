import { afterEach, beforeEach, expect, test } from "bun:test";
import { mount, type Mounted } from "./test-support/render";
import { assistantMessageText, userMessageText } from "./lib/chat-message-presentation";
import * as mobile from "../../mobile/src/omg/chat-message-presentation";

const { MessageBubble } = await import("./App");
let ui: Mounted;
beforeEach(() => { ui = mount(); });
const clipboard = Object.getOwnPropertyDescriptor(navigator, "clipboard");
afterEach(() => {
  ui.cleanup();
  if (clipboard) Object.defineProperty(navigator, "clipboard", clipboard);
  else Reflect.deleteProperty(navigator, "clipboard");
});

const emptyReply = "OpenCode returned no assistant output for omg/openai/gpt-6-luna; check the OpenCode provider logs.";
const recovery = "The reply could not be completed. Please send your message again.";

for (const text of [emptyReply, "OpenCode turn failed for omg/model: Unauthorized"]) {
  test("saved provider failures render calm text, including when copied", async () => {
    let copied = "";
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: async (value: string) => { copied = value; } } });
    ui.render(<MessageBubble message={{ role: "assistant", kind: "text", text }} />);
    expect(ui.text()).toContain(recovery);
    expect(ui.text()).not.toContain("OpenCode");
    expect(ui.text()).not.toContain("Unauthorized");
    (ui.query('button[aria-label="Copy message"]') as HTMLButtonElement).click();
    await ui.flushAsync();
    expect(copied).toBe(recovery);
  });
}

test("Hi discards trailing whitespace and stale pre-rendered HTML", () => {
  ui.render(<MessageBubble message={{ role: "user", kind: "text", text: "Hi   \n\n", html: "Hi   <br><br>" }} />);
  expect(ui.query(".user-bubble-body")?.textContent).toBe("Hi");
  expect(ui.queryAll(".user-bubble-body br")).toHaveLength(0);
  expect(ui.queryAll('[role="status"]')).toHaveLength(0);
});

test("copying a trimmed user bubble keeps the original message", async () => {
  const text = "Hi   \n\n";
  let copied = "";
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: async (value: string) => { copied = value; } } });
  ui.render(<MessageBubble message={{ role: "user", kind: "text", text }} />);
  ui.flush(() => ui.query(".user-bubble-body")!.dispatchEvent(new window.MouseEvent("contextmenu", { bubbles: true, button: 2 })));
  await ui.flushAsync();
  const item = Array.from(document.querySelectorAll('[role="menuitem"]')).find(item => item.textContent?.includes("Copy message"));
  expect(item).toBeDefined();
  await ui.flushAsync(() => (item as HTMLElement).click());
  expect(copied).toBe(text);
});

test("trimming keeps internal newlines and safely escapes user markup", () => {
  ui.render(<MessageBubble message={{ role: "user", kind: "text", text: "First line\n<script>alert(1)</script>\n\n" }} />);
  expect(ui.queryAll(".user-bubble-body br")).toHaveLength(1);
  expect(ui.queryAll(".user-bubble-body script")).toHaveLength(0);
  expect(ui.text()).toContain("<script>alert(1)</script>");
});

test("attachments with no caption have no empty text bubble", () => {
  ui.render(<MessageBubble message={{ role: "user", kind: "text", text: "  \n\nAttached file:\n- notes.pdf: /home/dev/.cache/lfg/tmp/lfg-uploads/notes.pdf\n" }} />);
  expect(ui.text()).toContain("notes.pdf");
  expect(ui.queryAll(".user-bubble-body")).toHaveLength(0);
});

test("quoted diagnostics in a normal reply are preserved", () => {
  const text = `The log said: ${emptyReply}`;
  ui.render(<MessageBubble message={{ role: "assistant", kind: "text", text }} />);
  expect(ui.text()).toContain("OpenCode returned no assistant output");
  expect(ui.text()).not.toContain(recovery);
});

test("web and mobile presentation stay consistent", () => {
  for (const text of [emptyReply, "OpenCode turn failed for omg/model: no key", "Normal reply", `\`\`\`\n${emptyReply}\n\`\`\``, "Hi   \n\n", "  First\nSecond\n", "\n\n"]) {
    expect(assistantMessageText(text)).toBe(mobile.assistantMessageText(text));
    expect(userMessageText(text)).toBe(mobile.userMessageText(text));
  }
});
