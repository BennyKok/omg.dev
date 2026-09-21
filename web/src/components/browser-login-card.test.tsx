import { afterEach, beforeEach, expect, test } from "bun:test";
import { mount, type Mounted } from "../test-support/render";
import { configureOmgTransport } from "../lib/omg-client";
import { createSameOriginTransport } from "@omg-dev/client";
const { BrowserLoginCard } = await import("./browser-login-card");
let ui: Mounted;
const originalFetch = globalThis.fetch;
const request = {
  id: "req-1", sessionId: "session-1", url: "https://example.com/account", origin: "https://example.com",
  computerName: "My VM", reason: "Read my dashboard", status: "pending", createdAt: 1, expiresAt: Date.now() + 600_000,
};
beforeEach(() => {
  configureOmgTransport(createSameOriginTransport({ fetch: ((...args: Parameters<typeof fetch>) => globalThis.fetch(...args)) as typeof fetch }));
  ui = mount();
});
afterEach(() => { ui.cleanup(); globalThis.fetch = originalFetch; configureOmgTransport(createSameOriginTransport()); });
test("a connected iPhone gets actionable handoff text and a Computer fallback", async () => {
  globalThis.fetch = (async () => Response.json({ requests: [request], iosAvailable: true, desktopAvailable: true })) as typeof fetch;
  ui.render(<BrowserLoginCard sessionId="session-1" user="user@example.com" />);
  await ui.flushAsync();
  expect(ui.text()).toContain("example.com");
  expect(ui.text()).toContain("Login for My VM");
  expect(ui.text()).toContain("Open this chat in the iOS app");
  expect(ui.text()).toContain("Open Computer");
});
test("without an active iPhone, the request still offers Computer login", async () => {
  globalThis.fetch = (async () => Response.json({ requests: [request], iosAvailable: false, desktopAvailable: true })) as typeof fetch;
  ui.render(<BrowserLoginCard sessionId="session-1" />);
  await ui.flushAsync();
  expect(ui.text()).toContain("latest iOS app");
  expect(ui.text()).toContain("Open Computer");
});
test("cancel removes the request after the server accepts it", async () => {
  const calls: string[] = [];
  globalThis.fetch = (async (url: any) => {
    calls.push(String(url));
    return Response.json({ requests: [request], iosAvailable: true, desktopAvailable: true });
  }) as typeof fetch;
  ui.render(<BrowserLoginCard sessionId="session-1" />);
  await ui.flushAsync();
  const button = ui.queryAll("button").find(b => b.textContent === "Cancel request") as HTMLElement;
  await ui.flushAsync(() => button.click());
  expect(calls.some(url => url.includes("/req-1/cancel"))).toBe(true);
  expect(ui.text()).toBe("");
});
test("a completed import reports the verification requirement", async () => {
  globalThis.fetch = (async () => Response.json({ requests: [{ ...request, status: "imported", message: "Login transferred. The agent must verify the signed-in page before continuing." }] })) as typeof fetch;
  ui.render(<BrowserLoginCard sessionId="session-1" />);
  await ui.flushAsync();
  expect(ui.text()).toContain("must verify");
  expect(ui.query("button")).toBeNull();
});
