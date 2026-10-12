import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mount, type Mounted } from "../test-support/render";
const { IosTestingSettingsSection } = await import("./ios-testing-settings");
let ui: Mounted;
const originalFetch = globalThis.fetch;
beforeEach(() => { ui = mount(); });
afterEach(() => { ui.cleanup(); globalThis.fetch = originalFetch; });
const empty = { supported: true, busy: false, connection: null, devices: [], profile: null, phase: "idle", error: null };
function respond(state = empty, extra: Record<string, () => Response> = {}) {
  const calls: Array<{ url: string; body?: unknown }> = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    return extra[url]?.() ?? (url === "/api/ios-testing" ? Response.json(state) : Response.json({ started: true }));
  }) as typeof fetch;
  return calls;
}
function button(label: string): HTMLButtonElement {
  const found = ui.queryAll("button").find((element) => element.textContent?.includes(label));
  if (!found) throw new Error("Expected setup control is missing");
  return found as HTMLButtonElement;
}
describe("iOS testing Settings", () => {
  test("hides local Apple setup on unsupported computers", async () => {
    globalThis.fetch = (async () => Response.json({ supported: false })) as typeof fetch;
    ui.render(<IosTestingSettingsSection />); await ui.flushAsync();
    expect(ui.queryAll("button")).toHaveLength(0);
  });
  test("opens native login without collecting or sending an Apple password", async () => {
    const calls = respond(); ui.render(<IosTestingSettingsSection />); await ui.flushAsync();
    expect(ui.query('input[type="password"]')).toBeNull();
    ui.flush(() => button("Connect Apple").click()); await ui.flushAsync();
    expect(calls.find((call) => call.url.endsWith("/login"))?.body).toEqual({});
    expect(ui.query('[role="status"]')).not.toBeNull();
  });
  test("prevents profile creation before both account and iPhone setup", async () => {
    respond(); ui.render(<IosTestingSettingsSection />); await ui.flushAsync();
    expect(button("Create testing profile").disabled).toBe(true);
  });
  test("selects a device found through the local USB action", async () => {
    const calls = respond(empty, { "/api/ios-testing/devices": () => Response.json({ devices: [{ name: "Test iPhone", udid: "phone1" }] }) });
    ui.render(<IosTestingSettingsSection />); await ui.flushAsync();
    ui.flush(() => button("Find iPhone").click()); await ui.flushAsync();
    ui.flush(() => button("Use Test iPhone").click()); await ui.flushAsync();
    expect(calls.find((call) => call.url.endsWith("/select-devices"))?.body).toEqual({ deviceIds: ["phone1"] });
  });
  test("shows a failed setup action without advancing the step", async () => {
    respond(empty, { "/api/ios-testing/login": () => Response.json({ error: "Terminal permission is required" }, { status: 503 }) });
    ui.render(<IosTestingSettingsSection />); await ui.flushAsync();
    ui.flush(() => button("Connect Apple").click()); await ui.flushAsync();
    expect(ui.query('[role="alert"]')?.textContent).toContain("Terminal permission is required");
    expect(button("Create testing profile").disabled).toBe(true);
  });
});
