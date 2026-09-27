import { afterEach, beforeEach, expect, test } from "bun:test";
import { mount, type Mounted } from "../test-support/render";
import { configureOmgTransport } from "../lib/omg-client";
import { createSameOriginTransport } from "@omg-dev/client";
const { ProjectPreviewCard } = await import("./project-preview-card");

// The card reads the device once, at mount: a phone starts closed.
const originalMatchMedia = window.matchMedia;
function setPhone(phone: boolean) {
  window.matchMedia = phone
    ? ((query: string) => ({ matches: true, media: query, addEventListener() {}, removeEventListener() {} })) as unknown as typeof window.matchMedia
    : originalMatchMedia;
}
const EXPO_PREVIEW = {
  sessionId: "session-1", title: "Todo app", url: "https://sandbox-8081.preview.omgs.app",
  port: 8081, kind: "sandbox-preview", visibility: "owner", temporary: true, createdAt: 1,
  expoGoUrl: "exps://cap-token.preview.omgs.app",
};

let ui: Mounted;
const originalFetch = globalThis.fetch;
beforeEach(() => {
  configureOmgTransport(createSameOriginTransport({ fetch: ((...args: Parameters<typeof fetch>) => globalThis.fetch(...args)) as typeof fetch }));
  ui = mount();
  window.localStorage.removeItem("lfg_preview_card_expanded");
});
afterEach(() => { ui.cleanup(); setPhone(false); globalThis.fetch = originalFetch; configureOmgTransport(createSameOriginTransport()); });

test("shows the structured private live preview and opens it in-app", async () => {
  globalThis.fetch = (async () => Response.json({ preview: {
    sessionId: "session-1", title: "Expo web", url: "https://sandbox-5173.preview.omgs.app",
    port: 5173, kind: "sandbox-preview", visibility: "owner", temporary: true, createdAt: 1,
  } })) as typeof fetch;
  ui.render(<ProjectPreviewCard sessionId="session-1" user="person@example.com" />);
  await ui.flushAsync();
  expect(ui.text()).toContain("Expo web");
  expect(ui.text()).toContain("Live preview");
  const button = ui.queryAll("button").find((node) => node.textContent === "Open preview") as HTMLElement;
  ui.flush(() => button.click());
  const dialog = document.querySelector('[role="dialog"]');
  expect(dialog?.querySelector("iframe")?.getAttribute("src")).toBe("https://sandbox-5173.preview.omgs.app");
});

test("renders nothing when the session has no preview", async () => {
  globalThis.fetch = (async () => Response.json({ preview: null })) as typeof fetch;
  ui.render(<ProjectPreviewCard sessionId="session-1" />);
  await ui.flushAsync();
  expect(ui.text()).toBe("");
});

test("an Expo preview shows the Expo Go guide with a scannable link", async () => {
  globalThis.fetch = (async () => Response.json({ preview: {
    sessionId: "session-1", title: "Todo app", url: "https://sandbox-8081.preview.omgs.app",
    port: 8081, kind: "sandbox-preview", visibility: "owner", temporary: true, createdAt: 1,
    expoGoUrl: "exps://cap-token.preview.omgs.app",
  } })) as typeof fetch;
  ui.render(<ProjectPreviewCard sessionId="session-1" user="person@example.com" />);
  await ui.flushAsync();
  expect(ui.text()).toContain("Expo Go");
  expect(ui.text()).toContain("Install Expo Go");
  expect(ui.text()).toContain("Private to you");
  const guide = document.querySelector('[data-testid="expo-go-guide"]');
  expect(guide?.querySelector("img")?.getAttribute("src")).toStartWith("data:image/svg+xml");
  expect(guide?.querySelector('a[href="exps://cap-token.preview.omgs.app"]')).not.toBeNull();
  const button = ui.queryAll("button").find((node) => node.textContent === "Open web preview") as HTMLElement;
  ui.flush(() => button.click());
  expect(document.querySelector('[role="dialog"] iframe')?.getAttribute("src")).toBe("https://sandbox-8081.preview.omgs.app");
});

test("a web-only preview has no Expo Go guide", async () => {
  globalThis.fetch = (async () => Response.json({ preview: {
    sessionId: "session-1", title: "Site", url: "https://sandbox-5173.preview.omgs.app",
    port: 5173, kind: "sandbox-preview", visibility: "owner", temporary: true, createdAt: 1,
  } })) as typeof fetch;
  ui.render(<ProjectPreviewCard sessionId="session-1" />);
  await ui.flushAsync();
  expect(document.querySelector('[data-testid="expo-go-guide"]')).toBeNull();
  expect(ui.text()).toContain("Live preview");
});

