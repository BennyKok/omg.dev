import { afterEach, beforeEach, expect, test } from "bun:test";
import { mount, type Mounted } from "../test-support/render";
import type { ReceiverState } from "../lib/linked-devices";
const { DeviceReceiverMonitor, DeviceNotificationSettings } = await import("./device-receiver-monitor");
const { DeviceReceiverSettings } = await import("./device-receiver-settings");
const { LinkedDevicesPage, LinkedDevicesRow } = await import("./linked-devices-settings");
const { refreshLinkedDevices } = await import("../lib/linked-devices");

let ui: Mounted;
let state: ReceiverState;
let calls: string[];
const savedFetch = globalThis.fetch;
const savedEventSource = globalThis.EventSource;
const savedNotification = globalThis.Notification;
let streams: FakeEvents[];
class FakeEvents {
  readyState = 1;
  onmessage: ((e: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  closed = false;
  constructor() { streams.push(this); }
  close() { this.closed = true; }
  send() { this.onmessage?.({ data: JSON.stringify(state) }); }
}

beforeEach(() => {
  ui = mount(); calls = []; streams = [];
  state = { deviceId: "mac", server: "https://linux.example", active: false, actions: [{ name: "inspect", approval: "each" }], endsAt: null, idleMinutes: null, error: null, pending: null, activity: [], requests: [] };
  globalThis.EventSource = FakeEvents as any;
  globalThis.Notification = { permission: "denied" } as any;
  globalThis.fetch = (async (input: any, init: any) => {
    const url = String(input); calls.push(url);
    if (url === "/api/devices") return Response.json({ devices: [], requests: [] });
    if (url.endsWith("/clear")) state = { ...state, active: false, pending: null, requests: [] };
    return Response.json(state);
  }) as any;
});
afterEach(() => {
  ui.cleanup(); globalThis.fetch = savedFetch;
  globalThis.EventSource = savedEventSource; globalThis.Notification = savedNotification;
});

function pending() {
  state.requests = [{ id: "dr_incoming", action: "inspect", status: "waiting-approval", args: {}, requestedBy: "coding-session", expiresAt: Date.now() + 60_000 }];
  state.pending = { token: "permission-token", request: state.requests[0], argv: ["/bin/echo", "hello"], approval: "each", expiresAt: Date.now() + 60_000 };
}

test("incoming work reaches the shell on another page and opens its receiving view", async () => {
  let opened = 0;
  ui.render(<><div>Another page</div><DeviceReceiverMonitor onOpen={() => opened++} /></>);
  await ui.flushAsync();
  expect(streams).toHaveLength(1);
  pending();
  await ui.flushAsync(() => streams[0].send());
  expect(ui.text()).toContain("Device request needs approval");
  const button = ui.query("button") as HTMLButtonElement;
  await ui.flushAsync(() => button.click());
  expect(opened).toBe(1);
  state = { ...state, requests: [], pending: null };
  await ui.flushAsync(() => streams[0].send());
  expect(ui.query("aside")).toBeNull();
  ui.cleanup();
  expect(streams[0].closed).toBe(true);
});

test("a paired receiver opens Receive requests and the Settings row identifies it", async () => {
  pending();
  await refreshLinkedDevices();
  ui.render(<><LinkedDevicesRow onOpen={() => {}} /><LinkedDevicesPage /></>);
  await ui.flushAsync();
  expect(ui.text()).toContain("Receiving as @mac");
  expect(ui.text()).toContain("Approve inspect");
  expect(streams).toHaveLength(1);
  const send = ui.queryAll("button").find((b) => b.textContent?.startsWith("Send requests")) as HTMLButtonElement;
  await ui.flushAsync(() => send.click());
  expect(ui.text()).toContain("Pair a device");
  await ui.flushAsync(() => streams[0].send());
  expect(ui.text()).toContain("Pair a device");
  await ui.flushAsync(() => window.dispatchEvent(new window.Event("omg-device-open")));
  expect(ui.text()).toContain("Approve inspect");
});

test("incoming session links target the controller; review refocuses approval; clear only changes device access", async () => {
  pending(); state.active = true;
  ui.render(<DeviceReceiverSettings />); await ui.flushAsync();
  expect(ui.query('a')?.getAttribute("href")).toBe("https://linux.example/?session=coding-session");
  const click = async (text: string) => ui.flushAsync(() => (ui.queryAll("button").find((b) => b.textContent === text) as HTMLButtonElement).click());
  await click("Review approval");
  expect(document.activeElement?.id).toBe("device-approval");
  await click("Stop and clear requests");
  expect(calls.filter((c) => c.endsWith("/clear"))).toHaveLength(1);
  expect(calls.some((c) => c.includes("/sessions/"))).toBe(false);
  expect(ui.text()).toContain("Access is stopped");
  expect(ui.text()).toContain("No active requests");
});

test("a lost event stream removes stale approval controls", async () => {
  pending();
  ui.render(<DeviceReceiverSettings />); await ui.flushAsync();
  await ui.flushAsync(() => streams[0].onerror?.());
  expect(ui.text()).toContain("Reconnecting");
  expect(ui.query('[aria-label="Action approval"]')).toBeNull();
  await ui.flushAsync(() => streams[0].send());
  expect(ui.query('[aria-label="Action approval"]')).not.toBeNull();
});

test("notification permission is requested only by the enable button", async () => {
  let requested = 0;
  globalThis.Notification = { permission: "default", requestPermission: async () => { requested++; return "granted"; } } as any;
  ui.render(<DeviceNotificationSettings />); await ui.flushAsync();
  expect(requested).toBe(0);
  await ui.flushAsync(() => (ui.query("button") as HTMLButtonElement).click());
  expect(requested).toBe(1);
  expect(ui.text()).toContain("Browser notifications are allowed");
  expect(ui.text()).toContain("closed or suspended");
});
