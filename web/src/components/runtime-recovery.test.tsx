import { afterEach, beforeEach, expect, test } from "bun:test";
import { mount, type Mounted } from "../test-support/render";
const { RuntimeAvailabilityContext } = await import("../lib/runtime-availability");
const { RuntimeRecovery, RuntimeEmptyState, RuntimeStatusBrand, RuntimeStatusDot } = await import("./runtime-recovery");
let ui: Mounted;
beforeEach(() => { ui = mount(); });
afterEach(() => ui.cleanup());

test("unavailable runtime shows one short status and retains retry", () => {
  let retries = 0;
  ui.render(<RuntimeAvailabilityContext.Provider value={{ status: "reconnecting", loading: false, ready: false, error: "cloud_runtime_unavailable", retry: () => retries++ }}>
    <RuntimeRecovery /><RuntimeEmptyState />
  </RuntimeAvailabilityContext.Provider>);
  expect(ui.text()).toBe("Reconnecting…Retry");
  expect(ui.queryAll('[role="status"]').length).toBe(1);
  expect(ui.text()).not.toContain("cloud_runtime_unavailable");
  expect(ui.text()).not.toContain("No running sessions");
  ui.flush(() => (ui.query("button") as HTMLElement).click());
  expect(retries).toBe(1);
});

test("initial load and live empty lists have distinct messages", () => {
  ui.render(<RuntimeAvailabilityContext.Provider value={{ status: "connecting", loading: true, ready: false, error: null, retry: () => {} }}><RuntimeEmptyState /></RuntimeAvailabilityContext.Provider>);
  expect(ui.text()).toBe("");
  expect(ui.text()).not.toContain("No running sessions");
  ui.render(<RuntimeAvailabilityContext.Provider value={{ status: "live", loading: false, ready: true, error: null, retry: () => {} }}><RuntimeRecovery /><RuntimeEmptyState /></RuntimeAvailabilityContext.Provider>);
  expect(ui.text()).toBe("No running sessions");
});

test("a live socket with failed bootstrap still offers recovery", () => {
  ui.render(<RuntimeAvailabilityContext.Provider value={{ status: "live", loading: false, ready: false, error: "502", retry: () => {} }}><RuntimeRecovery /><RuntimeEmptyState /></RuntimeAvailabilityContext.Provider>);
  expect(ui.text()).toBe("Connection unavailableRetry");
  expect(ui.text()).not.toContain("No running sessions");
});

test("connecting stays compact and recovery clears all connection feedback", () => {
  const value = { status: "connecting" as const, loading: true, ready: false, error: null, retry: () => {} };
  ui.render(<RuntimeAvailabilityContext.Provider value={value}><RuntimeRecovery /><RuntimeEmptyState /></RuntimeAvailabilityContext.Provider>);
  expect(ui.text()).toBe("Connecting…");
  expect(ui.query("button")).toBeNull();
  ui.render(<RuntimeAvailabilityContext.Provider value={{ ...value, status: "live", loading: false, ready: true }}><RuntimeRecovery /></RuntimeAvailabilityContext.Provider>);
  expect(ui.text()).toBe("");
});

test("the rail brand shows the product until the runtime is not live", () => {
  const live = { status: "live" as const, loading: false, ready: true, error: null, retry: () => {} };
  ui.render(<RuntimeAvailabilityContext.Provider value={live}>
    <RuntimeStatusBrand><span>omg.dev</span></RuntimeStatusBrand>
  </RuntimeAvailabilityContext.Provider>);
  expect(ui.text()).toBe("omg.dev");

  let retries = 0;
  ui.render(<RuntimeAvailabilityContext.Provider value={{ status: "reconnecting", loading: false, ready: false, error: null, retry: () => retries++ }}>
    <RuntimeStatusBrand><span>omg.dev</span></RuntimeStatusBrand>
  </RuntimeAvailabilityContext.Provider>);
  expect(ui.text()).toBe("Reconnecting…");
  expect(ui.text()).not.toContain("omg.dev");
  ui.flush(() => (ui.query("button") as HTMLElement).click());
  expect(retries).toBe(1);
});

test("the collapsed rail keeps a retry target with no words", () => {
  const live = { status: "live" as const, loading: false, ready: true, error: null, retry: () => {} };
  ui.render(<RuntimeAvailabilityContext.Provider value={live}><RuntimeStatusDot /></RuntimeAvailabilityContext.Provider>);
  expect(ui.query("button")).toBeNull();

  let retries = 0;
  ui.render(<RuntimeAvailabilityContext.Provider value={{ status: "connecting", loading: false, ready: false, error: null, retry: () => retries++ }}>
    <RuntimeStatusDot />
  </RuntimeAvailabilityContext.Provider>);
  const dot = ui.query("button") as HTMLElement;
  expect(dot.getAttribute("aria-label")).toBe("Connecting… Retry connection");
  ui.flush(() => dot.click());
  expect(retries).toBe(1);
});
