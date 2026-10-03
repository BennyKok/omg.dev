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
test("a pending request is one row: the site and Log in, without the reason", async () => {
  globalThis.fetch = (async () => Response.json({ requests: [request], iosAvailable: true, desktopAvailable: true })) as typeof fetch;
  ui.render(<BrowserLoginCard sessionId="session-1" user="user@example.com" />);
  await ui.flushAsync();
  expect(ui.text()).toContain("example.com");
  expect(ui.text()).toContain("Log in");
  expect(ui.text()).not.toContain("Read my dashboard");
  expect(ui.text()).not.toContain("My VM");
});
test("Log in opens the Computer", async () => {
  // Only the login endpoint answers; the Computer page's own requests stay pending.
  globalThis.fetch = ((url: any) => String(url).includes("/api/browser-login")
    ? Promise.resolve(Response.json({ requests: [request], iosAvailable: false, desktopAvailable: true }))
    : new Promise<Response>(() => {})) as typeof fetch;
  ui.render(<BrowserLoginCard sessionId="session-1" />);
  await ui.flushAsync();
  const button = ui.queryAll("button").find(b => b.textContent === "Log in") as HTMLElement;
  await ui.flushAsync(() => button.click());
  expect(document.querySelector('[aria-label="Computer login"]')).not.toBeNull();
});
test("cancel removes the request after the server accepts it", async () => {
  const calls: string[] = [];
  globalThis.fetch = (async (url: any) => {
    calls.push(String(url));
    return Response.json({ requests: [request], iosAvailable: true, desktopAvailable: true });
  }) as typeof fetch;
  ui.render(<BrowserLoginCard sessionId="session-1" />);
  await ui.flushAsync();
  const button = ui.queryAll("button").find(b => b.getAttribute("aria-label") === "Cancel the login request") as HTMLElement;
  await ui.flushAsync(() => button.click());
  expect(calls.some(url => url.includes("/req-1/cancel"))).toBe(true);
  expect(ui.text()).toBe("");
});
test("a completed import shows Signed in with no actions", async () => {
  globalThis.fetch = (async () => Response.json({ requests: [{ ...request, status: "imported" }] })) as typeof fetch;
  ui.render(<BrowserLoginCard sessionId="session-1" />);
  await ui.flushAsync();
  expect(ui.text()).toContain("Signed in");
  expect(ui.query("button")).toBeNull();
});
test("an import the agent already knows about leaves the card", async () => {
  globalThis.fetch = (async () => Response.json({ requests: [{ ...request, status: "imported", agentNotified: true }] })) as typeof fetch;
  ui.render(<BrowserLoginCard sessionId="session-1" />);
  await ui.flushAsync();
  expect(ui.text()).toBe("");
});

test("a newer pending request replaces an older failure even when the response is out of order", async () => {
  const newer = { ...request, id: "req-new", reason: "Use the new request", createdAt: 20 };
  const olderFailure = { ...request, id: "req-old", reason: "Old failed request", status: "failed", createdAt: 10,
    message: "Could not transfer the login." };
  globalThis.fetch = (async () => Response.json({
    requests: [newer, olderFailure], iosAvailable: true, desktopAvailable: true,
  })) as typeof fetch;
  ui.render(<BrowserLoginCard sessionId="session-1" />);
  await ui.flushAsync();
  expect(ui.text()).toContain("Log in");
  expect(ui.text()).not.toContain("Could not transfer the login");
});
