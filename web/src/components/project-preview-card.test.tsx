import { afterEach, beforeEach, expect, test } from "bun:test";
import { mount, type Mounted } from "../test-support/render";
import { configureOmgTransport } from "../lib/omg-client";
import { createSameOriginTransport } from "@omg-dev/client";
const { ProjectPreviewCard, usePreviewFreshness } = await import("./project-preview-card");

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
function tabLabels() { return ui.queryAll('[role="tab"]').map((tab) => tab.getAttribute("aria-label")); }
/** Switch the card to a level tab, as a person taps it. */
function pickLevel(level: "web" | "simulator" | "device") {
  const tab = document.querySelector(`[data-testid="project-preview-level-${level}"]`) as HTMLElement;
  ui.flush(() => tab.click());
}
/** Wait for a lazily loaded part (the sign-in sheet chunk) to render. */
async function waitFor(selector: string) {
  for (let i = 0; i < 100 && !document.querySelector(selector); i++) {
    await new Promise((r) => setTimeout(r, 10));
    await ui.flushAsync();
  }
  return document.querySelector(selector);
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

test("an Expo preview opens on the web level, inline at phone size, with icon tabs below", async () => {
  globalThis.fetch = (async () => Response.json({ preview: EXPO_PREVIEW, live: true })) as typeof fetch;
  ui.render(<ProjectPreviewCard sessionId="session-1" user="person@example.com" />);
  await ui.flushAsync();
  const card = document.querySelector('[data-testid="project-preview-card"]');
  expect(card?.getAttribute("data-expanded")).toBe("true");
  expect(card?.getAttribute("data-level")).toBe("web");
  expect(tabLabels()).toEqual(["Web", "Your phone"]);
  // Icons, not words: the tabs carry no visible text.
  expect(ui.queryAll('[role="tab"]').map((tab) => tab.textContent)).toEqual(["", ""]);
  expect(ui.queryAll('[role="tab"]')[0]!.getAttribute("aria-selected")).toBe("true");
  // The switcher sits under the preview.
  const frameBox = document.querySelector('[data-testid="project-preview-web"]')!;
  const levels = document.querySelector('[data-testid="project-preview-levels"]')!;
  expect(frameBox.compareDocumentPosition(levels) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  const frame = frameBox.querySelector("iframe") as HTMLIFrameElement;
  // The signed Expo host: the owner URL needs a cookie an embedded frame does not get.
  expect(frame.getAttribute("src")).toBe("https://cap-token.preview.omgs.app");
  expect(frame.style.width).toBe("390px");
  expect(frame.style.height).toBe("844px");
  expect(document.querySelector('[data-testid="expo-go-guide"]')).toBeNull();
  expect(document.querySelector('a[aria-label="Open preview in new tab"]')?.getAttribute("href")).toBe("https://sandbox-8081.preview.omgs.app");
  expect(document.querySelector('[aria-label="Private to you. The link is temporary."]')).not.toBeNull();
  const full = document.querySelector('[data-testid="project-preview-fullscreen"]') as HTMLElement;
  ui.flush(() => full.click());
  expect(document.querySelector('[role="dialog"] iframe')?.getAttribute("src")).toBe("https://cap-token.preview.omgs.app");
});

test("Your phone on a computer is a QR code and one short line; the rules sit behind the info icon", async () => {
  globalThis.fetch = (async () => Response.json({ preview: EXPO_PREVIEW, live: true })) as typeof fetch;
  ui.render(<ProjectPreviewCard sessionId="session-1" user="person@example.com" />);
  await ui.flushAsync();
  pickLevel("device");
  expect(document.querySelector('[data-testid="project-preview-card"]')?.getAttribute("data-level")).toBe("device");
  expect(document.querySelector('[data-testid="project-preview-web"]')).toBeNull();
  const qr = document.querySelector('img[data-testid="expo-go-guide"]');
  expect(qr?.getAttribute("src")).toStartWith("data:image/svg+xml");
  expect(qr?.getAttribute("alt")).toBe("QR code that opens this app in Expo Go");
  expect(document.querySelector('[data-testid="project-preview-device"]')?.textContent).toBe("Scan with Expo Go");
  const info = document.querySelector('[data-testid="project-preview-info"]') as HTMLElement;
  expect(info.getAttribute("aria-label")).toContain("same Expo account");
  ui.flush(() => info.click());
  // A computer cannot know the phone, so the store link is Expo's page for both.
  expect(document.querySelector('[role="note"] a')?.getAttribute("href")).toBe("https://expo.dev/go");
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
  expect(tabLabels()).toEqual(["Web", "Simulator", "Your phone"]);
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

test("status token renewal keeps the stream page loaded; a new stream loads a new page", async () => {
  let simulator = { state: "ready", streamId: "s1", streamUrl: "https://sim.example/stream/s1?token=first" };
  globalThis.fetch = (async () => Response.json({ preview: EXPO_PREVIEW, live: true, simulator })) as typeof fetch;
  ui.render(<ProjectPreviewCard sessionId="session-1" />);
  await ui.flushAsync();
  pickLevel("simulator");
  const frame = document.querySelector('[data-testid="project-preview-simulator"] iframe');
  expect(frame?.getAttribute("src")).toBe(simulator.streamUrl);

  simulator = { ...simulator, streamUrl: "https://sim.example/stream/s1?token=renewed" };
  await ui.flushAsync(() => new Promise((resolve) => setTimeout(resolve, 3_100)));
  expect(document.querySelector('[data-testid="project-preview-simulator"] iframe')).toBe(frame);
  expect(frame?.getAttribute("src")).toBe("https://sim.example/stream/s1?token=first");

  simulator = { state: "ready", streamId: "s2", streamUrl: "https://sim.example/stream/s2?token=next" };
  await ui.flushAsync(() => new Promise((resolve) => setTimeout(resolve, 3_100)));
  const next = document.querySelector('[data-testid="project-preview-simulator"] iframe');
  expect(next).not.toBe(frame);
  expect(next?.getAttribute("src")).toBe(simulator.streamUrl);
}, 12_000);

test.each([
  [{ state: "queued", queuePosition: 2, etaMs: 170_000 }, "All simulators are busy. You are number 2 in line. About 3 min.", null],
  [{ state: "unavailable" }, "The simulator is not available now.", null],
  [{ state: "error", message: "The simulator could not open this app." }, "The simulator could not open this app.", "Try again"],
])("simulator wait state %j keeps the web preview usable", async (simulator, status, action) => {
  globalThis.fetch = (async () => Response.json({ preview: EXPO_PREVIEW, live: true, simulator })) as typeof fetch;
  ui.render(<ProjectPreviewCard sessionId="session-1" />);
  await ui.flushAsync();
  pickLevel("simulator");
  expect(ui.text()).toContain(status);
  expect(document.querySelector('[data-testid="project-preview-simulator-waiting"] iframe')?.getAttribute("src"))
    .toBe("https://cap-token.preview.omgs.app");
  expect(document.querySelector('[data-testid="project-preview-simulator-start"]')?.textContent ?? null).toBe(action);
  pickLevel("web");
  expect(document.querySelector('[data-testid="project-preview-web"] iframe')).not.toBeNull();
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

test("on a phone the card opens on the web level, and Your phone is one Open in Expo Go button", async () => {
  setPhone(true);
  globalThis.fetch = (async () => Response.json({ preview: EXPO_PREVIEW })) as typeof fetch;
  ui.render(<ProjectPreviewCard sessionId="session-1" />);
  await ui.flushAsync();
  const card = document.querySelector('[data-testid="project-preview-card"]');
  expect(card?.getAttribute("data-expanded")).toBe("true");
  expect(document.querySelector('[data-testid="project-preview-web"] iframe')).not.toBeNull();
  expect(document.querySelector('[data-testid="project-preview-expo-go"]')).toBeNull();
  pickLevel("device");
  expect(ui.queryAll('[data-testid="project-preview-expo-go"]')).toHaveLength(1);
  expect(document.querySelector('[data-testid="project-preview-expo-go"]')?.getAttribute("href")).toBe("exps://cap-token.preview.omgs.app");
  // A phone cannot scan its own screen: no QR code.
  expect(document.querySelector('[data-testid="expo-go-guide"]')).toBeNull();
  expect(document.querySelector('[data-testid="project-preview-device"]')?.textContent).toBe("Open in Expo Go");

  const toggle = document.querySelector('[data-testid="project-preview-toggle"]') as HTMLElement;
  ui.flush(() => toggle.click());
  expect(card?.getAttribute("data-expanded")).toBe("false");
  expect(window.localStorage.getItem("lfg_preview_card_expanded")).toBe("0");
  // Closed on the phone level, the one-line card keeps Open in Expo Go.
  expect(document.querySelector('[data-testid="project-preview-expo-go"]')).not.toBeNull();
});

test("the info tip links the store for this phone", async () => {
  const agent = Object.getOwnPropertyDescriptor(window.navigator, "userAgent");
  try {
    for (const [ua, store, name] of [
      ["Mozilla/5.0 (Linux; Android 14; Pixel 8)", "https://play.google.com/store/apps/details?id=host.exp.exponent", "Google Play"],
      ["Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)", "https://apps.apple.com/app/expo-go/id982107779", "the App Store"],
    ] as const) {
      Object.defineProperty(window.navigator, "userAgent", { value: ua, configurable: true });
      globalThis.fetch = (async () => Response.json({ preview: EXPO_PREVIEW })) as typeof fetch;
      ui.render(<ProjectPreviewCard key={ua} sessionId="session-1" />);
      await ui.flushAsync();
      pickLevel("device");
      ui.flush(() => (document.querySelector('[data-testid="project-preview-info"]') as HTMLElement).click());
      const link = document.querySelector('[role="note"] a');
      expect(link?.getAttribute("href")).toBe(store);
      expect(link?.textContent).toBe(name);
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

/** Serve with an Expo account check: the preview row plus /api/expo-account. */
function expoServer(account: Record<string, unknown>, posts: string[] = []) {
  let current = account;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url.includes("/api/expo-account/")) {
      const mode = init?.body ? (JSON.parse(String(init.body)) as { mode?: string }).mode : undefined;
      posts.push(`${init?.method ?? "GET"} ${new URL(url, "http://x").pathname}${mode ? ` ${mode}` : ""}`);
      if (url.includes("/connect")) current = { signedIn: false, connect: { state: mode === "signup" ? "signup" : "waiting", startedAt: 1 } };
      if (url.includes("/cancel")) current = { signedIn: false, connect: { state: "cancelled", startedAt: 1 } };
      return Response.json(current);
    }
    if (url.includes("/api/expo-account")) return Response.json(current);
    // The sign-in sheet asks where the kiosk page is. Not open yet: the sheet waits.
    if (url.includes("/api/computer/kiosk")) return Response.json({ open: false });
    // The full Computer view: a Computer without the desktop stack, so it does not start one.
    if (url.includes("/api/computer")) return Response.json({ running: false, deps: { ok: false, missing: [] } });
    return Response.json({ preview: EXPO_PREVIEW, live: true });
  }) as typeof fetch;
  return { set(next: Record<string, unknown>) { current = next; } };
}

test("a phone signed out of Expo offers Create free account and I have one, not Open in Expo Go", async () => {
  setPhone(true);
  const posts: string[] = [];
  expoServer({ signedIn: false }, posts);
  ui.render(<ProjectPreviewCard sessionId="session-1" user="person@example.com" />);
  await ui.flushAsync();
  pickLevel("device");
  expect(document.querySelector('[data-testid="project-preview-expo-go"]')).toBeNull();
  const signedOut = document.querySelector('[data-testid="project-preview-expo-signed-out"]');
  expect(signedOut?.textContent).toBe("Preview on your iPhoneCreate free accountI have one");
  expect(signedOut?.querySelector('[data-testid="expo-logo"]')).not.toBeNull();
  const signup = document.querySelector('[data-testid="project-preview-expo-signup"]') as HTMLElement;
  ui.flush(() => signup.click());
  await ui.flushAsync();
  expect(posts).toEqual(["POST /api/expo-account/connect signup"]);
  expect(document.querySelector('[data-testid="project-preview-expo-connecting"]')?.textContent).toContain("Create your Expo account in the Computer window…");
  // The sheet, not the whole Computer: Expo's page, its title, and the site.
  const sheet = await waitFor('[data-testid="expo-signin-sheet"]');
  expect(sheet?.getAttribute("aria-label")).toBe("Sign up for Expo");
  expect(document.querySelector('[data-testid="expo-signin-sheet-title"]')?.textContent).toBe("Sign up for Expo");
  expect(document.querySelector('[data-testid="expo-signin-sheet-host"]')?.textContent).toBe("expo.dev");
  expect(document.querySelector('[data-testid="expo-signin-sheet-loading"]')?.textContent).toBe("Opening expo.dev…");
  expect(document.querySelector('[aria-label="Sign in to Expo on the Computer"]')).toBeNull();
  // The X cancels the connect and closes the sheet.
  ui.flush(() => (document.querySelector('[data-testid="expo-signin-sheet-close"]') as HTMLElement).click());
  await ui.flushAsync();
  expect(posts).toEqual(["POST /api/expo-account/connect signup", "POST /api/expo-account/cancel"]);
  expect(document.querySelector('[data-testid="expo-signin-sheet"]')).toBeNull();
  expect(ui.text()).toContain("Expo sign-in was cancelled.");
});

test("I have one goes straight to the Expo login", async () => {
  setPhone(true);
  const posts: string[] = [];
  expoServer({ signedIn: false }, posts);
  ui.render(<ProjectPreviewCard sessionId="session-1" user="person@example.com" />);
  await ui.flushAsync();
  pickLevel("device");
  ui.flush(() => (document.querySelector('[data-testid="project-preview-connect-expo"]') as HTMLElement).click());
  await ui.flushAsync();
  expect(posts).toEqual(["POST /api/expo-account/connect login"]);
  expect(document.querySelector('[data-testid="project-preview-expo-connecting"]')?.textContent).toContain("Sign in to Expo in the Computer window…");
  expect((await waitFor('[data-testid="expo-signin-sheet-title"]'))?.textContent).toBe("Sign in to Expo");
  // The card's Cancel ends the run, and the sheet with it.
  ui.flush(() => (document.querySelector('[data-testid="project-preview-cancel-expo"]') as HTMLElement).click());
  await ui.flushAsync();
  expect(posts).toEqual(["POST /api/expo-account/connect login", "POST /api/expo-account/cancel"]);
  expect(document.querySelector('[data-testid="expo-signin-sheet"]')).toBeNull();
  // Closed by mistake: the card brings the sheet back while a run is active.
  expect(document.querySelector('[data-testid="project-preview-open-sheet"]')).toBeNull();
});

test("the sheet keeps the full Computer view as a fallback, and comes back after it", async () => {
  setPhone(true);
  expoServer({ signedIn: false });
  ui.render(<ProjectPreviewCard sessionId="session-1" user="person@example.com" />);
  await ui.flushAsync();
  pickLevel("device");
  ui.flush(() => (document.querySelector('[data-testid="project-preview-connect-expo"]') as HTMLElement).click());
  await waitFor('[data-testid="expo-signin-sheet-full-computer"]');
  ui.flush(() => (document.querySelector('[data-testid="expo-signin-sheet-full-computer"]') as HTMLElement).click());
  await waitFor('[aria-label="Close the computer"]');
  await ui.flushAsync();
  expect(document.querySelector('[aria-label="Sign in to Expo on the Computer"]')).not.toBeNull();
  ui.flush(() => (document.querySelector('[aria-label="Close the computer"]') as HTMLElement).click());
  expect(document.querySelector('[aria-label="Sign in to Expo on the Computer"]')).toBeNull();
  expect(document.querySelector('[data-testid="expo-signin-sheet"]')).not.toBeNull();
});

test("a signed-in Computer shows three short steps and ticks only the Computer account", async () => {
  setPhone(true);
  expoServer({ signedIn: true, username: "expo-e2e-test" });
  ui.render(<ProjectPreviewCard sessionId="session-1" user="person@example.com" />);
  await ui.flushAsync();
  pickLevel("device");
  const steps = document.querySelectorAll('[data-testid="project-preview-expo-steps"] li');
  expect([...steps].map((li) => li.textContent)).toEqual(["Get Expo GoApp Store", "Sign in as expo-e2e-test", "Open in Expo Go"]);
  expect(document.querySelectorAll('[data-testid="project-preview-expo-computer-ok"]')).toHaveLength(1);
  expect(document.querySelector('[data-testid="project-preview-get-expo-go"]')?.getAttribute("href")).toBe("https://apps.apple.com/app/expo-go/id982107779");
  expect(document.querySelector('[data-testid="project-preview-expo-go"]')?.getAttribute("href")).toBe("exps://cap-token.preview.omgs.app");
  expect(document.querySelector('[data-testid="project-preview-connect-expo"]')).toBeNull();
});

test("a computer gets I have one in the card, and the sheet closes itself once signed in", async () => {
  const server = expoServer({ signedIn: false });
  ui.render(<ProjectPreviewCard sessionId="session-1" user="person@example.com" />);
  await ui.flushAsync();
  pickLevel("device");
  const connect = document.querySelector('[data-testid="project-preview-connect-expo"]') as HTMLElement;
  ui.flush(() => connect.click());
  expect(await waitFor('[data-testid="expo-signin-sheet"]')).not.toBeNull();
  // Expo's "Continue" page is the person's step; the sheet stays for it.
  server.set({ signedIn: false, connect: { state: "waiting", startedAt: 1 } });
  await new Promise((r) => setTimeout(r, 3_100));
  await ui.flushAsync();
  expect(document.querySelector('[data-testid="expo-signin-sheet"]')).not.toBeNull();
  server.set({ signedIn: true, username: "expo-e2e-test", connect: { state: "done", startedAt: 1, message: "Signed in to Expo as expo-e2e-test." } });
  await new Promise((r) => setTimeout(r, 3_100));
  await ui.flushAsync();
  expect(document.querySelector('[data-testid="expo-signin-sheet"]')).toBeNull();
  expect(document.querySelector('[data-testid="project-preview-expo-account"]')?.textContent).toBe("Sign in as expo-e2e-test");
  // A computer scans the QR code and links both stores.
  expect(document.querySelector('[data-testid="expo-go-guide"]')).not.toBeNull();
  expect(ui.text()).toContain("Scan to open in Expo Go");
  expect(ui.text()).toContain("Play Store");
}, 12_000);

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
    expect(document.querySelector('[data-testid="project-preview-expo-signed-out"]')).toBeNull();
  } finally {
    if (agent) Object.defineProperty(window.navigator, "userAgent", agent);
    else delete (window.navigator as { userAgent?: string }).userAgent;
  }
});

test("the inline preview reloads when the agent finishes a turn", async () => {
  globalThis.fetch = (async () => Response.json({ preview: EXPO_PREVIEW, live: true })) as typeof fetch;
  ui.render(<ProjectPreviewCard sessionId="session-1" agentBusy />);
  await ui.flushAsync();
  const before = document.querySelector('[data-testid="project-preview-web"] iframe');
  expect(before).not.toBeNull();
  // Still working: the same frame stays, so Metro's own reloads are not cut off.
  ui.render(<ProjectPreviewCard sessionId="session-1" agentBusy />);
  await ui.flushAsync();
  expect(document.querySelector('[data-testid="project-preview-web"] iframe')).toBe(before);
  // The turn ended: a new frame loads the finished app.
  ui.render(<ProjectPreviewCard sessionId="session-1" agentBusy={false} />);
  await ui.flushAsync();
  const after = document.querySelector('[data-testid="project-preview-web"] iframe');
  expect(after).not.toBeNull();
  expect(after).not.toBe(before);
  expect(after?.getAttribute("src")).toBe("https://cap-token.preview.omgs.app");
});

function freshnessDot() { return document.querySelector('[data-testid="project-preview-freshness"]'); }

test("a dot on the card icon marks the preview as still building, with no text", async () => {
  globalThis.fetch = (async () => Response.json({ preview: EXPO_PREVIEW, live: true })) as typeof fetch;
  ui.render(<ProjectPreviewCard sessionId="session-1" agentBusy />);
  await ui.flushAsync();
  const dot = freshnessDot();
  expect(dot?.getAttribute("data-state")).toBe("building");
  expect(dot?.getAttribute("title")).toBe("Still building, updates live");
  expect(dot?.textContent).toBe("");
  // The dot sits on the header icon, so a collapsed card shows it too.
  expect(dot?.closest('[data-testid="project-preview-toggle"]')).not.toBeNull();
  // The turn ends: a green check says the preview is up to date.
  ui.render(<ProjectPreviewCard sessionId="session-1" agentBusy={false} />);
  await ui.flushAsync();
  expect(freshnessDot()?.getAttribute("data-state")).toBe("updated");
  expect(freshnessDot()?.getAttribute("aria-label")).toBe("Up to date");
});

test("an idle agent shows no freshness dot, and a stopped preview hides it", async () => {
  globalThis.fetch = (async () => Response.json({ preview: EXPO_PREVIEW, live: true })) as typeof fetch;
  ui.render(<ProjectPreviewCard sessionId="session-1" />);
  await ui.flushAsync();
  expect(freshnessDot()).toBeNull();
  globalThis.fetch = (async () => Response.json({ preview: EXPO_PREVIEW, live: false })) as typeof fetch;
  ui.render(<ProjectPreviewCard sessionId="session-2" agentBusy />);
  await ui.flushAsync();
  expect(freshnessDot()).toBeNull();
});

test("the up-to-date mark settles away after the turn ends", async () => {
  function Probe({ busy }: { busy: boolean }) { return <span data-testid="probe">{String(usePreviewFreshness(busy, 20))}</span>; }
  const probe = () => document.querySelector('[data-testid="probe"]')?.textContent;
  ui.render(<Probe busy={false} />);
  expect(probe()).toBe("null");
  ui.render(<Probe busy />);
  expect(probe()).toBe("building");
  ui.render(<Probe busy={false} />);
  expect(probe()).toBe("updated");
  await ui.flushAsync(() => new Promise((r) => setTimeout(r, 40)));
  expect(probe()).toBe("null");
  // A new turn before the mark settles goes straight back to building.
  ui.render(<Probe busy />);
  ui.render(<Probe busy={false} />);
  ui.render(<Probe busy />);
  expect(probe()).toBe("building");
});

test("the hosted owner preview waits for permission, bootstraps inline and fullscreen, and rejects unrelated frames", async () => {
  const { EmbeddedHostOptionsProvider } = await import("../lib/embedded-host-options");
  const preview = { ...EXPO_PREVIEW, appId: "my-app", projectId: "project", expoGoUrl: "exps://test-8081-1799999999-abcdef.preview.omgs.app" };
  globalThis.fetch = (async () => Response.json({ preview, live: true })) as typeof fetch;
  const calls: unknown[] = [];
  const hostedPreviewAuth = { getToken: async (identity: unknown) => { calls.push(identity); return { token: "scoped-token", previewUrl: "https://test-8081-1799999999-abcdef.preview.omgs.app" }; } };
  ui.render(<EmbeddedHostOptionsProvider value={{ hostedPreviewAuth }}><ProjectPreviewCard sessionId="session-1" user="person@example.com" /></EmbeddedHostOptionsProvider>);
  await ui.flushAsync(); await ui.flushAsync();
  let frame = document.querySelector('[data-testid="project-preview-web"] iframe') as HTMLIFrameElement;
  expect(frame).not.toBeNull();
  const origin = "https://test-8081-1799999999-abcdef.preview.omgs.app";
  expect(frame.src.split("#")[0]).toBe(origin + "/");
  expect(frame.src).toContain("__omg_preview_auth=");
  expect(calls).toEqual([{ appId: "my-app", projectId: "project", previewUrl: origin }]);
  const renewal = { type: "omg:preview-auth:request", appId: "my-app", requestId: "nonce" };
  window.dispatchEvent(messageEvent({ source: window, origin, data: renewal }));
  window.dispatchEvent(messageEvent({ source: frame.contentWindow, origin: "https://attacker.example", data: renewal }));
  window.dispatchEvent(messageEvent({ source: frame.contentWindow, origin, data: { ...renewal, appId: "other-app" } }));
  await ui.flushAsync(); expect(calls).toHaveLength(1);
  window.dispatchEvent(messageEvent({ source: frame.contentWindow, origin, data: renewal }));
  await ui.flushAsync(); expect(calls).toHaveLength(2);
  ui.flush(() => (document.querySelector('[data-testid="project-preview-fullscreen"]') as HTMLElement).click());
  await ui.flushAsync(); await ui.flushAsync();
  frame = document.querySelector('[role="dialog"] iframe') as HTMLIFrameElement;
  expect(frame.src).toContain("__omg_preview_auth=");
});

test("a failed hosted permission check shows a recoverable failure and never loads a frame", async () => {
  const { EmbeddedHostOptionsProvider } = await import("../lib/embedded-host-options");
  globalThis.fetch = (async () => Response.json({ preview: { ...EXPO_PREVIEW, appId: "my-app", projectId: "project" }, live: true })) as typeof fetch;
  ui.render(<EmbeddedHostOptionsProvider value={{ hostedPreviewAuth: { getToken: async () => null } }}><ProjectPreviewCard sessionId="session-1" /></EmbeddedHostOptionsProvider>);
  await ui.flushAsync(); await ui.flushAsync();
  expect(ui.text()).toContain("Preview sign-in failed.");
  expect(document.querySelector('[data-testid="project-preview-web"] iframe')).toBeNull();
});

test("closing the preview discards renewal and revocation returns no token", async () => {
  const { EmbeddedHostOptionsProvider } = await import("../lib/embedded-host-options");
  const preview = { ...EXPO_PREVIEW, appId: "my-app", projectId: "project", expoGoUrl: "exps://test-8081-1799999999-abcdef.preview.omgs.app" };
  globalThis.fetch = (async () => Response.json({ preview, live: true })) as typeof fetch;
  let renew: ((token: { token: string; previewUrl: string } | null) => void) | undefined;
  let calls = 0;
  const hostedPreviewAuth = { getToken: async () => ++calls === 1 ? { token: "initial-token", previewUrl: "https://test-8081-1799999999-abcdef.preview.omgs.app" } : new Promise<{ token: string; previewUrl: string } | null>(resolve => { renew = resolve; }) };
  ui.render(<EmbeddedHostOptionsProvider value={{ hostedPreviewAuth }}><ProjectPreviewCard sessionId="session-1" /></EmbeddedHostOptionsProvider>);
  await ui.flushAsync(); await ui.flushAsync();
  const frame = document.querySelector('[data-testid="project-preview-web"] iframe') as HTMLIFrameElement;
  const replies: unknown[] = [];
  frame.contentWindow!.postMessage = ((...args: unknown[]) => { replies.push(args); }) as typeof window.postMessage;
  const send = () => window.dispatchEvent(messageEvent({ source: frame.contentWindow, origin: new URL(frame.src).origin,
    data: { type: "omg:preview-auth:request", appId: "my-app", requestId: "renewal" } }));
  send(); await ui.flushAsync(); renew!(null); await ui.flushAsync();
  expect(replies).toEqual([[{ type: "omg:preview-auth:response", appId: "my-app", requestId: "renewal", token: null }, new URL(frame.src).origin]]);
  send(); await ui.flushAsync();
  ui.render(<div>Another project</div>);
  renew!({ token: "late-token", previewUrl: "https://test-8081-1799999999-abcdef.preview.omgs.app" }); await ui.flushAsync();
  expect(replies).toHaveLength(1);
});

function messageEvent(values: { source: unknown; origin: string; data: unknown }) {
  const event = new Event("message");
  Object.defineProperties(event, Object.fromEntries(Object.entries(values).map(([key, value]) => [key, { value }])));
  return event;
}
