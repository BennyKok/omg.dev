import { afterEach, beforeEach, expect, test } from "bun:test";
import { mount, type Mounted } from "../test-support/render";
const { AutoAgentPage } = await import("./auto-agent-page");
let ui: Mounted;
beforeEach(() => { ui = mount(); });
afterEach(() => ui.cleanup());

test("Back closes the page and footer actions remain available", async () => {
  let closed = 0;
  let saved = 0;
  ui.render(
    <AutoAgentPage title="Edit auto agent" onClose={() => closed++}
      footer={<button onClick={() => saved++}>Save</button>}>
      <textarea aria-label="Prompt" defaultValue="Keep my draft" />
    </AutoAgentPage>,
  );
  await ui.flushAsync();
  const page = document.querySelector('[role="dialog"]')!;
  expect(page.textContent).toContain("Edit auto agent");
  ui.flush(() => (page.querySelector("footer button") as HTMLElement).click());
  expect(saved).toBe(1);
  expect(closed).toBe(0);
  ui.flush(() => (page.querySelector('[aria-label="Back"]') as HTMLElement).click());
  expect(closed).toBe(1);
});

test("focus and blur retain the page and draft without opening the keyboard on mount", async () => {
  ui.render(<AutoAgentPage title="Report" onClose={() => {}}>
    <textarea aria-label="Reply" defaultValue="Draft reply" />
  </AutoAgentPage>);
  await ui.flushAsync();
  const input = document.querySelector("textarea")!;
  expect(document.activeElement).not.toBe(input);
  ui.flush(() => input.focus());
  ui.flush(() => input.blur());
  expect(document.querySelector('[role="dialog"]')).not.toBeNull();
  expect(input.value).toBe("Draft reply");
});
