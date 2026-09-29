import { afterEach, beforeEach, expect, test } from "bun:test";
import { mount, type Mounted } from "../test-support/render";
import { configureOmgTransport } from "../lib/omg-client";
import { createSameOriginTransport } from "@omg-dev/client";
const { ExpoSigninSheet } = await import("./expo-signin-sheet");

let ui: Mounted;
const originalFetch = globalThis.fetch;
const width = Object.getOwnPropertyDescriptor(window.HTMLElement.prototype, "clientWidth");
let sockets = 0;

beforeEach(() => {
  sockets = 0;
  const base = createSameOriginTransport({ fetch: ((...args: Parameters<typeof fetch>) => globalThis.fetch(...args)) as typeof fetch });
  // No real Computer: count the stream connection, and never open it.
  configureOmgTransport({ ...base, openSocket: async () => { sockets++; throw new Error("no Computer in tests"); } });
  // happy-dom does no layout. The sheet is 195 px wide here: half the page.
  Object.defineProperty(window.HTMLElement.prototype, "clientWidth", { configurable: true, get() { return 195; } });
  ui = mount();
});
afterEach(() => {
  ui.cleanup();
  globalThis.fetch = originalFetch;
  configureOmgTransport(createSameOriginTransport());
  if (width) Object.defineProperty(window.HTMLElement.prototype, "clientWidth", width);
});

async function settle() {
  for (let i = 0; i < 5; i++) { await new Promise((r) => setTimeout(r, 5)); await ui.flushAsync(); }
}

test("shows only the kiosk page, cut out of the Computer screen, and names the site", async () => {
  let frame: Record<string, unknown> = { open: false };
  globalThis.fetch = (async () => Response.json(frame)) as typeof fetch;
  ui.render(<ExpoSigninSheet mode="login" onClose={() => {}} onOpenComputer={() => {}} />);
  await settle();
  expect(document.querySelector('[data-testid="expo-signin-sheet-title"]')?.textContent).toBe("Sign in to Expo");
  expect(document.querySelector('[data-testid="expo-signin-sheet-loading"]')?.textContent).toBe("Opening expo.dev…");
  // Nothing streams before the page exists.
  expect(sockets).toBe(0);

  frame = { open: true, rect: { x: 890, y: 112, width: 390, height: 688 }, screen: { width: 1280, height: 800 }, url: "https://accounts.google.com/signin", inputs: [] };
  await new Promise((r) => setTimeout(r, 800));
  await settle();
  // The whole desktop at half size, moved so the page's corner is the sheet's corner.
  const screen = document.querySelector('[data-testid="expo-signin-sheet-view"] .absolute .absolute') as HTMLElement;
  expect(screen.style.left).toBe("-445px");
  expect(screen.style.top).toBe("-56px");
  expect(screen.style.width).toBe("640px");
  expect(screen.style.height).toBe("400px");
  // A sign-in popup is on top: the caption names its real site.
  expect(document.querySelector('[data-testid="expo-signin-sheet-host"]')?.textContent).toBe("accounts.google.com");
  expect(sockets).toBe(1);
  expect(document.querySelector('[data-testid="expo-signin-sheet-loading"]')?.textContent).toBe("Lost the connection to the Computer.");
});

test("the X cancels, and the fallback opens the full Computer view", async () => {
  globalThis.fetch = (async () => Response.json({ open: false })) as typeof fetch;
  const calls: string[] = [];
  ui.render(<ExpoSigninSheet mode="signup" onClose={() => calls.push("close")} onOpenComputer={() => calls.push("computer")} />);
  await settle();
  expect(document.querySelector('[data-testid="expo-signin-sheet"]')?.getAttribute("aria-label")).toBe("Sign up for Expo");
  ui.flush(() => (document.querySelector('[data-testid="expo-signin-sheet-full-computer"]') as HTMLElement).click());
  ui.flush(() => (document.querySelector('[data-testid="expo-signin-sheet-close"]') as HTMLElement).click());
  expect(calls).toEqual(["computer", "close"]);
  expect(document.querySelector('[data-testid="expo-signin-sheet-full-computer"]')?.textContent).toBe("Open the full Computer view");
});
