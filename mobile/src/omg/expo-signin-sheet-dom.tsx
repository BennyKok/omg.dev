'use dom';

/**
 * The page area of the Expo sign-in sheet, on a phone: only the Computer
 * kiosk window's page, cut out of the normal Computer stream.
 *
 * The native sheet around this (expo-signin-sheet.tsx) polls where the page
 * is and passes it in as `frame`. This view scales the whole desktop so the
 * page is exactly as wide as the sheet, and moves it so the page's corner is
 * the sheet's corner. The same RFB stream as the Computer screen; nothing new
 * streams. The web card does the same in web/src/components/expo-signin-sheet.tsx.
 *
 * Input goes where the finger is: a tap clicks, a drag scrolls the page, and
 * a tap on a text field raises the iOS keyboard, whose keys go to the
 * Computer one by one. omg never reads or fills in the form.
 */

import RFB from "@novnc/novnc";
import { useEffect, useLayoutEffect, useRef, useState } from "react";

import {
  keysymFor, kioskHitsInput, kioskLayout, NAMED_KEYSYMS, type KioskFrame,
} from "../../../packages/protocol/src/computer-kiosk";

type Props = {
  socketUrl: string;
  protocol: string;
  frame: KioskFrame | null;
  dom?: import("expo/dom").DOMProps;
};

/** Finger travel, in points, for one wheel step on the Computer. Chrome
 * scrolls about 120 px per step, so the page moves a little faster than the finger. */
const SCROLL_STEP = 80;
/** Never empty, so iOS always raises a delete event for backspace. */
const PAD = "\n".repeat(64);

function dispatchMouse(canvas: HTMLCanvasElement, x: number, y: number, type: "mousemove" | "mousedown" | "mouseup", buttons: number) {
  // noVNC installs a window-level capture proxy on press; the release must reach it.
  const target = type === "mouseup" ? canvas.ownerDocument.defaultView! : canvas;
  target.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0, buttons }));
}

export default function ExpoSigninSheetDom({ socketUrl, protocol, frame }: Props) {
  const viewRef = useRef<HTMLDivElement | null>(null);
  const screenRef = useRef<HTMLDivElement | null>(null);
  const fieldRef = useRef<HTMLTextAreaElement | null>(null);
  const rfbRef = useRef<RFB | null>(null);
  const frameRef = useRef<KioskFrame | null>(frame);
  frameRef.current = frame;
  const [width, setWidth] = useState(0);
  const [phase, setPhase] = useState<"connecting" | "live" | "lost">("connecting");

  useLayoutEffect(() => {
    const measure = () => setWidth(viewRef.current?.clientWidth ?? 0);
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, []);

  const open = !!frame?.open;
  useEffect(() => {
    const host = screenRef.current;
    if (!open || !host || !socketUrl) return;
    const socket = new WebSocket(socketUrl, [protocol]);
    socket.binaryType = "arraybuffer";
    const rfb = new RFB(host, socket, { shared: true });
    rfb.scaleViewport = true;
    rfb.background = "transparent";
    rfb.viewOnly = false;
    rfb.addEventListener("connect", () => setPhase("live"));
    rfb.addEventListener("disconnect", () => setPhase("lost"));
    rfbRef.current = rfb;
    return () => {
      rfbRef.current = null;
      try { rfb.disconnect(); } catch {}
    };
  }, [open, socketUrl, protocol]);

  useEffect(() => {
    const el = viewRef.current;
    if (!el) return;
    let start: { x: number; y: number; at: number; lastY: number; moved: boolean } | null = null;
    let travel = 0;
    const canvas = () => screenRef.current?.querySelector("canvas") ?? null;
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
      dispatchMouse(c, s.x, s.y, "mousemove", 0);
      dispatchMouse(c, s.x, s.y, "mousedown", 1);
      dispatchMouse(c, s.x, s.y, "mouseup", 0);
      // The keyboard may only rise inside the tap itself.
      const f = frameRef.current;
      const field = fieldRef.current;
      if (!f?.rect || !field) return;
      const box = el.getBoundingClientRect();
      if (kioskHitsInput(f, box.width / f.rect.width, s.x - box.left, s.y - box.top)) {
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
  }, []);

  const send = (keysym: number) => {
    const rfb = rfbRef.current;
    if (!rfb) return;
    rfb.sendKey(keysym, null, true);
    rfb.sendKey(keysym, null, false);
  };

  const layout = frame ? kioskLayout(frame, width) : null;
  return (
    <main ref={viewRef} style={styles.root} data-testid="expo-signin-sheet-view">
      <div style={{ ...styles.clip, height: layout?.pageHeight ?? 0 }}>
        <div ref={screenRef} style={layout
          ? { position: "absolute", left: layout.left, top: layout.top, width: layout.width, height: layout.height }
          : { position: "absolute", left: 0, top: 0, width: 1, height: 1 }} />
      </div>
      {!open || phase !== "live" || !layout ? (
        <div style={styles.status} role="status">
          {phase === "lost" ? "Lost the connection to the Computer." : "Opening expo.dev…"}
        </div>
      ) : null}
      <textarea
        ref={fieldRef}
        aria-hidden="true"
        tabIndex={-1}
        style={styles.field}
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
          if (e.key === "Enter" || e.key === "Backspace") return;
          const keysym = NAMED_KEYSYMS[e.key];
          if (!keysym) return;
          e.preventDefault();
          send(keysym);
        }}
      />
    </main>
  );
}

const styles = {
  root: {
    position: "fixed", inset: 0, overflow: "hidden", background: "#ffffff",
    touchAction: "none", userSelect: "none", WebkitUserSelect: "none", WebkitTouchCallout: "none",
  },
  clip: { position: "absolute", left: 0, top: 0, width: "100%", overflow: "hidden" },
  status: {
    position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center",
    background: "#ffffff", color: "#6b7280", font: "15px -apple-system, system-ui, sans-serif",
  },
  // 16 px keeps WebKit from zooming to the field.
  field: { position: "absolute", left: 0, top: 0, width: 1, height: 1, opacity: 0, fontSize: 16, pointerEvents: "none" },
} satisfies Record<string, React.CSSProperties>;
