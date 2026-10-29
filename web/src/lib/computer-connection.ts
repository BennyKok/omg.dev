// One live connection to the Computer's screen, shared by every view of it.
//
// The screen shows in three places: the Computer tab, inline in a chat
// transcript, and the full-screen view opened from the transcript. Each used to
// own its own noVNC connection, so anything that remounted a view dropped the
// stream and opened a new one: opening full screen (the inline view unmounts
// and the full view mounts), the chat virtualizer scrolling the row out and
// back, or a parent re-keying the row. Every one of those showed "Connecting to
// the screen…" again.
//
// Now this module owns the connection. A view `hold`s it with the element it
// wants the picture in; the canvas moves to the newest holder, and back to an
// older one when the newest lets go. A canvas keeps its pixels when it moves,
// and noVNC's ResizeObserver rescales it to the new frame. When no view holds
// the screen, the connection stays up for `RELEASE_GRACE_MS` and closes only if
// no view comes back in that time.

import type RFB from "@novnc/novnc";

/** How long the screen stays connected after the last view lets go. */
export const RELEASE_GRACE_MS = 30_000;

export type ComputerConnectionPhase = "idle" | "connecting" | "live";

export interface ComputerConnectionSnapshot {
  phase: ComputerConnectionPhase;
  error: string | null;
  /** The live RFB client, once the connection exists. */
  rfb: RFB | null;
  /** Watch only. One connection, so one mode for every view. */
  viewOnly: boolean;
}

export interface ComputerConnectionDeps {
  /** Open the RFB client inside `target`. */
  open(target: HTMLElement): Promise<RFB>;
  /** Changes when the app points at a different Computer. */
  generation(): number;
  createHost(): HTMLElement;
  /**
   * The picture just moved to another view or off the page. noVNC draws the
   * remote cursor on touch devices as a fixed canvas on `document.body`, not
   * inside the picture, so it stays where the old view left it unless hidden.
   */
  moved?(host: HTMLElement): void;
  graceMs?: number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (timer: unknown) => void;
}

export interface ComputerConnection {
  /**
   * Show the screen in `slot` until the returned release is called. Holding
   * keeps the connection; it does not open one (see `connect`).
   */
  hold(slot: HTMLElement): () => void;
  /** Open the connection if there is none. Safe to call repeatedly. */
  connect(): Promise<void>;
  /** Close now, whoever holds it. The Reconnect button uses this. */
  disconnect(): void;
  setViewOnly(viewOnly: boolean): void;
  subscribe(listener: () => void): () => void;
  getSnapshot(): ComputerConnectionSnapshot;
}

export function createComputerConnection(deps: ComputerConnectionDeps): ComputerConnection {
  const graceMs = deps.graceMs ?? RELEASE_GRACE_MS;
  const setTimer = deps.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
  const clearTimer = deps.clearTimer ?? ((t) => clearTimeout(t as ReturnType<typeof setTimeout>));

  let snapshot: ComputerConnectionSnapshot = { phase: "idle", error: null, rfb: null, viewOnly: false };
  const listeners = new Set<() => void>();
  /** Holders, oldest first. The last one shows the picture. */
  const slots: HTMLElement[] = [];
  let host: HTMLElement | null = null;
  let releaseTimer: unknown = null;
  /** Bumped on every disconnect, so a connect that was in flight is dropped. */
  let attempt = 0;
  let generation = deps.generation();

  const set = (patch: Partial<ComputerConnectionSnapshot>) => {
    snapshot = { ...snapshot, ...patch };
    for (const listener of [...listeners]) listener();
  };

  const hostElement = () => (host ??= deps.createHost());

  /** Put the picture in the newest holder, or take it off the page. */
  const place = () => {
    const el = hostElement();
    const top = slots[slots.length - 1];
    const from = el.parentElement;
    if (top) {
      if (from !== top) top.appendChild(el);
    } else {
      el.remove();
    }
    if (from && from !== top) deps.moved?.(el);
  };

  const cancelRelease = () => {
    if (releaseTimer !== null) clearTimer(releaseTimer);
    releaseTimer = null;
  };

  const disconnect = () => {
    cancelRelease();
    attempt += 1;
    const rfb = snapshot.rfb;
    // Clear first: noVNC fires "disconnect" synchronously from here.
    set({ rfb: null, phase: "idle" });
    try { rfb?.disconnect(); } catch {}
  };

  // A different Computer. Its screen is not this one.
  const checkGeneration = () => {
    const now = deps.generation();
    if (now === generation) return;
    generation = now;
    disconnect();
  };

  const connect = async () => {
    checkGeneration();
    if (snapshot.rfb || snapshot.phase === "connecting") return;
    const mine = ++attempt;
    set({ phase: "connecting", error: null });
    try {
      const rfb = await deps.open(hostElement());
      if (mine !== attempt) {
        try { rfb.disconnect(); } catch {}
        return;
      }
      rfb.viewOnly = snapshot.viewOnly;
      rfb.addEventListener("connect", () => {
        if (snapshot.rfb === rfb) set({ phase: "live" });
      });
      rfb.addEventListener("disconnect", () => {
        if (snapshot.rfb === rfb) set({ rfb: null, phase: "idle" });
      });
      set({ rfb });
    } catch (e) {
      if (mine !== attempt) return;
      set({ phase: "idle", error: e instanceof Error ? e.message : "could not open the screen" });
    }
  };

  const hold = (slot: HTMLElement) => {
    checkGeneration();
    cancelRelease();
    slots.push(slot);
    place();
    let released = false;
    return () => {
      if (released) return;
      released = true;
      const at = slots.lastIndexOf(slot);
      if (at >= 0) slots.splice(at, 1);
      place();
      if (slots.length === 0 && (snapshot.rfb || snapshot.phase === "connecting")) {
        releaseTimer = setTimer(() => {
          releaseTimer = null;
          if (slots.length === 0) disconnect();
        }, graceMs);
      }
    };
  };

  return {
    hold,
    connect,
    disconnect,
    setViewOnly(viewOnly) {
      if (snapshot.rfb) snapshot.rfb.viewOnly = viewOnly;
      if (snapshot.viewOnly !== viewOnly) set({ viewOnly });
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    getSnapshot: () => snapshot,
  };
}