test("a stopped preview offers a restart that asks the session agent", async () => {
  const sent: Array<{ url: string; body: string }> = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.includes("/send")) { sent.push({ url, body: String(init?.body) }); return Response.json({ ok: true }); }
    return Response.json({ live: false, preview: {
      sessionId: "session-1", title: "Todo app", url: "https://sandbox-8081.preview.omgs.app",
      port: 8081, kind: "sandbox-preview", visibility: "owner", temporary: true, createdAt: 1,
      expoGoUrl: "exps://cap-token.preview.omgs.app",
    } });
  }) as typeof fetch;
  ui.render(<ProjectPreviewCard sessionId="session-1" user="person@example.com" />);
  await ui.flushAsync();
  expect(ui.text()).toContain("Stopped");
  expect(document.querySelector('[data-testid="expo-go-guide"]')).toBeNull();
  const button = ui.queryAll("button").find((node) => node.textContent === "Restart preview") as HTMLElement;
  ui.flush(() => button.click());
  await ui.flushAsync();
  expect(sent).toHaveLength(1);
  expect(sent[0]!.url).toContain("/api/sessions/session-1/send");
  expect(JSON.parse(sent[0]!.body).text).toContain("Restart it");
  expect(ui.text()).toContain("Asked the agent to restart it");
});

test("an expired Expo Go link says so and offers the restart", async () => {
  globalThis.fetch = (async () => Response.json({ live: false, expired: true, preview: {
    sessionId: "session-1", title: "Todo app", url: "https://sandbox-8081.preview.omgs.app",
    port: 8081, kind: "sandbox-preview", visibility: "owner", temporary: true, createdAt: 1,
    expoGoUrl: "exps://cap-token.preview.omgs.app",
  } })) as typeof fetch;
  ui.render(<ProjectPreviewCard sessionId="session-1" />);
  await ui.flushAsync();
  expect(ui.text()).toContain("Link expired");
  expect(ui.text()).toContain("The Expo Go link expired.");
  expect(ui.queryAll("button").some((node) => node.textContent === "Restart preview")).toBe(true);
});

test("on a phone the Expo card starts as one line whose main action opens Expo Go", async () => {
  setPhone(true);
  globalThis.fetch = (async () => Response.json({ preview: EXPO_PREVIEW })) as typeof fetch;
  ui.render(<ProjectPreviewCard sessionId="session-1" />);
  await ui.flushAsync();
  const card = document.querySelector('[data-testid="project-preview-card"]');
  expect(card?.getAttribute("data-expanded")).toBe("false");
  expect(document.querySelector('[data-testid="expo-go-guide"]')).toBeNull();
  expect(document.querySelector('[data-testid="project-preview-expo-go"]')?.getAttribute("href")).toBe("exps://cap-token.preview.omgs.app");

  const toggle = document.querySelector('[data-testid="project-preview-toggle"]') as HTMLElement;
  expect(toggle.getAttribute("aria-expanded")).toBe("false");
  ui.flush(() => toggle.click());
  expect(card?.getAttribute("data-expanded")).toBe("true");
  expect(document.querySelector('[data-testid="expo-go-guide"] img')).not.toBeNull();
  // The web preview stays one tap away inside the details.
  const web = ui.queryAll("button").find((node) => node.textContent === "Open web preview") as HTMLElement;
  ui.flush(() => web.click());
  expect(document.querySelector('[role="dialog"] iframe')?.getAttribute("src")).toBe("https://sandbox-8081.preview.omgs.app");
  expect(window.localStorage.getItem("lfg_preview_card_expanded")).toBe("1");
});

test("the open or closed choice is remembered for the next card", async () => {
  window.localStorage.setItem("lfg_preview_card_expanded", "0");
  globalThis.fetch = (async () => Response.json({ preview: EXPO_PREVIEW })) as typeof fetch;
  ui.render(<ProjectPreviewCard sessionId="session-1" />);
  await ui.flushAsync();
  // A computer starts open by default, but the stored choice wins.
  expect(document.querySelector('[data-testid="project-preview-card"]')?.getAttribute("data-expanded")).toBe("false");
  expect(document.querySelector('[data-testid="expo-go-guide"]')).toBeNull();
  // The computer's header action is the web preview.
  expect(ui.queryAll("button").some((node) => node.textContent === "Open web preview")).toBe(true);
});
