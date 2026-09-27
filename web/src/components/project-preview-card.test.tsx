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
  const guide = document.querySelector('[data-testid="expo-go-guide"]');
  expect(guide?.textContent).toBe("Scan with your phone camera to open in Expo Go.");
  expect(guide?.querySelector("img")?.getAttribute("src")).toStartWith("data:image/svg+xml");
  expect(guide?.querySelector("img")?.getAttribute("alt")).toBe("QR code that opens this app in Expo Go");
  // A computer cannot know the phone, so the link goes to Expo's page for both stores.
  expect(guide?.querySelector("a")?.getAttribute("href")).toBe("https://expo.dev/go");
  // The long copy is gone; privacy moved behind an info icon.
  expect(ui.text()).not.toContain("Install Expo Go");
  expect(ui.text()).not.toContain("up to a minute");
  expect(ui.text()).not.toContain("Private to you");
  expect(document.querySelector('[aria-label="Private to you. The link is temporary."]')).not.toBeNull();
  expect(document.querySelector('a[aria-label="Open preview in new tab"]')?.getAttribute("href")).toBe("https://sandbox-8081.preview.omgs.app");
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
  // A phone cannot scan its own screen: no QR code, only the store line.
  expect(document.querySelector('[data-testid="expo-go-guide"] img')).toBeNull();
  expect(document.querySelector('[data-testid="expo-go-guide"]')?.textContent).toStartWith("Need Expo Go? Get it on");
  expect(ui.text()).not.toContain("Scan with your phone camera");
  expect(document.querySelector('a[aria-label="Open preview in new tab"]')).not.toBeNull();
  expect(document.querySelector('[aria-label="Private to you. The link is temporary."]')).not.toBeNull();
  // The web preview stays one tap away inside the details.
  const web = ui.queryAll("button").find((node) => node.textContent === "Web preview") as HTMLElement;
  ui.flush(() => web.click());
  expect(document.querySelector('[role="dialog"] iframe')?.getAttribute("src")).toBe("https://sandbox-8081.preview.omgs.app");
  expect(window.localStorage.getItem("lfg_preview_card_expanded")).toBe("1");
});

test("the Expo Go link goes to the store for this phone", async () => {
  const agent = Object.getOwnPropertyDescriptor(window.navigator, "userAgent");
  try {
    for (const [ua, store] of [
      ["Mozilla/5.0 (Linux; Android 14; Pixel 8)", "https://play.google.com/store/apps/details?id=host.exp.exponent"],
      ["Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)", "https://apps.apple.com/app/expo-go/id982107779"],
    ] as const) {
      Object.defineProperty(window.navigator, "userAgent", { value: ua, configurable: true });
      window.localStorage.setItem("lfg_preview_card_expanded", "1");
      globalThis.fetch = (async () => Response.json({ preview: EXPO_PREVIEW })) as typeof fetch;
      ui.render(<ProjectPreviewCard key={ua} sessionId="session-1" />);
      await ui.flushAsync();
      expect(document.querySelector('[data-testid="expo-go-guide"] a')?.getAttribute("href")).toBe(store);
    }
  } finally {
    if (agent) Object.defineProperty(window.navigator, "userAgent", agent);
    else delete (window.navigator as { userAgent?: string }).userAgent;
  }
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

test("a phone's store line names the store for this phone", async () => {
  setPhone(true);
  const agent = Object.getOwnPropertyDescriptor(window.navigator, "userAgent");
  try {
    for (const [ua, store, name] of [
      ["Mozilla/5.0 (Linux; Android 14; Pixel 8)", "https://play.google.com/store/apps/details?id=host.exp.exponent", "Need Expo Go? Get it on Google Play"],
      ["Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)", "https://apps.apple.com/app/expo-go/id982107779", "Need Expo Go? Get it on the App Store"],
    ] as const) {
      Object.defineProperty(window.navigator, "userAgent", { value: ua, configurable: true });
      window.localStorage.setItem("lfg_preview_card_expanded", "1");
      globalThis.fetch = (async () => Response.json({ preview: EXPO_PREVIEW })) as typeof fetch;
      ui.render(<ProjectPreviewCard key={ua} sessionId="session-1" />);
      await ui.flushAsync();
      const guide = document.querySelector('[data-testid="expo-go-guide"]');
      expect(guide?.textContent).toBe(name);
      expect(guide?.querySelector("img")).toBeNull();
      expect(guide?.querySelector("a")?.getAttribute("href")).toBe(store);
    }
  } finally {
    if (agent) Object.defineProperty(window.navigator, "userAgent", agent);
    else delete (window.navigator as { userAgent?: string }).userAgent;
  }
});
