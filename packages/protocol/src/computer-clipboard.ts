/** Clipboard behavior shared by every RFB viewer. Text stays in this connection. */
export interface ClipboardRfb extends EventTarget {
  viewOnly: boolean;
  sendKey(keysym: number, code: string | null, down?: boolean): void;
  clipboardPasteFrom(text: string): void;
}

export interface ComputerClipboardOptions {
  notice(message: string): void;
  focusKeyboard(): void;
  takeControl?(): void;
  readText?(): Promise<string>;
  writeText?(text: Promise<string>): Promise<void>;
  readRemoteText?(): Promise<string>;
  setRemoteText?(text: string): Promise<void>;
  copyTimeoutMs?: number;
}

function isMissingClipboardRoute(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const e = error as { status?: number; statusCode?: number; message?: string };
  return e.status === 404 || e.statusCode === 404 || /\b404\b/.test(e.message ?? "");
}

/** Call write during the gesture, before waiting for the remote clipboard (Safari). */
export function writeBrowserClipboard(text: Promise<string>): Promise<void> {
  if (typeof ClipboardItem !== "undefined" && navigator.clipboard?.write) {
    return navigator.clipboard.write([new ClipboardItem({
      "text/plain": text.then(value => new Blob([value], { type: "text/plain" })),
    })]);
  }
  return text.then(value => navigator.clipboard.writeText(value));
}

