// The Expo sign-in sheet: Expo's real sign-up or sign-in page, shown on its
// own, as a sheet over the preview card.
//
// The page runs in the Computer kiosk window (src/computer/kiosk.ts). This
// sheet shows only that window's page area, cut out of the normal Computer
// stream (noVNC over /api/computer). There is no second streaming path.
//
// The person types into the page. omg never sees the password and never
// fills in or submits the form; Expo's terms forbid automated sign-ups.
//
// Input:
//  - a mouse goes straight to noVNC, which maps it through its own scale;
//  - a tap clicks where the finger is, a drag scrolls the page;
//  - a tap on a text field focuses a hidden field, which raises the phone
//    keyboard, and each key it produces goes to the Computer.
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import RFB from "@novnc/novnc";
import { Loader2, Lock, X } from "lucide-react";
import {
  COMPUTER_KIOSK_PATH, keysymFor, kioskHitsInput, kioskHost, kioskLayout, NAMED_KEYSYMS, type KioskFrame,
} from "../../../packages/protocol/src/computer-kiosk";
import type { ExpoConnectMode } from "../../../packages/protocol/src/expo-account";
import { omgFetch, openOmgSocket } from "@/lib/omg-client";
import { RfbChannel } from "@/lib/rfb-channel";
import { dispatchComputerMouse } from "@/lib/computer-pointer";

/** Finger travel, in sheet pixels, for one wheel step on the Computer. Chrome
 * scrolls about 120 px per step, so the page moves a little faster than the finger. */
const SCROLL_STEP = 80;
/** A hidden field that is never empty, so a backspace always has something to delete. */
const PAD = "\n".repeat(64);

export const EXPO_SHEET_TITLE: Record<ExpoConnectMode, string> = {
  signup: "Sign up for Expo",
  login: "Sign in to Expo",
};

