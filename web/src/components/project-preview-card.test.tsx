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
/** Switch the card to a level tab, as a person taps it. */
function pickLevel(level: "web" | "simulator" | "device") {
  const tab = document.querySelector(`[data-testid="project-preview-level-${level}"]`) as HTMLElement;
  ui.flush(() => tab.click());
}
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

test("an Expo preview opens on the web level, inline at phone size", async () => {
  globalThis.fetch = (async () => Response.json({ preview: EXPO_PREVIEW, live: true })) as typeof fetch;
  ui.render(<ProjectPreviewCard sessionId="session-1" user="person@example.com" />);
  await ui.flushAsync();
  const card = document.querySelector('[data-testid="project-preview-card"]');
  expect(card?.getAttribute("data-expanded")).toBe("true");
  expect(card?.getAttribute("data-level")).toBe("web");
  const tabs = ui.queryAll('[role="tab"]');
  expect(tabs.map((tab) => tab.textContent)).toEqual(["Web", "Your phone"]);
  expect(tabs[0]!.getAttribute("aria-selected")).toBe("true");
  const frame = document.querySelector('[data-testid="project-preview-web"] iframe') as HTMLIFrameElement;
  // The signed Expo host: the owner URL needs a cookie an embedded frame does not get.
  expect(frame.getAttribute("src")).toBe("https://cap-token.preview.omgs.app");
  // The page lays out at iPhone size and is scaled into the card.
  expect(frame.style.width).toBe("390px");
  expect(frame.style.height).toBe("844px");
  // Web first: no Expo Go guide until "Your phone".
  expect(document.querySelector('[data-testid="expo-go-guide"]')).toBeNull();
  expect(document.querySelector('a[aria-label="Open preview in new tab"]')?.getAttribute("href")).toBe("https://sandbox-8081.preview.omgs.app");
  expect(document.querySelector('[aria-label="Private to you. The link is temporary."]')).not.toBeNull();
  const full = document.querySelector('[data-testid="project-preview-fullscreen"]') as HTMLElement;
  ui.flush(() => full.click());
  expect(document.querySelector('[role="dialog"] iframe')?.getAttribute("src")).toBe("https://cap-token.preview.omgs.app");
});

test("Your phone shows the Expo Go guide with a scannable link", async () => {
  globalThis.fetch = (async () => Response.json({ preview: EXPO_PREVIEW, live: true })) as typeof fetch;
  ui.render(<ProjectPreviewCard sessionId="session-1" user="person@example.com" />);
  await ui.flushAsync();
  pickLevel("device");
  expect(document.querySelector('[data-testid="project-preview-card"]')?.getAttribute("data-level")).toBe("device");
  expect(document.querySelector('[data-testid="project-preview-web"]')).toBeNull();
  const guide = document.querySelector('[data-testid="expo-go-guide"]');
  expect(guide?.textContent).toBe("Scan with your phone camera to open in Expo Go.");
  expect(guide?.querySelector("img")?.getAttribute("src")).toStartWith("data:image/svg+xml");
  expect(guide?.querySelector("img")?.getAttribute("alt")).toBe("QR code that opens this app in Expo Go");
  // A computer cannot know the phone, so the link goes to Expo's page for both stores.
  expect(guide?.querySelector("a")?.getAttribute("href")).toBe("https://expo.dev/go");
  expect(ui.text()).not.toContain("Install Expo Go");
});