export function attachComputerClipboard(rfb: ClipboardRfb, root: HTMLElement, options: ComputerClipboardOptions) {
  let remote: string | null = null;
  let disposed = false;
  let devicePastePending = false;
  const pending = new Set<(text: string | null) => void>();
  const control = () => { rfb.viewOnly = false; options.takeControl?.(); };
  const shortcut = (key: "c" | "x" | "v", shift = false) => {
    control();
    // A Mac's Command key may already have reached noVNC as Linux Super.
    rfb.sendKey(0xffe7, "MetaLeft", false);
    rfb.sendKey(0xffe8, "MetaRight", false);
    rfb.sendKey(0xffeb, "MetaLeft", false);
    rfb.sendKey(0xffec, "MetaRight", false);
    rfb.sendKey(0xffe3, "ControlLeft", true);
    if (shift) rfb.sendKey(0xffe1, "ShiftLeft", true);
    rfb.sendKey(key.charCodeAt(0), `Key${key.toUpperCase()}`, true);
    rfb.sendKey(key.charCodeAt(0), `Key${key.toUpperCase()}`, false);
    if (shift) rfb.sendKey(0xffe1, "ShiftLeft", false);
    rfb.sendKey(0xffe3, "ControlLeft", false);
  };
  const received = (event: Event) => {
    const text = (event as CustomEvent<{ text?: unknown }>).detail?.text;
    if (typeof text !== "string") return;
    remote = text;
    for (const resolve of [...pending]) resolve(text);
  };
  rfb.addEventListener("clipboard", received);

  function selection(cut = false, shift = false): Promise<string> {
    return new Promise((resolve, reject) => {
      const done = (text: string | null) => {
        clearTimeout(timer);
        pending.delete(done);
        if (disposed) reject(new Error("Not connected"));
        else if (text || options.readRemoteText) resolve(text ?? "");
        else reject(new Error("Select text on the Computer first"));
      };
      const timer = setTimeout(() => done(remote), options.copyTimeoutMs ?? 1000);
      pending.add(done);
      shortcut(cut ? "x" : "c", shift);
    });
  }

  async function copy(cut = false, shift = false): Promise<void> {
    if (disposed) return;
    const text = selection(cut, shift);
    // A denied write must not leave a rejected selection promise unhandled.
    void text.catch(() => {});
    try {
      const exactText = options.readRemoteText ? text.then(async legacy => {
        try {
          const exact = await options.readRemoteText!();
          if (!exact) throw new Error("Select text on the Computer first");
          return exact;
        } catch (error) {
          if (isMissingClipboardRoute(error) && legacy) return legacy;
          throw error;
        }
      }) : text;
      void exactText.catch(() => {});
      await (options.writeText ?? writeBrowserClipboard)(exactText);
      if (!disposed) options.notice(cut ? "Cut and copied" : "Copied");
    } catch (error) {
      if (!disposed) options.notice(error instanceof Error && /Select text|Not connected/.test(error.message)
        ? error.message : "Copy was blocked by this device");
    }
  }

  async function paste(text: string, shift = false): Promise<boolean> {
    if (disposed) return false;
    if (!text) { options.notice("Your clipboard is empty"); return false; }
    control();
    try {
      if (options.setRemoteText) {
        try { await options.setRemoteText(text); }
        catch (error) {
          if (!isMissingClipboardRoute(error)) throw error;
          if ([...text].some(ch => ch.codePointAt(0)! > 255)) {
            options.notice("Update this Computer to paste Unicode text");
            return false;
          }
          rfb.clipboardPasteFrom(text);
        }
      } else rfb.clipboardPasteFrom(text);
      if (disposed) return false;
      shortcut("v", shift);
    } catch {
      if (!disposed) options.notice("Could not update the Computer clipboard");
      return false;
    }
    options.notice("Pasted");
    return true;
  }

  async function pasteFromDevice(): Promise<void> {
    if (disposed || devicePastePending) return;
    devicePastePending = true;
    try {
      const text = await (options.readText ?? (() => navigator.clipboard.readText()))();
      if (!disposed) await paste(text);
    } catch {
      if (disposed) return;
      options.focusKeyboard();
      options.notice("Use the keyboard's Paste menu");
    } finally { devicePastePending = false; }
  }

  const pasted = (event: Event) => {
    const e = event as ClipboardEvent;
    const text = e.clipboardData?.getData("text/plain") ?? "";
    if (!text) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    void paste(text);
    // preventDefault keeps the keyboard pad intact and prevents duplicate input.
  };
  const copied = (event: Event) => {
    event.preventDefault();
    event.stopImmediatePropagation();
    void copy(event.type === "cut");
  };
  const keydown = (event: Event) => {
    const e = event as KeyboardEvent;
    if ((!e.ctrlKey && !e.metaKey) || e.altKey || e.isComposing) return;
    const key = e.key.toLowerCase();
    if (key !== "c" && key !== "x" && key !== "v") return;
    e.stopImmediatePropagation();
    if (key === "v" && !options.readText) {
      // Let the OS deliver its paste event to a real editable field, even
      // when readText is denied. Do not send Ctrl+V before the text arrives.
      options.focusKeyboard();
      return;
    }
    e.preventDefault();
    if (key === "v") void pasteFromDevice();
    else void copy(key === "x", e.shiftKey);
  };
  root.addEventListener("paste", pasted, true);
  root.addEventListener("copy", copied, true);
  root.addEventListener("cut", copied, true);
  root.addEventListener("keydown", keydown, true);
  return {
    copy, paste, pasteFromDevice,
    dispose() {
      disposed = true;
      remote = null;
      for (const resolve of [...pending]) resolve(null);
      rfb.removeEventListener("clipboard", received);
      root.removeEventListener("paste", pasted, true);
      root.removeEventListener("copy", copied, true);
      root.removeEventListener("cut", copied, true);
      root.removeEventListener("keydown", keydown, true);
    },
  };
}

export type ComputerClipboard = ReturnType<typeof attachComputerClipboard>;

/** WebKit can swallow click after a cancelled mouse press. Act on the pointer
 * gesture, retain input focus, and ignore its following compatibility click. */
const clipboardPresses = new WeakSet<EventTarget>();
export function clipboardButtonHandlers(action: () => void) {
  return {
    onPointerDown(event: { preventDefault(): void; currentTarget: EventTarget; pointerType?: string }) {
      event.preventDefault();
      if (event.pointerType === "touch" || event.pointerType === "pen") return;
      clipboardPresses.add(event.currentTarget);
      action();
    },
    onPointerUp(event: { preventDefault(): void; currentTarget: EventTarget; pointerType?: string }) {
      if (event.pointerType !== "touch" && event.pointerType !== "pen") return;
      // Touch user activation begins at release; protected clipboard APIs
      // must run here, rather than during the unactivated initial press.
      event.preventDefault();
      clipboardPresses.add(event.currentTarget);
      action();
    },
    onClick(event: { currentTarget: EventTarget; detail?: number }) {
      const pressed = clipboardPresses.has(event.currentTarget);
      clipboardPresses.delete(event.currentTarget);
      if (pressed && event.detail !== 0) return;
      action();
    },
  };
}
