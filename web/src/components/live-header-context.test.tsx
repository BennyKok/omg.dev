import { afterEach, beforeEach, expect, test } from "bun:test";
import { mount, type Mounted } from "../test-support/render";
const { LiveHeaderContext } = await import("./live-header-context");
const { AskProvider } = await import("./ask-center");
const originalFetch = globalThis.fetch;
let ui: Mounted;
beforeEach(() => { ui = mount(); globalThis.fetch = (async () => Response.json({ questions: [] })) as typeof fetch; });
afterEach(() => { ui.cleanup(); globalThis.fetch = originalFetch; });

test("keeps the same header control when loading ends and shows the known name", () => {
  const props = { brand: <span>omg</span>, viewerName: "Benny Kok", busyCount: 0, onOpenNotifications: () => {} };
  ui.render(<AskProvider><LiveHeaderContext {...props} intro /></AskProvider>);
  const button = ui.query("button");
  expect(button?.getAttribute("aria-label")).toBe("omg.dev");
  ui.render(<AskProvider><LiveHeaderContext {...props} intro={false} /></AskProvider>);
  expect(ui.query("button")).toBe(button);
  expect(button?.getAttribute("aria-label")).toBe("Welcome, Benny");
});

test("keeps the welcome readable without an identity and opens notifications", () => {
  let opened = 0;
  ui.render(<AskProvider><LiveHeaderContext brand={<span>omg</span>} intro={false} busyCount={0} onOpenNotifications={() => opened++} /></AskProvider>);
  expect(ui.query("button")?.getAttribute("aria-label")).toBe("Welcome");
  expect(ui.text()).not.toContain("Unassigned");
  ui.flush(() => (ui.query("button") as HTMLElement).click());
  expect(opened).toBe(1);
});
