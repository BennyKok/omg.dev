import { afterEach, beforeEach, expect, test } from "bun:test";
import "../test-support/render";
import { DeviceNotifications } from "./device-notifications";
import { controllerSessionUrl } from "./device-receiver";
import { validateAppSearch } from "./app-search";
import type { ReceiverState } from "./linked-devices";

const oldNotification = globalThis.Notification;
const oldWorker = Object.getOwnPropertyDescriptor(navigator, "serviceWorker");
let shown: Array<{ title: string; options: NotificationOptions; closed: boolean }>;
let notices: DeviceNotifications;
let state: ReceiverState;
let registration: any;
beforeEach(() => {
  shown = []; notices = new DeviceNotifications();
  state = { deviceId: "mac", server: "https://controller.example", active: false, actions: [], pending: null, error: null, endsAt: null, idleMinutes: null, activity: [], requests: [{ id: "dr_one", action: "inspect", args: { secret: "never on the lock screen" }, status: "queued", requestedBy: "private-session", expiresAt: Date.now() + 60_000 }] };
  globalThis.Notification = { permission: "granted" } as any;
  registration = {
    active: {},
    showNotification: async (title: string, options: NotificationOptions) => { shown.push({ title, options, closed: false }); },
    getNotifications: async () => shown.filter((s) => !s.closed).map((s) => ({ tag: s.options.tag, close: () => { s.closed = true; } })),
  };
  Object.defineProperty(navigator, "serviceWorker", { configurable: true, value: { getRegistration: async () => registration } });
});
afterEach(async () => {
  await notices.dispose();
  globalThis.Notification = oldNotification;
  if (oldWorker) Object.defineProperty(navigator, "serviceWorker", oldWorker);
  else delete (navigator as any).serviceWorker;
});

test("new requests notify once, approvals notify again, and resolved notifications close", async () => {
  await notices.update(state); await notices.update({ ...state });
  expect(shown).toHaveLength(1);
  expect(shown[0].options.data.url).toBe("/devices?receive=1");
  expect(validateAppSearch(Object.fromEntries(new URL(shown[0].options.data.url, "http://localhost").searchParams))).toEqual({ receive: true });
  expect(JSON.stringify(shown)).not.toContain("private-session");
  expect(JSON.stringify(shown)).not.toContain("never on the lock screen");
  state = { ...state, pending: { token: "secret-token", request: state.requests![0], argv: ["/bin/echo"], approval: "each", expiresAt: Date.now() + 60_000 } };
  await notices.update(state);
  expect(shown).toHaveLength(2);
  expect(shown[1].title).toBe("Device request needs approval");
  await notices.update({ ...state, pending: null, requests: [] });
  expect(shown.every((s) => s.closed)).toBe(true);
});

test("denied permission produces no notification and granting later permits it", async () => {
  (Notification as any).permission = "denied";
  await notices.update(state); expect(shown).toHaveLength(0);
  (Notification as any).permission = "granted";
  await notices.update(state); expect(shown).toHaveLength(1);
});

test("a request resolved while the service worker loads is not notified", async () => {
  let resolve!: (reg: any) => void;
  (navigator.serviceWorker as any).getRegistration = () => new Promise((done) => { resolve = done; });
  const first = notices.update(state);
  await Promise.resolve();
  const second = notices.update({ ...state, requests: [] });
  (navigator.serviceWorker as any).getRegistration = async () => registration;
  resolve(registration);
  await first; await second;
  expect(shown).toHaveLength(0);
});

test("requesting-session links reject executable URLs and keep identifiers in a query parameter", () => {
  expect(controllerSessionUrl("javascript:alert(1)", "abc")).toBeNull();
  expect(controllerSessionUrl("https://user:password@controller.example", "abc")).toBeNull();
  expect(controllerSessionUrl("https://controller.example/path", "abc&admin=1")).toBe("https://controller.example/?session=abc%26admin%3D1");
});

test("approval notices close when work starts and do not return while running", async () => {
  state = { ...state, pending: { token: "prompt", request: state.requests![0], argv: ["/bin/echo"], approval: "each", expiresAt: Date.now() + 60_000 } };
  await notices.update(state);
  expect(shown).toHaveLength(1);
  state = { ...state, pending: null, requests: [{ ...state.requests![0], status: "running" }] };
  await notices.update(state); await notices.update({ ...state });
  expect(shown).toHaveLength(1);
  expect(shown[0].closed).toBe(true);
});

test("closing one UI tab does not close another tab's worker notifications", async () => {
  await notices.update(state);
  await notices.dispose();
  expect(shown[0].closed).toBe(false);
});