test("the Simulator level appears only when the Computer sends its state", async () => {
  const posts: string[] = [];
  let simulator: Record<string, unknown> = { state: "idle" };
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url.includes("/api/project-preview/simulator")) {
      posts.push(String(init?.body));
      simulator = { state: "starting", phase: "booting", progress: 0.4 };
      return Response.json(simulator);
    }
    return Response.json({ preview: EXPO_PREVIEW, live: true, simulator });
  }) as typeof fetch;
  ui.render(<ProjectPreviewCard sessionId="session-1" user="person@example.com" />);
  await ui.flushAsync();
  expect(ui.queryAll('[role="tab"]').map((tab) => tab.textContent)).toEqual(["Web", "Simulator", "Your phone"]);
  pickLevel("simulator");
  // Not ready yet: the web preview stays in the frame under the status line.
  expect(document.querySelector('[data-testid="project-preview-simulator-waiting"] iframe')?.getAttribute("src")).toBe("https://cap-token.preview.omgs.app");
  expect(ui.text()).toContain("See your app on an iPhone simulator.");
  ui.flush(() => (document.querySelector('[data-testid="project-preview-simulator-start"]') as HTMLElement).click());
  await ui.flushAsync();
  expect(posts).toEqual([JSON.stringify({ action: "start" })]);
  await new Promise((r) => setTimeout(r, 3_100));
  await ui.flushAsync();
  expect(ui.text()).toContain("Starting the iPhone simulator…");
  simulator = { state: "ready", streamId: "s1", streamUrl: "https://sim.example/stream/abc" };
  await new Promise((r) => setTimeout(r, 3_100));
  await ui.flushAsync();
  const frame = document.querySelector('[data-testid="project-preview-simulator"] iframe');
  expect(frame?.getAttribute("src")).toBe("https://sim.example/stream/abc");
  expect(frame?.getAttribute("allow")).toBe("autoplay; clipboard-read; clipboard-write");
  // Leaving the level frees the simulator.
  pickLevel("web");
  await ui.flushAsync();
  expect(posts.at(-1)).toBe(JSON.stringify({ action: "stop" }));
}, 12_000);

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

test("on a phone the card opens on the web level, and Your phone leads to Expo Go", async () => {
  setPhone(true);
  globalThis.fetch = (async () => Response.json({ preview: EXPO_PREVIEW })) as typeof fetch;
  ui.render(<ProjectPreviewCard sessionId="session-1" />);
  await ui.flushAsync();
  const card = document.querySelector('[data-testid="project-preview-card"]');
  expect(card?.getAttribute("data-expanded")).toBe("true");
  expect(document.querySelector('[data-testid="project-preview-web"] iframe')).not.toBeNull();
  expect(document.querySelector('[data-testid="project-preview-expo-go"]')).toBeNull();
  pickLevel("device");
  expect(document.querySelector('[data-testid="project-preview-expo-go"]')?.getAttribute("href")).toBe("exps://cap-token.preview.omgs.app");
  // A phone cannot scan its own screen: no QR code, only the store line.
  expect(document.querySelector('[data-testid="expo-go-guide"] img')).toBeNull();
  expect(document.querySelector('[data-testid="expo-go-guide"]')?.textContent).toStartWith("Need Expo Go? Get it on");
  expect(ui.text()).not.toContain("Scan with your phone camera");

  const toggle = document.querySelector('[data-testid="project-preview-toggle"]') as HTMLElement;
  ui.flush(() => toggle.click());
  expect(card?.getAttribute("data-expanded")).toBe("false");
  expect(window.localStorage.getItem("lfg_preview_card_expanded")).toBe("0");
  // Closed on the phone level, the one-line card keeps Open in Expo Go.
  expect(document.querySelector('[data-testid="project-preview-expo-go"]')).not.toBeNull();
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
      pickLevel("device");
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
  // Every device starts open by default, but the stored choice wins.
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
      pickLevel("device");
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

/** Serve with an Expo account check: the preview row plus /api/expo-account. */
function expoServer(account: Record<string, unknown>, posts: string[] = []) {
  let current = account;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url.includes("/api/expo-account/")) {
      posts.push(`${init?.method ?? "GET"} ${new URL(url, "http://x").pathname}`);
      if (url.includes("/connect")) current = { signedIn: false, connect: { state: "waiting", startedAt: 1 } };
      if (url.includes("/cancel")) current = { signedIn: false, connect: { state: "cancelled", startedAt: 1 } };
      return Response.json(current);
    }
    if (url.includes("/api/expo-account")) return Response.json(current);
    // The Computer view behind "Connect Expo": a Computer without the desktop stack, so it does not start one.
    if (url.includes("/api/computer")) return Response.json({ running: false, deps: { ok: false, missing: [] } });
    return Response.json({ preview: EXPO_PREVIEW, live: true });
  }) as typeof fetch;
  return { set(next: Record<string, unknown>) { current = next; } };
}

