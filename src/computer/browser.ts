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
import {
  BrowserInspector,
  type BrowserInspectionOptions,
  type BrowserInspectionResult,
  type BrowserInspectionStatus,
} from "./inspection.ts";

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
const inspector = new BrowserInspector(async () => await agentView());

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
  return v;
}

/**
 * Capture the agent tab's target id and foreground it, so what the agent does
 * is what the person watching the Computer tab sees.
 *
 * This cannot happen in agentView: WebView has no CDP session until the first
 * navigate() ("WebView.cdp(): no session - await navigate() first"), so the
 * target id only exists once a page is loaded. Callers invoke this after any
 * navigate, and lazily when a later tool needs the target.
 */
async function captureViewTarget(v: WebViewLike): Promise<string | null> {
  try {
    const info = (await v.cdp("Target.getTargetInfo")) as {
      targetInfo?: { targetId?: string };
    };
    viewTargetId = info?.targetInfo?.targetId ?? viewTargetId;
    if (viewTargetId) await v.cdp("Target.activateTarget", { targetId: viewTargetId });
  } catch {
    // Activation is a nicety; a working view without it still drives the page.
  }
  return viewTargetId;
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
  await inspector.cancel("navigation");
  await v.navigate(url);
  await captureViewTarget(v);
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

/**
 * A trusted Ctrl+V as raw CDP key events, in the order a real keyboard sends
 * them. modifiers 2 is Ctrl.
 *
 * The "v" goes as keyDown, NOT rawKeyDown: measured on the Computer's headful
 * Chrome, a rawKeyDown letter never reaches the page unless the X window holds
 * real OS focus (only the Control arrives), while keyDown is delivered in
 * every focus state and triggers the paste command. keyDown does not insert a
 * stray "v" -- with Ctrl held, Chrome treats it as a command, not text.
 */
export function pasteKeyEvents(): Record<string, unknown>[] {
  const ctrl = { key: "Control", code: "ControlLeft", windowsVirtualKeyCode: 17 };
  const v = { key: "v", code: "KeyV", windowsVirtualKeyCode: 86 };
  return [
    { type: "rawKeyDown", ...ctrl, nativeVirtualKeyCode: 17, modifiers: 2 },
    { type: "keyDown", ...v, nativeVirtualKeyCode: 86, modifiers: 2 },
    { type: "keyUp", ...v, nativeVirtualKeyCode: 86, modifiers: 2 },
    { type: "keyUp", ...ctrl, nativeVirtualKeyCode: 17, modifiers: 0 },
  ];
}

interface PageSession {
  call<T = unknown>(method: string, params?: Record<string, unknown>): Promise<T>;
  close(): void;
}

/**
 * A raw CDP socket to the agent tab's page target.
 *
 * WebView's own evaluate/cdp do not give a dependable page session (the
 * session exists only after navigate, and Runtime.evaluate has been observed
 * missing on it), so anything past its built-in input methods goes through
 * the target's own DevTools websocket -- the same socket any CDP client uses.
 * One socket per operation, closed on the way out, so there is no second
 * long-lived connection to keep in sync with the view's state.
 */
async function agentPageSession(): Promise<PageSession> {
  const v = await agentView();
  if (!viewTargetId) await captureViewTarget(v);
  const status = desktopStatus();
  if (!status.cdpPort) throw new Error("the computer is not running; start it first");
  const targets = (await (
    await fetch(`http://127.0.0.1:${status.cdpPort}/json`)
  ).json()) as { id: string; type: string; url: string; webSocketDebuggerUrl: string }[];
  const pages = targets.filter((t) => t.type === "page");
  const target = pages.find((t) => t.id === viewTargetId) ?? pages.find((t) => t.url === v.url);
  if (!target) throw new Error("the agent tab is gone; navigate to a page first");

  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise<void>((resolve, reject) => {
    ws.onopen = () => resolve();
    ws.onerror = () => reject(new Error("cannot reach the agent tab's DevTools socket"));
  });
  let nextId = 0;
  const pending = new Map<
    number,
    { resolve: (value: never) => void; reject: (e: Error) => void }
  >();
  ws.onmessage = (ev) => {
    const m = JSON.parse(String(ev.data)) as {
      id?: number;
      result?: unknown;
      error?: { message?: string };
    };
    if (m.id === undefined) return;
    const p = pending.get(m.id);
    if (!p) return;
    pending.delete(m.id);
    if (m.error) p.reject(new Error(m.error.message ?? "CDP error"));
    else p.resolve(m.result as never);
  };
  return {
    call<T>(method: string, params: Record<string, unknown> = {}): Promise<T> {
      return new Promise<T>((resolve, reject) => {
        const id = ++nextId;
        pending.set(id, { resolve, reject });
        ws.send(JSON.stringify({ id, method, params }));
      });
    },
    close() {
      try {
        ws.close();
      } catch {}
    },
  };
}

/**
 * Paste as the OS means it: the text goes onto the desktop's X clipboard and
 * a trusted Ctrl+V delivers it to the agent tab, so paste handlers fire and
 * beforeinput arrives as insertFromPaste -- the whole difference from
 * browserType. The text stays on the clipboard, so a person on the Computer
 * tab can paste it again too.
 *
 * The clipboard is set with xclip, not Chrome's clipboard API. Measured on
 * this stack: navigator.clipboard.writeText hangs without a CDP permission
 * grant, rejects when the X window is unfocused, and the grant that unblocks
 * it also lets every page READ a shared desktop's clipboard until reset.
 * xclip needs none of that and works on plain-http pages too.
 */
export async function browserPaste(text: string): Promise<void> {
  const v = await agentView();
  await focusAgentTab();
  await setDesktopClipboard(text);
  const page = await agentPageSession();
  try {
    for (const event of pasteKeyEvents()) await page.call("Input.dispatchKeyEvent", event);
  } finally {
    page.close();
  }
}

/** Put text on the desktop's CLIPBOARD selection. xclip daemonizes to serve
 *  it until something else takes the selection, which is exactly clipboard
 *  semantics. */
async function setDesktopClipboard(text: string): Promise<void> {
  const display = desktopStatus().display;
  if (!display) throw new Error("the computer is not running; start it first");
  if (!Bun.which("xclip")) {
    throw new Error(
      "xclip is not installed, so the desktop clipboard cannot be set. " +
        "Install it with: sudo apt-get install -y xclip",
    );
  }
  const proc = Bun.spawn(["xclip", "-selection", "clipboard"], {
    stdin: "pipe",
    stdout: "ignore",
    stderr: "pipe",
    env: { ...process.env, DISPLAY: display },
  });
  proc.stdin.write(text);
  proc.stdin.end();
  const exit = await proc.exited;
  if (exit !== 0) {
    const stderr = await new Response(proc.stderr).text();
    throw new Error(`xclip failed (${exit}): ${stderr.trim() || "no output"}`);
  }
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

export function browserInspectionStatus(): BrowserInspectionStatus {
  return inspector.status();
}

export async function browserInspectElement(
  options: BrowserInspectionOptions = {},
): Promise<BrowserInspectionResult> {
  await focusAgentTab();
  return await inspector.inspect(options);
}

export async function cancelBrowserInspection(reason?: string): Promise<boolean> {
  return await inspector.cancel(reason);
}

/** Drop the agent's view. Does not touch the desktop or the person's tabs. */
export function closeAgentView(): void {
  void inspector.cancel("browser closed");
  try {
    view?.close();
  } catch {}
  view = null;
  viewTargetId = null;
}