export function ExpoSigninSheet({ mode, onClose, onOpenComputer }: {
  mode: ExpoConnectMode;
  /** The X: cancels the connect. */
  onClose(): void;
  /** The fallback: the whole Computer screen. */
  onOpenComputer(): void;
}) {
  const [frame, setFrame] = useState<KioskFrame | null>(null);
  const [live, setLive] = useState(false);
  const [lost, setLost] = useState(false);
  const [width, setWidth] = useState(0);
  const viewRef = useRef<HTMLDivElement | null>(null);
  const screenRef = useRef<HTMLDivElement | null>(null);
  const fieldRef = useRef<HTMLTextAreaElement | null>(null);
  const rfbRef = useRef<RFB | null>(null);
  const frameRef = useRef<KioskFrame | null>(null);
  frameRef.current = frame;

  // Where the page is on the desktop. It moves when a sign-in popup opens.
  useEffect(() => {
    let alive = true;
    const poll = async () => {
      try {
        const response = await omgFetch(COMPUTER_KIOSK_PATH);
        if (response.ok && alive) {
          const next = await response.json() as KioskFrame;
          setFrame((old) => JSON.stringify(old) === JSON.stringify(next) ? old : next);
        }
      } catch { /* The next poll retries. */ }
    };
    void poll();
    const timer = setInterval(poll, 700);
    return () => { alive = false; clearInterval(timer); };
  }, []);

  useLayoutEffect(() => {
    const el = viewRef.current;
    if (!el) return;
    const measure = () => setWidth(el.clientWidth);
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const open = !!frame?.open;
  // One connection for the life of the sheet, opened once the page exists.
  useEffect(() => {
    if (!open || rfbRef.current || !screenRef.current) return;
    let cancelled = false;
    void (async () => {
      try {
        const socket = await openOmgSocket("/api/computer");
        if (cancelled || !screenRef.current) { socket.close(); return; }
        const rfb = new RFB(screenRef.current, new RfbChannel(socket) as unknown as object, { shared: true });
        rfb.scaleViewport = true;
        rfb.background = "transparent";
        rfb.viewOnly = false;
        rfb.addEventListener("connect", () => { setLive(true); setLost(false); });
        rfb.addEventListener("disconnect", () => { rfbRef.current = null; setLive(false); setLost(true); });
        rfbRef.current = rfb;
      } catch { setLost(true); }
    })();
    return () => { cancelled = true; };
  }, [open]);
  useEffect(() => () => {
    try { rfbRef.current?.disconnect(); } catch { /* Already closed. */ }
    rfbRef.current = null;
  }, []);

  const layout = frame ? kioskLayout(frame, width) : null;

  const canvas = useCallback(() => screenRef.current?.querySelector("canvas") ?? null, []);

  // Touch, bound natively: React's touch listeners are passive, and the
  // browser's own panning and its compatibility mouse events must stop here.
  // Capture phase, so noVNC's gesture handler on the canvas never sees them.
  useEffect(() => {
    const el = viewRef.current;
    if (!el) return;
    let start: { x: number; y: number; at: number; lastY: number; moved: boolean } | null = null;
    let travel = 0;
    const onStart = (e: TouchEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const t = e.touches[0];
      if (!t || e.touches.length !== 1) { start = null; return; }
      start = { x: t.clientX, y: t.clientY, at: Date.now(), lastY: t.clientY, moved: false };
      travel = 0;
    };
    const onMove = (e: TouchEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const t = e.touches[0];
      const c = canvas();
      if (!start || !t || !c) return;
      if (Math.hypot(t.clientX - start.x, t.clientY - start.y) > 8) start.moved = true;
      if (!start.moved) return;
      // Content follows the finger: a drag up scrolls the page down.
      travel += start.lastY - t.clientY;
      start.lastY = t.clientY;
      while (Math.abs(travel) >= SCROLL_STEP) {
        const down = travel > 0;
        travel += down ? -SCROLL_STEP : SCROLL_STEP;
        c.dispatchEvent(new WheelEvent("wheel", { bubbles: true, cancelable: true, clientX: t.clientX, clientY: t.clientY, deltaY: down ? 60 : -60 }));
      }
    };
    const onEnd = (e: TouchEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const s = start;
      start = null;
      const c = canvas();
      if (!s || s.moved || !c || Date.now() - s.at > 600) return;
      const at = { x: s.x, y: s.y };
      dispatchComputerMouse(c, at, "mousemove", 0);
      dispatchComputerMouse(c, at, "mousedown", 1, 0);
      dispatchComputerMouse(c, at, "mouseup", 0, 0);
      // The keyboard may only rise inside the tap itself, so decide now,
      // from the text fields the page reported on the last poll.
      const f = frameRef.current;
      const box = el.getBoundingClientRect();
      const field = fieldRef.current;
      if (!field || !f?.rect) return;
      const scale = box.width / f.rect.width;
      if (kioskHitsInput(f, scale, at.x - box.left, at.y - box.top)) {
        field.value = PAD;
        field.focus({ preventScroll: true });
      } else field.blur();
    };
    el.addEventListener("touchstart", onStart, { passive: false, capture: true });
    el.addEventListener("touchmove", onMove, { passive: false, capture: true });
    el.addEventListener("touchend", onEnd, { passive: false, capture: true });
    el.addEventListener("touchcancel", onEnd, { passive: false, capture: true });
    return () => {
      el.removeEventListener("touchstart", onStart, { capture: true });
      el.removeEventListener("touchmove", onMove, { capture: true });
      el.removeEventListener("touchend", onEnd, { capture: true });
      el.removeEventListener("touchcancel", onEnd, { capture: true });
    };
  }, [canvas]);

  const send = (keysym: number) => {
    const rfb = rfbRef.current;
    if (!rfb) return;
    rfb.sendKey(keysym, null, true);
    rfb.sendKey(keysym, null, false);
  };

  const host = kioskHost(frame);
  const ready = open && live && !!layout;
  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-end justify-center bg-black/40 sm:items-center" data-testid="expo-signin-sheet-backdrop">
      <div
        role="dialog"
        aria-label={EXPO_SHEET_TITLE[mode]}
        data-testid="expo-signin-sheet"
        className="flex h-[92dvh] w-full flex-col overflow-hidden rounded-t-2xl border bg-background shadow-2xl sm:h-[min(844px,92dvh)] sm:w-[390px] sm:rounded-2xl"
      >
        <div className="flex shrink-0 items-center gap-2 border-b px-3 py-2">
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold" data-testid="expo-signin-sheet-title">{EXPO_SHEET_TITLE[mode]}</p>
            <p className="flex items-center gap-1 text-xs text-muted-foreground" data-testid="expo-signin-sheet-host">
              <Lock className="size-3" aria-hidden />{host}
            </p>
          </div>
          <button type="button" className="inline-flex size-8 items-center justify-center rounded-full text-muted-foreground hover:bg-muted"
            onClick={onClose} aria-label="Cancel and close" data-testid="expo-signin-sheet-close">
            <X className="size-5" aria-hidden />
          </button>
        </div>
        <div ref={viewRef} className="relative min-h-0 flex-1 touch-none select-none overflow-hidden bg-white" data-testid="expo-signin-sheet-view">
          <div className="absolute left-0 top-0 overflow-hidden" style={layout ? { width: "100%", height: layout.pageHeight } : { width: 0, height: 0 }}>
            <div ref={screenRef} className="absolute" style={layout
              ? { left: layout.left, top: layout.top, width: layout.width, height: layout.height }
              : { left: 0, top: 0, width: 1, height: 1 }} />
          </div>
          {!ready ? <div className="absolute inset-0 flex items-center justify-center bg-background" data-testid="expo-signin-sheet-loading">
            <span className="flex items-center gap-2 text-sm text-muted-foreground">
              {lost ? "Lost the connection to the Computer." : <><Loader2 className="size-4 animate-spin" aria-hidden />Opening {host}…</>}
            </span>
          </div> : null}
          <textarea
            ref={fieldRef}
            aria-hidden
            tabIndex={-1}
            className="pointer-events-none absolute left-0 top-0 size-px opacity-0"
            // 16 px stops iOS Safari from zooming the page to the field.
            style={{ fontSize: 16 }}
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            onInput={(e) => {
              const field = e.currentTarget;
              const value = field.value;
              if (value.length < PAD.length) {
                for (let i = value.length; i < PAD.length; i++) send(NAMED_KEYSYMS.Backspace!);
              } else {
                for (const ch of value.slice(PAD.length)) send(keysymFor(ch));
              }
              field.value = PAD;
            }}
            onKeyDown={(e) => {
              // Keys that type nothing still reach the page. Enter and
              // Backspace arrive through onInput.
              if (e.key === "Enter" || e.key === "Backspace") return;
              const keysym = NAMED_KEYSYMS[e.key];
              if (!keysym) return;
              e.preventDefault();
              send(keysym);
            }}
          />
        </div>
        <div className="flex shrink-0 justify-center border-t px-3 py-1.5">
          <button type="button" className="text-xs text-muted-foreground underline-offset-2 hover:underline" onClick={onOpenComputer} data-testid="expo-signin-sheet-full-computer">
            Open the full Computer view
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

export default ExpoSigninSheet;