test("a phone offers Connect Expo instead of Open in Expo Go while the Computer has no Expo account", async () => {
  setPhone(true);
  const posts: string[] = [];
  expoServer({ signedIn: false }, posts);
  ui.render(<ProjectPreviewCard sessionId="session-1" user="person@example.com" />);
  await ui.flushAsync();
  pickLevel("device");
  expect(document.querySelector('[data-testid="project-preview-expo-go"]')).toBeNull();
  expect(ui.text()).toContain("iPhone needs Expo signed in on the Computer.");
  const connect = document.querySelector('[data-testid="project-preview-connect-expo"]') as HTMLElement;
  expect(connect.textContent).toBe("Connect Expo");
  ui.flush(() => connect.click());
  await ui.flushAsync();
  expect(posts).toEqual(["POST /api/expo-account/connect"]);
  expect(ui.text()).toContain("Sign in to Expo in the Computer window…");
  expect(document.querySelector('[aria-label="Sign in to Expo on the Computer"]')).not.toBeNull();
  const cancel = ui.queryAll("button").find((node) => node.textContent === "Cancel") as HTMLElement;
  ui.flush(() => cancel.click());
  await ui.flushAsync();
  expect(posts).toEqual(["POST /api/expo-account/connect", "POST /api/expo-account/cancel"]);
  expect(ui.text()).toContain("Expo sign-in was cancelled.");
});

test("a signed-in Computer shows Open in Expo Go and the account to use", async () => {
  setPhone(true);
  expoServer({ signedIn: true, username: "expo-e2e-test" });
  ui.render(<ProjectPreviewCard sessionId="session-1" user="person@example.com" />);
  await ui.flushAsync();
  pickLevel("device");
  expect(document.querySelector('[data-testid="project-preview-expo-go"]')?.getAttribute("href")).toBe("exps://cap-token.preview.omgs.app");
  expect(document.querySelector('[data-testid="project-preview-connect-expo"]')).toBeNull();
  expect(document.querySelector('[data-testid="project-preview-expo-account"]')?.textContent).toBe("Sign in to Expo Go as expo-e2e-test.");
});

test("a computer gets Connect Expo in the card, and the Computer view closes once signed in", async () => {
  const server = expoServer({ signedIn: false });
  ui.render(<ProjectPreviewCard sessionId="session-1" user="person@example.com" />);
  await ui.flushAsync();
  pickLevel("device");
  const connect = document.querySelector('[data-testid="project-preview-connect-expo"]') as HTMLElement;
  ui.flush(() => connect.click());
  await ui.flushAsync();
  expect(document.querySelector('[aria-label="Sign in to Expo on the Computer"]')).not.toBeNull();
  server.set({ signedIn: true, username: "expo-e2e-test", connect: { state: "done", startedAt: 1, message: "Signed in to Expo as expo-e2e-test." } });
  await new Promise((r) => setTimeout(r, 3_100));
  await ui.flushAsync();
  expect(document.querySelector('[aria-label="Sign in to Expo on the Computer"]')).toBeNull();
  expect(ui.text()).toContain("Sign in to Expo Go as expo-e2e-test.");
}, 10_000);

test("an Android phone opens Expo Go directly, with no Expo sign-in step", async () => {
  setPhone(true);
  const agent = Object.getOwnPropertyDescriptor(window.navigator, "userAgent");
  Object.defineProperty(window.navigator, "userAgent", { value: "Mozilla/5.0 (Linux; Android 14; Pixel 8)", configurable: true });
  try {
    expoServer({ signedIn: false });
    ui.render(<ProjectPreviewCard sessionId="session-1" user="person@example.com" />);
    await ui.flushAsync();
    pickLevel("device");
    expect(document.querySelector('[data-testid="project-preview-expo-go"]')?.getAttribute("href")).toBe("exps://cap-token.preview.omgs.app");
    expect(document.querySelector('[data-testid="project-preview-connect-expo"]')).toBeNull();
    expect(ui.text()).not.toContain("iPhone needs Expo signed in");
  } finally {
    if (agent) Object.defineProperty(window.navigator, "userAgent", agent);
    else delete (window.navigator as { userAgent?: string }).userAgent;
  }
});
