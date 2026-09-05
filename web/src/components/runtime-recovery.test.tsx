import { afterEach, beforeEach, expect, test } from "bun:test";
import { mount, type Mounted } from "../test-support/render";
const { RuntimeAvailabilityContext } = await import("../lib/runtime-availability");
const { RuntimeRecovery, RuntimeEmptyState, ComposerConnectionHint } = await import("./runtime-recovery");
let ui: Mounted;
beforeEach(() => { ui = mount(); });
afterEach(() => ui.cleanup());

test("unavailable runtime explains the failure, offers retry, and does not claim no sessions", () => {
  let retries = 0;
  ui.render(<RuntimeAvailabilityContext.Provider value={{ status: "reconnecting", loading: false, ready: false, error: "cloud_runtime_unavailable", retry: () => retries++ }}>
    <RuntimeRecovery /><RuntimeEmptyState /><ComposerConnectionHint />
  </RuntimeAvailabilityContext.Provider>);
  expect(ui.text()).toContain("Cannot connect to your cloud runtime.");
  expect(ui.text()).not.toContain("cloud_runtime_unavailable");
  expect(ui.text()).not.toContain("No running sessions");
  expect(ui.text()).toContain("Reconnect to start a session");
  ui.flush(() => (ui.query("button") as HTMLElement).click());
  expect(retries).toBe(1);
});

test("initial load and live empty lists have distinct messages", () => {
  ui.render(<RuntimeAvailabilityContext.Provider value={{ status: "connecting", loading: true, ready: false, error: null, retry: () => {} }}><RuntimeEmptyState /></RuntimeAvailabilityContext.Provider>);
  expect(ui.text()).toContain("Loading sessions");
  expect(ui.text()).not.toContain("No running sessions");
  ui.render(<RuntimeAvailabilityContext.Provider value={{ status: "live", loading: false, ready: true, error: null, retry: () => {} }}><RuntimeRecovery /><RuntimeEmptyState /><ComposerConnectionHint /></RuntimeAvailabilityContext.Provider>);
  expect(ui.text()).toBe("No running sessions");
});

test("a live socket with failed bootstrap still offers recovery", () => {
  ui.render(<RuntimeAvailabilityContext.Provider value={{ status: "live", loading: false, ready: false, error: "502", retry: () => {} }}><RuntimeRecovery /><RuntimeEmptyState /></RuntimeAvailabilityContext.Provider>);
  expect(ui.text()).toContain("Could not load this computer");
  expect(ui.text()).not.toContain("No running sessions");
});
