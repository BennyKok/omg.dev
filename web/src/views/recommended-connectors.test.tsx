import { afterEach, beforeEach, expect, test } from "bun:test";
import { mount, type Mounted } from "../test-support/render";
import { createSameOriginTransport } from "@omg-dev/client";
import { configureOmgTransport } from "../lib/omg-client";

const { RecommendedConnectors } = await import("./connectors-native");

const GMAIL = {
  id: "omg/gmail", slug: "gmail", name: "Gmail", description: "Search, read, draft, send, label and trash mail.",
  kind: "native", categories: ["google"], connectUrl: "https://gmailmcp.googleapis.com/mcp/v1", icon: null, domain: null,
  needsOAuth: true, authKind: "oauth", oauthApp: "google", native: "gmail", recommended: true,
};

let ui: Mounted;
const originalFetch = globalThis.fetch;
let configured: boolean;
let saved: Record<string, unknown> | null;
let drafts: Record<string, unknown>[];

beforeEach(() => {
  ui = mount();
  configured = false;
  saved = null;
  drafts = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url.includes("/api/connectors/catalog")) return Response.json({ total: 1, results: [GMAIL], recommended: [GMAIL] });
    if (url.endsWith("/api/connectors/oauth-apps/google") && init?.method === "PUT") {
      saved = JSON.parse(String(init.body));
      configured = true;
      return Response.json({ apps: [] });
    }
    if (url.endsWith("/api/connectors/oauth-apps")) {
      return Response.json({
        apps: [{ id: "google", name: "Google", consoleUrl: "https://console.cloud.google.com/apis/credentials", configured, clientIdHint: configured ? "cid…" : null }],
        redirectUri: "http://127.0.0.1:8766/api/connectors/oauth/callback",
      });
    }
    return new Response("not found", { status: 404 });
  }) as typeof fetch;
  configureOmgTransport(createSameOriginTransport());
});

afterEach(() => {
  ui.cleanup();
  globalThis.fetch = originalFetch;
  configureOmgTransport(createSameOriginTransport());
});

const addConnector = async (draft: Record<string, unknown>) => {
  drafts.push(draft);
};

function connectButton(): HTMLButtonElement {
  return ui.query('[data-recommended="gmail"] button') as HTMLButtonElement;
}

test("without a Google client, shows the setup form with the redirect URI and blocks Connect", async () => {
  ui.render(<RecommendedConnectors user="owner" scope={{ kind: "me" }} connectors={[]} addConnector={addConnector} />);
  await ui.flushAsync();
  expect(ui.text()).toContain("Gmail");
  expect(ui.text()).toContain("Set up Google sign-in once");
  expect(ui.query("[data-redirect-uri]")?.textContent).toBe("http://127.0.0.1:8766/api/connectors/oauth/callback");
  expect(connectButton().disabled).toBe(true);
});

test("saving the client unblocks Connect, which adds Gmail on the google app", async () => {
  ui.render(<RecommendedConnectors user="owner" scope={{ kind: "me" }} connectors={[]} addConnector={addConnector} />);
  await ui.flushAsync();
  const set = (label: string, value: string) => {
    const input = ui.query(`input[aria-label="${label}"]`) as HTMLInputElement;
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!;
    setter.call(input, value);
    input.dispatchEvent(new window.Event("input", { bubbles: true }));
  };
  await ui.flushAsync(() => {
    set("Google client ID", "cid.apps.googleusercontent.com");
    set("Google client secret", "shh");
  });
  await ui.flushAsync(() => {
    (ui.query('[data-oauth-app-setup="google"] button[type="submit"]') as HTMLButtonElement).click();
  });
  expect(saved).toEqual({ clientId: "cid.apps.googleusercontent.com", clientSecret: "shh" });
  expect(ui.query("[data-oauth-app-setup]")).toBeNull();
  expect(connectButton().disabled).toBe(false);

  await ui.flushAsync(() => connectButton().click());
  expect(drafts[0]).toMatchObject({ name: "Gmail", endpoint: "https://gmailmcp.googleapis.com/mcp/v1", oauth: true, oauthApp: "google", native: "gmail", catalogSlug: "gmail" });
});

test("an added Gmail account stays offered as another account", async () => {
  configured = true;
  const added = [{ id: "a", owner: "owner", name: "Gmail (benny@example.com)", slug: "gmail", endpoint: GMAIL.connectUrl, headerNames: [], catalogSlug: "gmail", native: "gmail", account: "benny@example.com", requireApproval: false, createdAt: 1, updatedAt: 1 }];
  ui.render(<RecommendedConnectors user="owner" scope={{ kind: "me" }} connectors={added} addConnector={addConnector} />);
  await ui.flushAsync();
  expect(connectButton().textContent).toBe("Add another account");
});
