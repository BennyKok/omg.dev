// The Computer kiosk: one page in a phone-width app window, for a person to
// use from a sheet in omg. See packages/protocol/src/computer-kiosk.ts.
//
// Why a separate app window and not the agent's tab:
//
//  - An app window (`chrome --app=URL`) has no tab strip and no address bar,
//    so nearly all of its height is page. The desktop is only 800 px tall.
//  - It is 390 px wide, so the site lays out for a phone, the size of the
//    sheet it appears in. No emulation is needed, and input maps 1:1.
//  - The agent keeps its own tab. An agent that drives the browser does not
//    navigate the page the person is typing a password into.
//
// The client crops the normal Computer stream (noVNC over /api/computer) to
// the rectangle `kioskFrame()` reports. Nothing new streams.
//
// Popups (Sign in with Google or Apple) open in their own window. Each one the
// kiosk page opens is moved onto the kiosk rectangle and becomes the page the
// sheet shows, until it closes.
//
// This module is the single owner of the kiosk window and its popups.

import { spawn } from "node:child_process";
import type { KioskFrame, KioskRect } from "../../packages/protocol/src/computer-kiosk.ts";
import { cdpWebSocketUrl, chromePath, desktopConfig } from "./desktop.ts";

/** An iPhone 15 is 390 CSS pixels wide. */
export const KIOSK_WIDTH = 390;

export interface Cdp {
  send(method: string, params?: Record<string, unknown>, sessionId?: string): Promise<any>;
  close(): void;
}

export interface KioskDeps {
  /** A browser-level DevTools connection, or null when the desktop is down. */
  cdp(): Promise<Cdp | null>;
  /** Open `url` in a new app window of the desktop's browser. */
  launchApp(url: string): void;
  /** The desktop size in pixels. */
  screen(): { width: number; height: number } | null;
  sleep?(ms: number): Promise<void>;
  /** How long to wait for the app window to appear. */
  launchWaitMs?: number;
}

type TargetInfo = { targetId: string; type: string; url: string; openerId?: string };

/** Everything a page reports about itself for the frame. */
type PageGeometry = {
  sx: number; sy: number; ow: number; oh: number; iw: number; ih: number;
  url: string; inputs: KioskRect[]; editing: boolean;
};

const GEOMETRY = `(() => {
  const q = 'input:not([type=hidden]):not([type=checkbox]):not([type=radio]):not([type=submit]):not([type=button]):not([type=image]):not([type=reset]):not([type=file]):not([type=range]):not([type=color]),textarea,[contenteditable]:not([contenteditable=false])';
  const inputs = [];
  for (const el of document.querySelectorAll(q)) {
    const b = el.getBoundingClientRect();
    if (b.width > 0 && b.height > 0 && b.bottom > 0 && b.top < innerHeight && b.right > 0 && b.left < innerWidth) inputs.push({ x: b.left, y: b.top, width: b.width, height: b.height });
    if (inputs.length >= 40) break;
  }
  const a = document.activeElement;
  const editing = !!a && (a.isContentEditable || a.tagName === 'TEXTAREA' || a.tagName === 'IFRAME' ||
    (a.tagName === 'INPUT' && !/^(checkbox|radio|submit|button|image|reset|file|hidden|range|color)$/i.test(a.type)));
  return { sx: screenX, sy: screenY, ow: outerWidth, oh: outerHeight, iw: innerWidth, ih: innerHeight, url: location.href, inputs, editing };
})()`;

/**
 * The page area of a window on the desktop, clipped to the screen, and the
 * text fields in it relative to that area.
 * @internal exported for tests.
 */
