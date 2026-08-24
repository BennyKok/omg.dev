// Agent-facing control of the browser running on the Computer's desktop.
//
// This is a thin layer over Bun.WebView (built into Bun 1.3.12+). On Linux
// Bun.WebView drives Chrome over the DevTools Protocol, so we get navigation,
// screenshots, and -- the part that matters -- synthetic input that arrives as
// NATIVE, TRUSTED events (`event.isTrusted === true`), plus actionability
// waiting: `click(selector)` waits for the element to be attached, visible,
// stable for two frames, and not obscured. That is the reliability layer we
// would otherwise have to write by hand on top of raw CDP, and it is strictly
// better than throwing events at an X server with xdotool and hoping.
//
// Two rules learned the hard way, both load-bearing:
//
//  1. ATTACH, never spawn. `new Bun.WebView()` with no backend spawns its own
//     headless Chrome (the user agent then says "HeadlessChrome"), and passing
//     `headless: false` throws. We pass `backend: {type: "chrome", url}` to
//     attach to the headful Chrome desktop.ts already launched on the display.
//
//  2. Do NOT use `await using`, and do not close the view between calls.
//     Disposing closes the tab Bun.WebView created -- so the human watching the
//     screen sees the agent's tab vanish the moment it finishes. We hold one
//     long-lived view and activate its target so the tab is the visible one.

import { cdpWebSocketUrl, desktopStatus } from "./desktop.ts";

// Bun.WebView is newer than the bundled bun-types in some checkouts, and the
// API is still marked experimental upstream. Keep the surface we use behind one
// local interface so a type bump upstream cannot break the build here.
interface WebViewLike {
  navigate(url: string): Promise<void>;
  evaluate(script: string): Promise<unknown>;
  screenshot(opts?: { format?: "png" | "jpeg" | "webp" }): Promise<Blob>;
  click(x: number, y: number, opts?: unknown): Promise<void>;
  click(selector: string, opts?: unknown): Promise<void>;
  type(text: string): Promise<void>;
  press(key: string, opts?: unknown): Promise<void>;
  scroll(dx: number, dy: number): Promise<void>;
  cdp(method: string, params?: unknown): Promise<unknown>;
  close(): void;
  /** Current address and document title. Properties, not methods. */
  readonly url: string;
  readonly title: string;
}

let view: WebViewLike | null = null;
let viewTargetId: string | null = null;

function webViewCtor(): (new (opts: unknown) => WebViewLike) | null {
  const ctor = (Bun as unknown as { WebView?: new (opts: unknown) => WebViewLike }).WebView;
  return typeof ctor === "function" ? ctor : null;
}

/** True when this Bun build exposes Bun.WebView. */
export function browserControlAvailable(): boolean {
  return webViewCtor() !== null;
}

/**
 * The shared agent tab, attached to the desktop's Chrome. Created on first use
 * and reused afterwards, so the agent works in ONE visible tab rather than
 * littering the window with a new tab per call.
 */
export async function agentView(): Promise<WebViewLike> {
  if (view) return view;

  const Ctor = webViewCtor();
  if (!Ctor) {
    throw new Error("this Bun build has no Bun.WebView (needs Bun 1.3.12 or later)");
  }
  const status = desktopStatus();
  if (!status.running) throw new Error("the computer is not running; start it first");

  const url = await cdpWebSocketUrl();
  if (!url) throw new Error("cannot reach the desktop browser's DevTools endpoint");

  const v = new Ctor({
    backend: { type: "chrome", url },
    width: status.width,
    height: status.height - 40,
  });
  view = v;

  // Foreground the tab we just created, so what the agent does is what the
  // person watching the Computer tab sees. Without this the agent works in a
  // background tab and the screen never changes.
  try {
    const info = (await v.cdp("Target.getTargetInfo")) as {
      targetInfo?: { targetId?: string };
    };
    viewTargetId = info?.targetInfo?.targetId ?? null;
    if (viewTargetId) await v.cdp("Target.activateTarget", { targetId: viewTargetId });
  } catch {
    // Activation is a nicety; a working view without it still drives the page.
  }
  return v;
}

/** Bring the agent's tab back to the front (a person may have switched tabs). */
export async function focusAgentTab(): Promise<void> {
  if (!view || !viewTargetId) return;
  try {
    await view.cdp("Target.activateTarget", { targetId: viewTargetId });
  } catch {}
}

export async function browserNavigate(url: string): Promise<{ url: string; title: string }> {
  const v = await agentView();
  await focusAgentTab();
  await v.navigate(url);
  return { url: v.url, title: v.title };
}

export async function browserClick(target: number | string, y?: number): Promise<void> {
  const v = await agentView();
  await focusAgentTab();
  if (typeof target === "number") await v.click(target, y ?? 0);
  else await v.click(target);
}

export async function browserType(text: string): Promise<void> {
  const v = await agentView();
  await focusAgentTab();
  await v.type(text);
}

export async function browserPress(key: string): Promise<void> {
  const v = await agentView();
  await focusAgentTab();
  await v.press(key);
}

export async function browserScreenshot(): Promise<Blob> {
  const v = await agentView();
  return await v.screenshot({ format: "png" });
}

/**
 * Read the page as text. `evaluate` wraps its argument as `await (<expr>)`, so
 * the script must be a single EXPRESSION -- a statement with a semicolon is a
 * syntax error. Hence the IIFE.
 */
export async function browserReadText(max = 4000): Promise<string> {
  const v = await agentView();
  const out = await v.evaluate(`(() => document.body?.innerText ?? "")()`);
  return String(out ?? "").slice(0, max);
}

/** Drop the agent's view. Does not touch the desktop or the person's tabs. */
export function closeAgentView(): void {
  try {
    view?.close();
  } catch {}
  view = null;
  viewTargetId = null;
}
