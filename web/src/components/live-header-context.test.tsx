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

const { RuntimeAvailabilityContext } = await import("../lib/runtime-availability");

test("connection state never replaces the greeting; the overlay owns it", () => {
  let notifications = 0;
  const props = { brand: <span>omg</span>, viewerName: "Benny", busyCount: 0, onOpenNotifications: () => notifications++ };
  const states = [
    { status: "reconnecting", ready: true, error: null, loading: false },
    { status: "offline", ready: true, error: null, loading: false },
    { status: "live", ready: false, error: "cloud_runtime_unavailable", loading: false },
    { status: "connecting", ready: false, error: null, loading: true, lifecycle: "waking" },
  ] as const;
  for (const state of states) {
    ui.render(<RuntimeAvailabilityContext.Provider value={{ ...state, retry: () => {} }}><AskProvider><LiveHeaderContext {...props} intro={false} /></AskProvider></RuntimeAvailabilityContext.Provider>);
    expect(ui.text()).toContain("Welcome, Benny");
    expect(ui.text()).not.toMatch(/Reconnecting|Connecting|unavailable|Waking/);
  }
  ui.flush(() => (ui.query("button") as HTMLElement).click());
  expect(notifications).toBe(1);
});
