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
let detectAuth: boolean;
let unknownAuth: boolean;
let connected: boolean;
let withGmail: boolean;
const GMAIL = {
  id: "omg/gmail", slug: "gmail", name: "Gmail", description: "Search, read and send mail.", kind: "native", categories: [],
  connectUrl: "https://gmailmcp.googleapis.com/mcp/v1", icon: null, domain: null, needsOAuth: true, authKind: "oauth",
  oauthApp: "google", native: "gmail", recommended: true,
};

beforeEach(() => {
  ui = mount();
  events = [];
  drafts = [];
  connectors = [];
  closed = blocked = createFails = authFails = alreadyAuthorized = connected = detectAuth = unknownAuth = false;
  oauth = true;
  withGmail = false;
  (globalThis as { localStorage?: Storage }).localStorage ??= window.localStorage;
  localStorage.clear();
  popup = { location: { href: "" }, close: () => { closed = true; } };
  window.open = (() => {
    events.push("popup");
    return blocked ? null : popup;
  }) as typeof window.open;
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url.includes("/catalog?recommended=1")) return Response.json({ total: 1, results: [], recommended: withGmail ? [GMAIL] : [] });
    if (url.endsWith("/oauth-apps")) return Response.json({ apps: [{ id: "google", name: "Google", consoleUrl: "", configured: true, clientIdHint: "cid" }], redirectUri: "" });
    if (url.includes("/api/connectors/") && init?.method === "DELETE") {
      events.push("delete");
      connectors = connectors.filter((c) => !url.endsWith(`/${c.id}`));
      return Response.json({ ok: true });
    }
    if (url.includes("/catalog")) return Response.json({ total: 2, results: [{
      id: "omg/gmail", slug: "gmail", name: "Gmail", description: "mail", needsOAuth: true, authKind: "oauth",
      connectUrl: "https://gmailmcp.googleapis.com/mcp/v1", native: "gmail", oauthApp: "google", recommended: true,
    }, {
      id: "test", slug: "test", name: "Example", description: "Example connector",
      needsOAuth: oauth, authKind: unknownAuth ? null : oauth ? "oauth" : "none", connectUrl: "https://example.com/mcp",
    }] });
    if (url.endsWith("/api/roles")) return Response.json({ roles: [{ id: "owner", name: "Owner" }, { id: "growth", name: "Growth" }] });
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
      // The server probes the endpoint and may report a sign-in the catalog
      // did not claim.
      const connector = { ...draft, oauth: draft.oauth === true || detectAuth, id: "aabb", slug: "example", owner: "owner", requireApproval: false };
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

async function renderPanel() {
  ui.render(<ConnectorsNativePanel />);
  await ui.flushAsync(() => new Promise(resolve => setTimeout(resolve, 280)));
}

async function customForm(auth = "oauth") {
  ui.render(<ConnectorsNativePanel />);
  await ui.flushAsync();
  ui.flush(() => {
    (ui.queryAll("button").find(b => b.textContent?.includes("Advanced: add a custom MCP server by URL")) as HTMLButtonElement).click();
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

test("Add reserves a popup before the save, starts OAuth, and shows Connected", async () => {
  await customForm();
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
  // "No authentication" reserves a popup because the server has the last
  // word, but the popup closes when the server reports no sign-in is needed.
  if (mode === "header") expect(events).not.toContain("popup");
  else expect(events).toContain("popup");
  expect(events).not.toContain("auth");
  if (mode === "none") expect(closed).toBe(true);
});

test("an auth-header server that still demands a sign-in offers Connect", async () => {
  // A header means no popup is reserved. The server probes the endpoint,
  // finds it protected, and the saved row offers Connect.
  detectAuth = true;
  await customForm("header");
  expect(events).not.toContain("popup");
  const connect = ui.queryAll("button").find(b => b.textContent === "Connect") as HTMLButtonElement;
  expect(connect).not.toBeUndefined();
  await ui.flushAsync(() => connect.click());
  expect(events).toContain("auth");
  expect(popup.location.href).toBe("https://example.com/authorize");
});

test("a custom URL that demands a sign-in starts OAuth from the none option", async () => {
  detectAuth = true;
  await customForm("none");
  expect(events).toContain("auth");
  expect(popup.location.href).toBe("https://example.com/authorize");
});

test("save failure closes the popup and does not start OAuth", async () => {
  createFails = true;
  await customForm();
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
  await customForm();
  expect(closed).toBe(true);
  expect(popup.location.href).toBe("");
});

const ROWS = () => [
  { id: "1", owner: "owner", name: "Exa", slug: "exa", endpoint: "https://mcp.exa.ai/mcp", headerNames: [], requireApproval: false },
  { id: "2", owner: "role:growth", name: "Gmail (benny@example.com)", slug: "gmail", catalogSlug: "gmail", endpoint: "https://gmail", headerNames: [], native: "gmail", account: "benny@example.com", oauth: true, requireApproval: false },
  { id: "3", owner: "*org*", name: "Notion", slug: "notion", endpoint: "https://notion/mcp", headerNames: [], requireApproval: false },
];

function tab(key: string): HTMLButtonElement {
  return ui.query(`[data-scope-tab="${key}"]`) as HTMLButtonElement;
}

test("tabs pick who a connection is for, each with its count; the owner is not a tab", async () => {
  connectors = ROWS();
  await renderPanel();
  const tabs = ui.queryAll("[data-scope-tab]").map((t) => t.textContent);
  expect(tabs).toEqual(["Me1", "Growth1", "Whole team1"]);
  expect(tab("me").getAttribute("aria-selected")).toBe("true");
  expect(ui.query("[data-scope-hint]")!.textContent).toBe("Only your own agents can use these.");
  // Me shows only personal rows, and says what the team adds.
  expect(ui.query('[data-connector="exa"]')).not.toBeNull();
  expect(ui.query('[data-connector="gmail"]')).toBeNull();
  expect(ui.query("[data-inherited]")!.textContent).toContain("from Whole team: Notion");
});

test("a role's tab shows its apps with the account under each, and says no rules are needed", async () => {
  connectors = ROWS();
  connected = true;
  withGmail = true;
  await renderPanel();
  await ui.flushAsync(() => tab("role:growth").click());
  expect(ui.query("[data-scope-hint]")!.textContent).toBe("Agents of everyone in Growth can use these. No tool rules needed.");
  const gmail = ui.query('[data-app="gmail"]')!;
  expect(gmail.textContent).toContain("benny@example.com");
  expect(gmail.textContent).toContain("Connected");
  expect((ui.query('[data-connect="gmail"]') as HTMLButtonElement).textContent).toBe("Add account");
  expect(ui.query('[data-connector="exa"]')).toBeNull();
});

test("Connect adds to the tab you are on, and the tab is remembered", async () => {
  withGmail = true;
  await renderPanel();
  await ui.flushAsync(() => tab("role:growth").click());
  expect((ui.query('[data-connect="gmail"]') as HTMLButtonElement).textContent).toBe("Connect");
  await ui.flushAsync(() => (ui.query('[data-connect="gmail"]') as HTMLButtonElement).click());
  expect(drafts[0]).toMatchObject({ role: "growth", native: "gmail", oauthApp: "google" });

  ui.cleanup();
  ui = mount();
  await renderPanel();
  expect(tab("role:growth").getAttribute("aria-selected")).toBe("true");
});

test("Manage holds ask-before-use, the tools, and a remove that asks twice", async () => {
  connectors = ROWS();
  await renderPanel();
  expect(ui.query("[data-manage]")).toBeNull();
  await ui.flushAsync(() => (ui.queryAll("button").find((b) => b.getAttribute("aria-label") === "Manage Exa") as HTMLButtonElement).click());
  expect(ui.query("[data-manage]")!.textContent).toContain("Ask me before each use");
  await ui.flushAsync(() => (ui.query('[aria-label="Remove connector Exa"]') as HTMLButtonElement).click());
  expect(events).not.toContain("delete");
  await ui.flushAsync(() => (ui.queryAll("button").find((b) => b.textContent === "Remove for good") as HTMLButtonElement).click());
  expect(events).toContain("delete");
  expect(ui.query('[data-connector="exa"]')).toBeNull();
});

test("the untested catalog is not on the page; a custom server hides under Advanced", async () => {
  await renderPanel();
  expect(ui.text()).not.toContain("Browse the catalog");
  expect(ui.query("[data-catalog]")).toBeNull();
  expect(ui.query('input[aria-label="Connector endpoint"]')).toBeNull();
  expect(ui.text()).toContain("Advanced: add a custom MCP server by URL");
});
