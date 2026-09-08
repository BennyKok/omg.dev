import { afterEach, beforeEach, expect, test } from "bun:test";
import { mount, type Mounted } from "../test-support/render";
import { createSameOriginTransport } from "@omg-dev/client";
import { configureOmgTransport } from "../lib/omg-client";

const { ConnectorsNativePanel } = await import("./connectors-native");
let ui: Mounted;
const originalFetch = globalThis.fetch;
const originalOpen = window.open;
let events: string[];
let drafts: Record<string, unknown>[];
let connectors: Record<string, unknown>[];
let popup: { location: { href: string }; close: () => void };
let closed: boolean;
let blocked: boolean;
let createFails: boolean;
let authFails: boolean;
let alreadyAuthorized: boolean;
let oauth: boolean;
let connected: boolean;

beforeEach(() => {
  ui = mount();
  events = [];
  drafts = [];
  connectors = [];
  closed = blocked = createFails = authFails = alreadyAuthorized = connected = false;
  oauth = true;
  popup = { location: { href: "" }, close: () => { closed = true; } };
  window.open = (() => {
    events.push("popup");
    return blocked ? null : popup;
  }) as typeof window.open;
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url.includes("/catalog")) return Response.json({ total: 1, results: [{
      id: "test", slug: "test", name: "Example", description: "Example connector",
      needsOAuth: oauth, connectUrl: "https://example.com/mcp",
    }] });
    if (url.endsWith("/api/roles")) return Response.json({ roles: [] });
    if (url.endsWith("/oauth/start")) {
      events.push("auth");
      if (authFails) return Response.json({ error: "Sign-in unavailable" }, { status: 502 });
      return Response.json(alreadyAuthorized ? { alreadyAuthorized: true } : { authorizeUrl: "https://example.com/authorize" });
    }
    if (url.endsWith("/api/connectors") && init?.method === "POST") {
      events.push("create");
      const draft = JSON.parse(String(init.body));
      drafts.push(draft);
      if (createFails) return Response.json({ error: "Could not save" }, { status: 400 });
      const connector = { ...draft, id: "aabb", slug: "example", owner: "owner", requireApproval: false };
      connectors.push(connector);
      return Response.json({ connector });
    }
    if (url.includes("/api/connectors?")) {
      events.push("list");
      return Response.json({ connectors: connectors.map(c => ({ ...c, oauthConnected: connected })) });
    }
    return new Response("not found", { status: 404 });
  }) as typeof fetch;
  configureOmgTransport(createSameOriginTransport());
});

afterEach(() => {
  ui.cleanup();
  globalThis.fetch = originalFetch;
  window.open = originalOpen;
  configureOmgTransport(createSameOriginTransport());
});

async function renderCatalog() {
  ui.render(<ConnectorsNativePanel />);
  await ui.flushAsync(() => new Promise(resolve => setTimeout(resolve, 280)));
}

async function addCatalog() {
  await renderCatalog();
  await ui.flushAsync(() => {
    (ui.query('[data-catalog="test"] button') as HTMLButtonElement).click();
    // The popup must exist before the asynchronous save has completed.
    expect(events).toContain("popup");
    expect(events).not.toContain("auth");
  });
}

async function customForm(auth = "oauth") {
  ui.render(<ConnectorsNativePanel />);
  await ui.flushAsync();
  ui.flush(() => {
    (ui.queryAll("button").find(b => b.textContent?.includes("Add a custom MCP server by URL")) as HTMLButtonElement).click();
  });
  const setValue = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!;
  ui.flush(() => {
    for (const [label, value] of [["Connector name", "Custom"], ["Connector endpoint", "https://example.com/mcp"]]) {
      const input = ui.query(`input[aria-label="${label}"]`) as HTMLInputElement;
      setValue.call(input, value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    }
    const select = ui.query('[aria-label="Connector authentication"]') as HTMLSelectElement;
    expect(select.value).toBe("oauth");
    select.value = auth;
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
  if (auth === "header") ui.flush(() => {
    const input = ui.query('[aria-label="Connector auth header"]') as HTMLInputElement;
    setValue.call(input, "Authorization: Bearer test-token");
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await ui.flushAsync(() => {
    ui.query("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
}

test("catalog Add reserves a popup and starts OAuth for the saved connector", async () => {
  await addCatalog();
  expect(drafts[0]?.oauth).toBe(true);
  expect(popup.location.href).toBe("https://example.com/authorize");
  expect(events.indexOf("popup")).toBeLessThan(events.indexOf("auth"));
  expect(ui.query('[data-connector="example"]')).not.toBeNull();
  connected = true;
  await ui.flushAsync(() => {
    window.dispatchEvent(new window.MessageEvent("message", { source: popup as unknown as Window, data: { omgOauth: true } }));
  });
  expect(ui.text()).toContain("Connected");
});

test("custom URL defaults to OAuth and starts sign-in on Add", async () => {
  await customForm();
  expect(drafts[0]?.oauth).toBe(true);
  expect(events).toContain("auth");
  expect(popup.location.href).toBe("https://example.com/authorize");
  expect(ui.query("form")).toBeNull();
});

for (const mode of ["header", "none"]) test(`custom ${mode} authentication does not open OAuth`, async () => {
  await customForm(mode);
  expect(drafts[0]?.oauth).toBe(false);
  expect(drafts[0]?.headers).toEqual(mode === "header" ? { Authorization: "Bearer test-token" } : {});
  expect(events).not.toContain("popup");
  expect(events).not.toContain("auth");
});

test("catalog entries without OAuth only save", async () => {
  oauth = false;
  await renderCatalog();
  await ui.flushAsync(() => (ui.query('[data-catalog="test"] button') as HTMLButtonElement).click());
  expect(drafts).toHaveLength(1);
  expect(events).not.toContain("popup");
});

test("save failure closes the popup and does not start OAuth", async () => {
  createFails = true;
  await addCatalog();
  expect(closed).toBe(true);
  expect(events).not.toContain("auth");
  expect(ui.text()).toContain("Could not save");
});

test("OAuth failure keeps the saved connector and retries through Connect", async () => {
  authFails = true;
  await customForm();
  expect(closed).toBe(true);
  expect(ui.text()).toContain("Sign-in unavailable");
  expect(ui.query("form")).toBeNull();
  authFails = false;
  await ui.flushAsync(() => (ui.queryAll("button").find(b => b.textContent === "Connect") as HTMLButtonElement).click());
  expect(drafts).toHaveLength(1);
  expect(popup.location.href).toBe("https://example.com/authorize");
});

test("blocked popup leaves Connect available with a useful error", async () => {
  blocked = true;
  await customForm();
  expect(ui.text()).toContain("Allow popups, then click Connect");
  expect(drafts).toHaveLength(1);
  expect(events).not.toContain("auth");
});

test("already authorized closes the blank popup", async () => {
  alreadyAuthorized = true;
  await addCatalog();
  expect(closed).toBe(true);
  expect(popup.location.href).toBe("");
});
