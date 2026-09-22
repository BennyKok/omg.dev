import { afterEach, beforeEach, expect, test } from "bun:test";
import { mount, type Mounted } from "../test-support/render";
import { configureOmgTransport } from "../lib/omg-client";
import { createSameOriginTransport } from "@omg-dev/client";
const { ProjectPreviewCard } = await import("./project-preview-card");

let ui: Mounted;
const originalFetch = globalThis.fetch;
beforeEach(() => {
  configureOmgTransport(createSameOriginTransport({ fetch: ((...args: Parameters<typeof fetch>) => globalThis.fetch(...args)) as typeof fetch }));
  ui = mount();
});
afterEach(() => { ui.cleanup(); globalThis.fetch = originalFetch; configureOmgTransport(createSameOriginTransport()); });

test("shows the structured private live preview and opens it in-app", async () => {
  globalThis.fetch = (async () => Response.json({ preview: {
    sessionId: "session-1", title: "Expo web", url: "https://sandbox-5173.preview.omgs.app",
    port: 5173, kind: "sandbox-preview", visibility: "owner", temporary: true, createdAt: 1,
  } })) as typeof fetch;
  ui.render(<ProjectPreviewCard sessionId="session-1" user="person@example.com" />);
  await ui.flushAsync();
  expect(ui.text()).toContain("Expo web");
  expect(ui.text()).toContain("Private to you");
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
  expect(ui.text()).toContain("Expo app");
  expect(ui.text()).toContain("Install Expo Go");
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
