import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mount, type Mounted } from "../test-support/render";

const { LinkedDevicesSettingsSection } = await import("./linked-devices-settings");
const { refreshLinkedDevices } = await import("../lib/linked-devices");

let ui: Mounted;
const originalFetch = globalThis.fetch;
const originalConfirm = window.confirm;
let calls: Array<{ url: string; method: string; body?: string }> = [];
let devices: unknown[] = [];

const testMac = {
  id: "test-mac",
  tailnetIp: "100.64.0.9",
  pairedAt: 1,
  lastSeenAt: Date.now(),
  actions: [
    { name: "snap", approval: "in-grant" },
    { name: "subs", approval: "each" },
  ],
};

function serve(routes: { listStatus?: number } = {}) {
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    calls.push({ url, method, body: typeof init?.body === "string" ? init.body : undefined });
    if (url === "/api/devices" && method === "GET") {
      if (routes.listStatus) return Response.json({ error: "no" }, { status: routes.listStatus });
      return Response.json({ devices, requests: [] });
    }
    if (url === "/api/devices/pairing" && method === "POST") {
      return Response.json({ code: "ABCDE-FGHJK", name: "lab-pc", expiresAt: Date.now() + 600_000, server: "https://box.example.ts.net" });
    }
    if (url === "/api/devices/test-mac" && method === "DELETE") {
      devices = [];
      return Response.json({ ok: true });
    }
    return Response.json({ error: "unexpected" }, { status: 500 });
  }) as typeof fetch;
}

beforeEach(() => {
  ui = mount();
  calls = [];
  devices = [testMac];
});

afterEach(() => {
  ui.cleanup();
  globalThis.fetch = originalFetch;
  window.confirm = originalConfirm;
});

describe("LinkedDevicesSettingsSection", () => {
  test("lists each device with its actions and approval levels", async () => {
    serve();
    await refreshLinkedDevices();
    ui.render(<LinkedDevicesSettingsSection />);
    await ui.flushAsync();

    expect(ui.text()).toContain("Linked devices");
    expect(ui.text()).toContain("@test-mac");
    expect(ui.text()).toContain("Connected now");
    expect(ui.text()).toContain("snap (runs during a grant)");
    expect(ui.text()).toContain("subs (asks every time)");
  });

  test("pairing shows the one-use command with this box's address", async () => {
    serve();
    await refreshLinkedDevices();
    ui.render(<LinkedDevicesSettingsSection />);
    await ui.flushAsync();

    const input = (ui.query('input[aria-label="Device name"]') as HTMLInputElement);
    const setValue = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!;
    await ui.flushAsync(() => {
      setValue.call(input, "lab-pc");
      input.dispatchEvent(new window.Event("input", { bubbles: true }));
    });
    await ui.flushAsync(() => {
      (ui.query('button[type="submit"]') as HTMLButtonElement).click();
    });

    const pair = calls.find((c) => c.url === "/api/devices/pairing");
    expect(JSON.parse(pair!.body!)).toEqual({ name: "lab-pc" });
    expect(ui.query("[data-pairing-code]")?.textContent).toContain(
      "omg device link --server https://box.example.ts.net --code ABCDE-FGHJK",
    );
  });

  test("unlink asks first and does nothing when the person cancels", async () => {
    serve();
    await refreshLinkedDevices();
    ui.render(<LinkedDevicesSettingsSection />);
    await ui.flushAsync();

    window.confirm = () => false;
    await ui.flushAsync(() => (ui.query('button[aria-label="Unlink test-mac"]') as HTMLButtonElement).click());
    expect(calls.some((c) => c.method === "DELETE")).toBe(false);

    window.confirm = () => true;
    await ui.flushAsync(() => (ui.query('button[aria-label="Unlink test-mac"]') as HTMLButtonElement).click());
    expect(calls.some((c) => c.method === "DELETE" && c.url === "/api/devices/test-mac")).toBe(true);
    expect(ui.query('[data-linked-device="test-mac"]')).toBeNull();
  });

  test("hidden when the server has no device routes", async () => {
    serve({ listStatus: 404 });
    await refreshLinkedDevices();
    ui.render(<LinkedDevicesSettingsSection />);
    await ui.flushAsync();
    expect(ui.text()).not.toContain("Linked devices");
  });
});
