import { describe, expect, test } from "bun:test";
import { createKiosk, KIOSK_WIDTH, kioskFrameFrom, type Cdp } from "./kiosk.ts";
import { kioskHitsInput, kioskHost, kioskLayout } from "../../packages/protocol/src/computer-kiosk.ts";

const SCREEN = { width: 1280, height: 800 };

/** A fake browser: pages, their windows, and a log of the commands it got. */
function fakeBrowser() {
  const pages: { targetId: string; type: string; url: string; openerId?: string; window: number }[] = [
    { targetId: "agent", type: "page", url: "https://example.com", window: 1 },
  ];
  const bounds = new Map<number, { left: number; top: number; width: number; height: number }>();
  const log: [string, Record<string, unknown>, string?][] = [];
  let nextWindow = 10;
  let nextTarget = 0;
  const geometry = (targetId: string) => {
    const page = pages.find((p) => p.targetId === targetId)!;
    const b = bounds.get(page.window) ?? { left: 60, top: 56, width: 1050, height: 624 };
    return { sx: b.left, sy: b.top, ow: b.width, oh: b.height, iw: b.width, ih: b.height - 56, url: page.url,
      inputs: [{ x: 20, y: 100, width: 350, height: 40 }], editing: false };
  };
  const cdp: Cdp = {
    async send(method, params = {}, sessionId) {
      log.push([method, params, sessionId]);
      switch (method) {
        case "Target.getTargets": return { targetInfos: pages.map(({ window: _w, ...t }) => t) };
        case "Target.attachToTarget": return { sessionId: `s-${params.targetId}` };
        case "Browser.getWindowForTarget": return { windowId: pages.find((p) => p.targetId === params.targetId)!.window };
        case "Browser.setWindowBounds": {
          const b = params.bounds as Record<string, number>;
          const old = bounds.get(params.windowId as number) ?? { left: 0, top: 0, width: 0, height: 0 };
          // The window manager keeps windows below the 56 px top panel.
          bounds.set(params.windowId as number, { ...old, ...("left" in b ? { left: b.left! } : {}), ...("top" in b ? { top: Math.max(56, b.top!) } : {}),
            ...("width" in b ? { width: b.width! } : {}), ...("height" in b ? { height: b.height! } : {}) });
          return {};
        }
        case "Browser.getWindowBounds": return { bounds: bounds.get(params.windowId as number) };
        case "Runtime.evaluate": return { result: { value: geometry(sessionId!.slice(2)) } };
        case "Target.createTarget": {
          const id = `new-${++nextTarget}`;
          pages.push({ targetId: id, type: "page", url: params.url as string, window: ++nextWindow });
          return { targetId: id };
        }
        case "Target.closeTarget": {
          const i = pages.findIndex((p) => p.targetId === params.targetId);
          if (i >= 0) pages.splice(i, 1);
          return {};
        }
        default: return {};
      }
    },
    close() {},
  };
  const launch = (url: string) => { pages.push({ targetId: "kiosk", type: "page", url, window: ++nextWindow }); };
  const popup = (url: string, opener: string, sameWindowAs?: string) => {
    const window = sameWindowAs ? pages.find((p) => p.targetId === sameWindowAs)!.window : ++nextWindow;
    pages.push({ targetId: `popup-${pages.length}`, type: "page", url, openerId: opener, window });
  };
  return { cdp, pages, bounds, log, launch, popup };
}

function kiosk(browser = fakeBrowser(), launch = true) {
  const k = createKiosk({
    cdp: async () => browser.cdp,
    screen: () => SCREEN,
    launchApp: launch ? browser.launch : () => {},
    sleep: async () => {},
    launchWaitMs: 5,
  });
  return { k, browser };
}