export function kioskFrameFrom(g: PageGeometry, screen: { width: number; height: number }): KioskFrame {
  // Chrome draws its own frame. What sits between the outer and the inner
  // size is the frame's top part (title strip, info bars), with thin borders
  // at the sides and none at the bottom.
  const side = Math.max(0, Math.round((g.ow - g.iw) / 2));
  const x = g.sx + side;
  const y = g.sy + Math.max(0, g.oh - g.ih - side);
  const x0 = Math.max(0, x);
  const y0 = Math.max(0, y);
  const x1 = Math.min(screen.width, x + g.iw);
  const y1 = Math.min(screen.height, y + g.ih);
  if (x1 <= x0 || y1 <= y0) return { open: false };
  const dx = x0 - x;
  const dy = y0 - y;
  return {
    open: true,
    rect: { x: x0, y: y0, width: x1 - x0, height: y1 - y0 },
    screen: { ...screen },
    url: g.url,
    inputs: g.inputs
      .map((r) => ({ x: Math.round(r.x - dx), y: Math.round(r.y - dy), width: Math.round(r.width), height: Math.round(r.height) }))
      .filter((r) => r.x + r.width > 0 && r.y + r.height > 0 && r.x < x1 - x0 && r.y < y1 - y0),
    editing: g.editing,
  };
}

