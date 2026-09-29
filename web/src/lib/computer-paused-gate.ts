// The one owner of "the Computer behind this transport is asleep, stop asking".
//
// A hosted Computer that the omg.dev control plane has paused wakes only on a
// presence lease (the dashboard holds one while a person is looking) or on an
// activation (session create, message send). Background polling does not wake
// it. Before this gate, a tab left open kept polling sessions, the install check,
// browser diagnostics and the live socket every few seconds, and every one of those
// answered 425. That was about 1.8M requests a week for nothing.
//
// The proxy answers `425 { error: "computer_paused" }` for that state, and 425
// "sandbox waking" while a wake is in flight. Either one arms this gate:
//
//   - Background reads (GET/HEAD), requests marked background (diagnostics)
//     and socket opens
//     are answered locally with the same 425 while the gate is closed. Nothing
//     reaches the network.
//   - The wait doubles on each 425 that gets through: 2 s, 4 s, ... 60 s.
//   - Any successful answer clears it, so a wake is noticed on the next poll.
//   - Window focus, a visible tab, or coming back online opens it at once and
//     restarts the ladder. On the dashboard that is also when the presence
//     lease renews and wakes the machine, so the first request after focus is
//     the one that finds it running.
//
// User actions (every other POST, PUT, DELETE) always go through. Session
// create and message send are exactly the requests that wake a paused
// Computer, and a click must never be swallowed by a background backoff.
//
// Standalone lfg never answers 425, so the gate stays open there.

export const PAUSED_GATE_START_MS = 2_000;
export const PAUSED_GATE_MAX_MS = 60_000;
export const COMPUTER_PAUSED_CODE = "computer_paused";

type Clock = () => number;

export type ComputerPausedGate = {
  /**
   * Would this request be held back right now? `background` marks a write
   * that no person is waiting on (browser diagnostics).
   */
  blocks(init?: RequestInit, background?: boolean): boolean;
  /** Feed every HTTP status the transport returned. */
  observe(status: number): void;
  /** Open the gate now and restart the ladder. */
  reset(): void;
  /** Milliseconds until the gate opens by itself; 0 when open. */
  remainingMs(): number;
};

function isBackgroundRequest(init?: RequestInit, background = false): boolean {
  if (background) return true;
  const method = (init?.method ?? "GET").toUpperCase();
  return method === "GET" || method === "HEAD";
}

export function createComputerPausedGate(now: Clock = Date.now): ComputerPausedGate {
  let delayMs = 0;
  let openAt = 0;
  return {
    blocks(init, background) {
      return now() < openAt && isBackgroundRequest(init, background);
    },
    observe(status) {
      if (status === 425) {
        // One page load fans out many requests. Their 425s arrive together and
        // describe one state, so only a 425 that got through an OPEN gate
        // climbs the ladder.
        if (now() < openAt) return;
        delayMs = delayMs === 0 ? PAUSED_GATE_START_MS : Math.min(PAUSED_GATE_MAX_MS, delayMs * 2);
        openAt = now() + delayMs;
      } else if (status >= 200 && status < 400) {
        delayMs = 0;
        openAt = 0;
      }
    },
    reset() {
      delayMs = 0;
      openAt = 0;
    },
    remainingMs() {
      return Math.max(0, openAt - now());
    },
  };
}

/** The local answer for a held request. Same shape the proxy sends. */
export function computerPausedResponse(): Response {
  return new Response(
    JSON.stringify({
      error: COMPUTER_PAUSED_CODE,
      code: COMPUTER_PAUSED_CODE,
      message: "Your Computer is paused. It wakes when you open it.",
    }),
    { status: 425, headers: { "content-type": "application/json" } },
  );
}

/** Thrown by `api()` for a held request. Structural, like OmgApiError. */
export class ComputerPausedError extends Error {
  readonly status = 425;
  readonly code = COMPUTER_PAUSED_CODE;
  constructor() {
    super("Your Computer is paused. It wakes when you open it.");
    this.name = "ComputerPausedError";
  }
}

/** Status carried by a thrown transport error, read structurally. */
export function errorStatus(error: unknown): number | undefined {
  if (!error || typeof error !== "object") return undefined;
  const status = (error as { status?: unknown }).status;
  return typeof status === "number" ? status : undefined;
}

type Listenable = {
  addEventListener(type: string, listener: () => void): void;
  removeEventListener(type: string, listener: () => void): void;
};

/**
 * Open the gate when the person comes back. Installed once per gate, and only
 * where there is a window. Typed structurally because omg-client.ts is also
 * compiled by the root program, which has no DOM library.
 */
export function resetGateWhenUserReturns(gate: ComputerPausedGate): () => void {
  const scope = globalThis as { window?: Listenable; document?: Listenable & { visibilityState?: string } };
  const win = scope.window;
  const doc = scope.document;
  if (!win || !doc) return () => {};
  const open = () => gate.reset();
  const onVisible = () => {
    if (doc.visibilityState === "visible") gate.reset();
  };
  win.addEventListener("focus", open);
  win.addEventListener("online", open);
  doc.addEventListener("visibilitychange", onVisible);
  return () => {
    win.removeEventListener("focus", open);
    win.removeEventListener("online", open);
    doc.removeEventListener("visibilitychange", onVisible);
  };
}