describe("Computer kiosk", () => {
  test("opens a phone-width app window at the right edge and reports its page area", async () => {
    const { k, browser } = kiosk();
    expect(await k.frame()).toEqual({ open: false });
    await k.open("https://expo.dev/signup");
    const set = browser.log.filter(([m, p]) => m === "Browser.setWindowBounds" && (p.bounds as { width?: number }).width);
    expect(set[0]![1].bounds).toMatchObject({ left: SCREEN.width - KIOSK_WIDTH, width: KIOSK_WIDTH });
    const frame = await k.frame();
    // The window starts below the panel (56) and its 56 px info bar.
    expect(frame.rect).toEqual({ x: SCREEN.width - KIOSK_WIDTH, y: 112, width: KIOSK_WIDTH, height: SCREEN.height - 112 });
    expect(frame.url).toBe("https://expo.dev/signup");
    expect(frame.inputs).toEqual([{ x: 20, y: 100, width: 350, height: 40 }]);
    // Raised above the other windows: minimised, then restored.
    const states = browser.log.filter(([m, p]) => m === "Browser.setWindowBounds" && (p.bounds as { windowState?: string }).windowState).map(([, p]) => (p.bounds as { windowState: string }).windowState);
    expect(states.slice(-2)).toEqual(["minimized", "normal"]);
    // The agent's tab was never navigated.
    expect(browser.log.some(([m, , sid]) => m === "Page.navigate" && sid === "s-agent")).toBe(false);
  });

  test("a new window elsewhere puts the kiosk back on top", async () => {
    const { k, browser } = kiosk();
    await k.open("https://expo.dev/login");
    await k.frame();
    const before = browser.log.length;
    await k.frame();
    expect(browser.log.slice(before).some(([m]) => m === "Browser.setWindowBounds")).toBe(false);
    browser.pages.push({ targetId: "agent-2", type: "page", url: "https://example.org", window: 1 });
    await k.frame();
    expect(browser.log.slice(before).filter(([m]) => m === "Browser.setWindowBounds").map(([, p]) => (p.bounds as { windowState?: string }).windowState)).toEqual(["minimized", "normal"]);
  });

  test("reuses its window for the next page", async () => {
    const { k, browser } = kiosk();
    await k.open("https://expo.dev/signup");
    await k.open("https://expo.dev/login?confirm_account=true");
    expect(browser.pages.filter((p) => p.targetId === "kiosk")).toHaveLength(1);
    expect(browser.log.find(([m]) => m === "Page.navigate")).toEqual(["Page.navigate", { url: "https://expo.dev/login?confirm_account=true" }, "s-kiosk"]);
  });

  test("follows a sign-in popup onto the kiosk rectangle, and back when it closes", async () => {
    const { k, browser } = kiosk();
    await k.open("https://expo.dev/login");
    browser.popup("https://accounts.google.com/o/oauth2", "kiosk");
    const withPopup = await k.frame();
    expect(withPopup.url).toBe("https://accounts.google.com/o/oauth2");
    expect(withPopup.rect?.x).toBe(SCREEN.width - KIOSK_WIDTH);
    browser.pages.splice(browser.pages.findIndex((p) => p.url.startsWith("https://accounts.google.com")), 1);
    expect((await k.frame()).url).toBe("https://expo.dev/login");
  });

  test("a link opened as a tab in the main window moves to a window of its own", async () => {
    const { k, browser } = kiosk();
    await k.open("https://expo.dev/login");
    browser.popup("https://expo.dev/terms", "kiosk", "agent");
    const frame = await k.frame();
    expect(frame.url).toBe("https://expo.dev/terms");
    // The person's main window was never moved.
    expect(browser.bounds.has(1)).toBe(false);
    expect(browser.pages.find((p) => p.window === 1 && p.targetId !== "agent")).toBeUndefined();
  });

  test("close shuts the window and its popups", async () => {
    const { k, browser } = kiosk();
    await k.open("https://expo.dev/login");
    browser.popup("https://appleid.apple.com/auth", "kiosk");
    await k.frame();
    await k.close();
    expect(browser.pages.map((p) => p.targetId)).toEqual(["agent"]);
    expect(await k.frame()).toEqual({ open: false });
  });

  test("falls back to a normal window when no app window appears", async () => {
    const { k, browser } = kiosk(fakeBrowser(), false);
    await k.open("https://expo.dev/signup");
    expect(browser.log.some(([m, p]) => m === "Target.createTarget" && p.newWindow === true)).toBe(true);
    expect((await k.frame()).open).toBe(true);
  });
});

describe("kiosk geometry", () => {
  test("clips the page area to the screen and moves the fields with it", () => {
    const frame = kioskFrameFrom({ sx: 890, sy: 56, ow: 390, oh: 800, iw: 390, ih: 744, url: "https://expo.dev/", inputs: [{ x: 10, y: 700, width: 100, height: 30 }], editing: false }, SCREEN);
    expect(frame.rect).toEqual({ x: 890, y: 112, width: 390, height: 688 });
    expect(frame.inputs).toEqual([{ x: 10, y: 700, width: 100, height: 30 }].filter((r) => r.y < 688));
  });

  test("fits the stream to the sheet and finds text fields under a tap", () => {
    const frame = { open: true, rect: { x: 890, y: 112, width: 390, height: 688 }, screen: SCREEN, url: "https://www.expo.dev/signup", inputs: [{ x: 20, y: 100, width: 350, height: 40 }] };
    const layout = kioskLayout(frame, 195)!;
    expect(layout).toEqual({ scale: 0.5, left: -445, top: -56, width: 640, height: 400, pageHeight: 344 });
    expect(kioskHitsInput(frame, 0.5, 20, 60)).toBe(true);
    expect(kioskHitsInput(frame, 0.5, 20, 10)).toBe(false);
    expect(kioskHost(frame)).toBe("expo.dev");
    expect(kioskHost(null)).toBe("expo.dev");
    expect(kioskLayout({ open: false }, 390)).toBeNull();
  });
});

describe("Computer browser profile", () => {
  test("Chrome does not offer to save a password typed in the sheet", async () => {
    const { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } = await import("node:fs");
    const { join } = await import("node:path");
    const { disablePasswordSaving } = await import("./desktop.ts");
    const root = join(process.env.HOME ?? ".", ".cache", "lfg", "tmp");
    mkdirSync(root, { recursive: true });
    const dir = mkdtempSync(join(root, "chrome-profile-"));
    try {
      disablePasswordSaving(join(dir, "fresh"));
      expect(JSON.parse(readFileSync(join(dir, "fresh", "Default", "Preferences"), "utf8"))).toEqual({ credentials_enable_service: false, profile: { password_manager_enabled: false } });
      // An existing profile keeps its other settings.
      mkdirSync(join(dir, "used", "Default"), { recursive: true });
      writeFileSync(join(dir, "used", "Default", "Preferences"), JSON.stringify({ homepage: "x", profile: { name: "Person" } }));
      disablePasswordSaving(join(dir, "used"));
      expect(JSON.parse(readFileSync(join(dir, "used", "Default", "Preferences"), "utf8"))).toEqual({ homepage: "x", credentials_enable_service: false, profile: { name: "Person", password_manager_enabled: false } });
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});