export function createKiosk(deps: KioskDeps) {
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  /** The kiosk page, then the popups it opened, newest last. */
  let stack: string[] = [];
  const sessions = new Map<string, string>();
  /** Pages that are not the kiosk's. A new one can open on top of it. */
  let others = new Set<string>();

  async function pages(c: Cdp): Promise<TargetInfo[]> {
    const found = await c.send("Target.getTargets") as { targetInfos?: TargetInfo[] };
    return (found.targetInfos ?? []).filter((t) => t.type === "page");
  }

  async function session(c: Cdp, targetId: string): Promise<string> {
    const known = sessions.get(targetId);
    if (known) return known;
    const attached = await c.send("Target.attachToTarget", { targetId, flatten: true }) as { sessionId: string };
    sessions.set(targetId, attached.sessionId);
    return attached.sessionId;
  }

  /** Put a window on the kiosk rectangle, at the right edge of the desktop, and raise it. */
  async function place(c: Cdp, targetId: string): Promise<void> {
    const screen = deps.screen();
    if (!screen) return;
    const { windowId } = await c.send("Browser.getWindowForTarget", { targetId }) as { windowId: number };
    // A maximised or minimised window ignores new bounds, and the state must
    // change in a call of its own.
    await c.send("Browser.setWindowBounds", { windowId, bounds: { windowState: "normal" } }).catch(() => {});
    await c.send("Browser.setWindowBounds", { windowId, bounds: { left: screen.width - KIOSK_WIDTH, top: 0, width: KIOSK_WIDTH, height: screen.height } });
    const sid = await session(c, targetId);
    // Scroll by touch in the sheet, so a desktop scrollbar only takes width.
    await c.send("Emulation.setScrollbarsHidden", { hidden: true }, sid).catch(() => {});
    await sleep(150);
    await raise(c, targetId);
  }

  /**
   * The window manager keeps a window below the top panel, a moment after the
   * move. Shorten the window so its bottom edge is the bottom of the screen
   * and no part of the page (a cookie bar, a Continue button) is off screen.
   */
  async function fit(c: Cdp, windowId: number, screen: { width: number; height: number }): Promise<void> {
    const { bounds } = await c.send("Browser.getWindowBounds", { windowId }).catch(() => ({ bounds: {} })) as { bounds: { left?: number; top?: number; width?: number; height?: number } };
    const top = bounds.top ?? 0;
    const want = { left: screen.width - KIOSK_WIDTH, top, width: KIOSK_WIDTH, height: Math.max(200, screen.height - top) };
    if (bounds.left === want.left && bounds.width === want.width && bounds.height === want.height) return;
    await c.send("Browser.setWindowBounds", { windowId, bounds: want }).catch(() => {});
  }

  /**
   * Bring a kiosk window above every other window. The sheet shows a part of
   * the screen, so anything on top of the kiosk would show in the sheet.
   *
   * Target.activateTarget alone does not do it: xfwm's focus-stealing
   * prevention keeps an app-requested activation below the focused window
   * (verified on a Computer on 2026-09-29). A window the window manager maps
   * again goes on top, so minimise and restore it.
   */
  async function raise(c: Cdp, targetId: string): Promise<void> {
    try {
      const { windowId } = await c.send("Browser.getWindowForTarget", { targetId }) as { windowId: number };
      await c.send("Browser.setWindowBounds", { windowId, bounds: { windowState: "minimized" } });
      await sleep(120);
      await c.send("Browser.setWindowBounds", { windowId, bounds: { windowState: "normal" } });
      // A restored window can come back at its old size.
      const screen = deps.screen();
      if (screen) await fit(c, windowId, screen);
    } catch { /* A window that cannot move still shows. */ }
    await c.send("Target.activateTarget", { targetId }).catch(() => {});
  }

  /** Forget the kiosk. */
  function reset(): void {
    stack = [];
    sessions.clear();
    others = new Set();
  }

  /**
   * Adopt pages the kiosk opened. A popup has a window of its own and moves
   * onto the kiosk rectangle. A plain link opened as a tab in the person's
   * main window cannot move without moving that window, so it reopens in a
   * window of its own and the tab closes.
   */
  async function adopt(c: Cdp, list: TargetInfo[]): Promise<void> {
    const ours = new Set(stack);
    for (const t of list) {
      if (ours.has(t.targetId) || !t.openerId || !ours.has(t.openerId)) continue;
      const { windowId } = await c.send("Browser.getWindowForTarget", { targetId: t.targetId }) as { windowId: number };
      let shared = false;
      for (const other of list) {
        if (other.targetId === t.targetId || ours.has(other.targetId)) continue;
        const w = await c.send("Browser.getWindowForTarget", { targetId: other.targetId }).catch(() => null) as { windowId?: number } | null;
        if (w?.windowId === windowId) { shared = true; break; }
      }
      let id = t.targetId;
      if (shared) {
        const created = await c.send("Target.createTarget", { url: t.url || "about:blank", newWindow: true }) as { targetId: string };
        await c.send("Target.closeTarget", { targetId: t.targetId }).catch(() => {});
        id = created.targetId;
      }
      stack.push(id);
      ours.add(id);
      await place(c, id);
    }
  }

  async function open(url: string): Promise<{ url: string }> {
    const c = await deps.cdp();
    if (!c) throw new Error("the computer is not running");
    const list = await pages(c);
    const alive = new Set(list.map((t) => t.targetId));
    const main = stack[0];
    if (main && alive.has(main)) {
      // Reuse the window. Popups from the last page have no job any more.
      for (const id of stack.slice(1)) await c.send("Target.closeTarget", { targetId: id }).catch(() => {});
      stack = [main];
      const sid = await session(c, main);
      await c.send("Page.navigate", { url }, sid);
      await raise(c, main);
      return { url };
    }
    reset();
    const before = new Set(list.map((t) => t.targetId));
    deps.launchApp(url);
    let found: string | null = null;
    const deadline = Date.now() + (deps.launchWaitMs ?? 8_000);
    while (!found && Date.now() < deadline) {
      await sleep(200);
      found = (await pages(c)).find((t) => !before.has(t.targetId))?.targetId ?? null;
    }
    if (!found) {
      // No app window (an unusual browser build). A normal window still
      // works: the sheet crops its tab strip and address bar away.
      found = (await c.send("Target.createTarget", { url, newWindow: true }) as { targetId: string }).targetId;
    }
    stack = [found];
    await place(c, found);
    others = new Set((await pages(c)).map((t) => t.targetId).filter((id) => id !== found));
    return { url };
  }

  async function frame(): Promise<KioskFrame> {
    if (!stack.length) return { open: false };
    const c = await deps.cdp();
    const screen = deps.screen();
    if (!c || !screen) { reset(); return { open: false }; }
    const list = await pages(c);
    const alive = new Set(list.map((t) => t.targetId));
    if (!alive.has(stack[0]!)) { reset(); return { open: false }; }
    for (const id of stack) if (!alive.has(id)) sessions.delete(id);
    stack = stack.filter((id) => alive.has(id));
    await adopt(c, list);
    const top = stack[stack.length - 1]!;
    // Another page opened (an agent's tab, a new window): put the kiosk back on top.
    const now = new Set(list.map((t) => t.targetId).filter((id) => !stack.includes(id)));
    const opened = [...now].some((id) => !others.has(id));
    others = now;
    if (opened) await raise(c, top);
    const sid = await session(c, top);
    const evaluated = await c.send("Runtime.evaluate", { expression: GEOMETRY, returnByValue: true }, sid) as { result?: { value?: PageGeometry } };
    const g = evaluated.result?.value;
    return g ? kioskFrameFrom(g, screen) : { open: false };
  }

  async function close(): Promise<void> {
    if (!stack.length) return;
    const ids = [...stack].reverse();
    reset();
    const c = await deps.cdp().catch(() => null);
    if (!c) return;
    for (const targetId of ids) await c.send("Target.closeTarget", { targetId }).catch(() => {});
  }

  return { open, frame, close, isOpen: () => stack.length > 0 };
}

