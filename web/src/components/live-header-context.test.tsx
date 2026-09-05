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

test("connection status replaces the greeting and tapping retries until recovery", () => {
  let retries = 0;
  let notifications = 0;
  const props = { brand: <span>omg</span>, viewerName: "Benny", busyCount: 2, onOpenNotifications: () => notifications++ };
  const render = (status: "connecting" | "reconnecting" | "live", ready: boolean, error: string | null = null) => {
    ui.render(<RuntimeAvailabilityContext.Provider value={{ status, ready, error, loading: status === "connecting", retry: () => retries++ }}><AskProvider><LiveHeaderContext {...props} intro={status === "connecting"} /></AskProvider></RuntimeAvailabilityContext.Provider>);
  };
  render("connecting", false);
  const button = ui.query("button") as HTMLElement;
  expect(button.getAttribute("aria-label")).toBe("Connecting…");
  ui.flush(() => button.click());
  expect(retries).toBe(0);
  render("reconnecting", true);
  expect(ui.query("button")).toBe(button);
  expect(button.getAttribute("aria-label")).toBe("Reconnecting… Tap to retry");
  expect(ui.text()).not.toContain("Welcome");
  ui.flush(() => button.click());
  expect(retries).toBe(1);
  expect(notifications).toBe(0);
  render("live", false, "cloud_runtime_unavailable");
  expect(button.getAttribute("aria-label")).toBe("Connection unavailable Tap to retry");
  expect(ui.text()).not.toContain("cloud_runtime_unavailable");
  render("live", true);
  expect(button.getAttribute("aria-label")).toContain("Welcome, Benny");
  ui.flush(() => button.click());
  expect(notifications).toBe(1);
});