/** A minimal browser-level DevTools client. One per endpoint, reopened when it drops. */
function connectCdp(url: string): Promise<Cdp> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    let next = 0;
    const pending = new Map<number, { resolve(v: unknown): void; reject(e: Error): void }>();
    const cdp: Cdp & { closed: boolean } = {
      closed: false,
      send(method, params = {}, sessionId) {
        if (cdp.closed) return Promise.reject(new Error("DevTools connection closed"));
        const id = ++next;
        return new Promise((res, rej) => {
          const timer = setTimeout(() => { pending.delete(id); rej(new Error(`${method} timed out`)); }, 15_000);
          pending.set(id, {
            resolve: (v) => { clearTimeout(timer); res(v); },
            reject: (e) => { clearTimeout(timer); rej(e); },
          });
          ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
        });
      },
      close() { ws.close(); },
    };
    ws.onopen = () => resolve(cdp);
    ws.onerror = () => reject(new Error("cannot reach the desktop browser's DevTools endpoint"));
    ws.onclose = () => {
      cdp.closed = true;
      for (const p of pending.values()) p.reject(new Error("DevTools connection closed"));
      pending.clear();
      if (live?.cdp === cdp) live = null;
    };
    ws.onmessage = (event) => {
      let message: { id?: number; result?: unknown; error?: { message?: string } };
      try { message = JSON.parse(String(event.data)); } catch { return; }
      if (typeof message.id !== "number") return;
      const p = pending.get(message.id);
      if (!p) return;
      pending.delete(message.id);
      if (message.error) p.reject(new Error(message.error.message ?? "DevTools error"));
      else p.resolve(message.result ?? {});
    };
  });
}

let live: { url: string; cdp: Cdp & { closed?: boolean } } | null = null;

async function liveCdp(): Promise<Cdp | null> {
  const url = await cdpWebSocketUrl();
  if (!url) return null;
  if (live && live.url === url && !live.cdp.closed) return live.cdp;
  live?.cdp.close();
  const cdp = await connectCdp(url);
  live = { url, cdp };
  return cdp;
}

function liveKioskDeps(): KioskDeps {
  return {
    cdp: liveCdp,
    screen: () => {
      const config = desktopConfig();
      return config ? { width: config.width, height: config.height } : null;
    },
    launchApp(url) {
      const config = desktopConfig();
      const chrome = chromePath();
      if (!config || !chrome) return;
      // The running browser owns this profile, so this process only hands it
      // the URL and exits. The new window belongs to the desktop's browser.
      const child = spawn(chrome, [`--user-data-dir=${config.profileDir}`, `--app=${url}`], {
        env: { ...process.env, DISPLAY: `:${config.display}` },
        stdio: "ignore",
        detached: true,
      });
      child.on("error", () => {});
      child.unref();
    },
  };
}

let kiosk: ReturnType<typeof createKiosk> | null = null;

/** The kiosk on this box's desktop. */
export function computerKiosk(): ReturnType<typeof createKiosk> {
  kiosk ??= createKiosk(liveKioskDeps());
  return kiosk;
}
