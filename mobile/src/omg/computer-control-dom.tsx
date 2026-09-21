'use dom';

import RFB from "@novnc/novnc";
import { useCallback, useEffect, useRef, useState } from "react";

type Props = {
  socketUrl: string;
  protocol: string;
  preview?: boolean;
  dom?: import("expo/dom").DOMProps;
};

type Point = { x: number; y: number };
type TouchState = Point & { moved: boolean; at: number };

function dispatchMouse(
  canvas: HTMLCanvasElement,
  at: Point,
  type: "mousemove" | "mousedown" | "mouseup",
  buttons: number,
  button = 0,
) {
  // noVNC installs a window-level capture proxy on press. The release must
  // reach that proxy, or its transparent layer remains above the trackpad.
  const target = type === "mouseup" ? canvas.ownerDocument.defaultView! : canvas;
  target.dispatchEvent(new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    clientX: at.x,
    clientY: at.y,
    button,
    buttons,
  }));
}

export default function ComputerControlDom({ socketUrl, protocol, preview = false }: Props) {
  const screenRef = useRef<HTMLDivElement | null>(null);
  const overlayRef = useRef<HTMLDivElement | null>(null);
  const rfbRef = useRef<RFB | null>(null);
  const cursorRef = useRef<Point | null>(null);
  const touchRef = useRef<TouchState | null>(null);
  const [phase, setPhase] = useState<"connecting" | "live" | "error">("connecting");
  const [control, setControl] = useState(false);
  const [keyboard, setKeyboard] = useState(false);
  const [text, setText] = useState("");

  useEffect(() => {
    if (preview) {
      setPhase("live");
      return;
    }
    const host = screenRef.current;
    if (!host) return;
    setPhase("connecting");
    const socket = new WebSocket(socketUrl, [protocol]);
    socket.binaryType = "arraybuffer";
    const rfb = new RFB(host, socket, { shared: true });
    rfb.scaleViewport = true;
    rfb.showDotCursor = true;
    rfb.background = "#0b0b0d";
    rfb.viewOnly = true;
    rfb.addEventListener("connect", () => setPhase("live"));
    rfb.addEventListener("disconnect", () => setPhase("error"));
    rfbRef.current = rfb;
    return () => {
      rfbRef.current = null;
      try { rfb.disconnect(); } catch {}
    };
  }, [socketUrl, protocol, preview]);

  useEffect(() => {
    if (rfbRef.current) rfbRef.current.viewOnly = !control;
  }, [control]);

  const canvas = useCallback(() => screenRef.current?.querySelector("canvas") ?? null, []);
  const emit = useCallback((type: "mousemove" | "mousedown" | "mouseup", buttons: number, button = 0) => {
    const target = canvas();
    const at = cursorRef.current;
    if (target && at) dispatchMouse(target, at, type, buttons, button);
  }, [canvas]);
  const move = useCallback((dx: number, dy: number) => {
    const target = canvas();
    if (!target) return;
    const box = target.getBoundingClientRect();
    const at = cursorRef.current ?? { x: box.left + box.width / 2, y: box.top + box.height / 2 };
    cursorRef.current = {
      x: Math.min(box.right - 1, Math.max(box.left, at.x + dx)),
      y: Math.min(box.bottom - 1, Math.max(box.top, at.y + dy)),
    };
    emit("mousemove", 0);
  }, [canvas, emit]);
  const click = useCallback((button: 0 | 2) => {
    emit("mousedown", button === 2 ? 2 : 1, button);
    emit("mouseup", 0, button);
  }, [emit]);
  const rightClick = useCallback(() => {
    setControl(true);
    if (rfbRef.current) rfbRef.current.viewOnly = false;
    click(2);
  }, [click]);

  useEffect(() => {
    const target = overlayRef.current;
    if (!target || !control) return;
    const start = (event: TouchEvent) => {
      event.preventDefault();
      if (event.touches.length !== 1) return;
      const touch = event.touches[0];
      touchRef.current = { x: touch.clientX, y: touch.clientY, moved: false, at: Date.now() };
    };
    const moveTouch = (event: TouchEvent) => {
      event.preventDefault();
      const previous = touchRef.current;
      if (!previous || event.touches.length !== 1) return;
      const touch = event.touches[0];
      const dx = touch.clientX - previous.x;
      const dy = touch.clientY - previous.y;
      if (Math.abs(dx) > 3 || Math.abs(dy) > 3) previous.moved = true;
      const speed = Math.min(2.5, 1 + Math.hypot(dx, dy) / 12);
      move(dx * speed, dy * speed);
      previous.x = touch.clientX;
      previous.y = touch.clientY;
    };
    const end = (event: TouchEvent) => {
      event.preventDefault();
      const previous = touchRef.current;
      touchRef.current = null;
      if (previous && !previous.moved && Date.now() - previous.at < 400) click(0);
    };
    target.addEventListener("touchstart", start, { passive: false });
    target.addEventListener("touchmove", moveTouch, { passive: false });
    target.addEventListener("touchend", end, { passive: false });
    target.addEventListener("touchcancel", end, { passive: false });
    return () => {
      target.removeEventListener("touchstart", start);
      target.removeEventListener("touchmove", moveTouch);
      target.removeEventListener("touchend", end);
      target.removeEventListener("touchcancel", end);
    };
  }, [control, click, move]);

  const special = (keysym: number, code: string) => {
    setControl(true);
    const rfb = rfbRef.current;
    if (!rfb) return;
    rfb.viewOnly = false;
    rfb.sendKey(keysym, code);
  };

  const sendText = () => {
    const value = text;
    const rfb = rfbRef.current;
    if (!rfb || !value) return;
    setControl(true);
    rfb.viewOnly = false;
    rfb.clipboardPasteFrom(value);
    rfb.sendKey(0xffe3, "ControlLeft", true);
    rfb.sendKey(0x76, "KeyV", true);
    rfb.sendKey(0x76, "KeyV", false);
    rfb.sendKey(0xffe3, "ControlLeft", false);
    setText("");
  };

  return (
    <main style={styles.root} data-testid="computer-control-viewer">
      <section style={styles.screen}>
        <div ref={screenRef} style={styles.frame} />
        {preview ? (
          <div style={styles.preview} aria-label="Demo computer desktop">
            <div style={styles.previewBar}>Your Computer</div>
            <div style={styles.previewWindow}>
              <div style={styles.previewWindowBar}>Browser</div>
              <div style={styles.previewContent}>
                <strong>Remote Computer</strong>
                <span>The live screen appears here.</span>
              </div>
            </div>
          </div>
        ) : null}
        <div ref={overlayRef} style={{ ...styles.overlay, pointerEvents: control ? "auto" : "none" }} />
        {phase !== "live" ? (
          <div style={styles.status}>{phase === "error" ? "Connection lost" : "Connecting to screen…"}</div>
        ) : null}
      </section>
      <nav style={styles.toolbar} aria-label="Computer controls">
        <button style={control ? styles.primaryButton : styles.button} onClick={() => setControl(value => !value)}>
          {control ? "Controlling" : "Take control"}
        </button>
        <button style={styles.button} onClick={() => { setControl(true); setKeyboard(value => !value); }}>
          Keyboard
        </button>
        <button style={styles.button} onClick={rightClick}>Right click</button>
      </nav>
      {keyboard ? (
        <section style={styles.keyboard} aria-label="Keyboard controls">
          <textarea
            autoFocus
            value={text}
            onChange={(event) => setText(event.target.value)}
            placeholder="Type or paste text"
            style={styles.input}
          />
          <button style={styles.primaryButton} onClick={sendText}>Send</button>
          <div style={styles.keys}>
            <button style={styles.key} onClick={() => special(0xff08, "Backspace")}>⌫</button>
            <button style={styles.key} onClick={() => special(0xff09, "Tab")}>Tab</button>
            <button style={styles.key} onClick={() => special(0xff0d, "Enter")}>Return</button>
            <button style={styles.key} onClick={() => special(0xff1b, "Escape")}>Esc</button>
          </div>
        </section>
      ) : null}
      <p style={styles.hint}>{control ? "Drag to move the pointer. Tap to click." : "View only. Take control to send input."}</p>
    </main>
  );
}

const styles: Record<string, React.CSSProperties> = {
  root: { position: "fixed", inset: 0, display: "flex", flexDirection: "column", background: "#0b0b0d", color: "#f6f5f3", fontFamily: "-apple-system, BlinkMacSystemFont, sans-serif", overflow: "hidden" },
  screen: { position: "relative", flex: 1, minHeight: 0, background: "#111114" },
  frame: { position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden" },
  overlay: { position: "absolute", inset: 0, zIndex: 2, touchAction: "none" },
  preview: { position: "absolute", inset: 0, padding: 18, background: "linear-gradient(145deg, #24385d, #151b2b 65%)" },
  previewBar: { height: 28, color: "#d8deea", fontSize: 12, fontWeight: 600 },
  previewWindow: { width: "82%", height: "76%", margin: "2% auto 0", borderRadius: 10, overflow: "hidden", background: "#f7f7f8", boxShadow: "0 18px 50px rgba(0,0,0,.35)" },
  previewWindowBar: { height: 30, padding: "8px 12px", background: "#e7e7ea", color: "#55555d", fontSize: 11 },
  previewContent: { height: "calc(100% - 30px)", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 8, color: "#202027", fontSize: 15 },
  status: { position: "absolute", inset: 0, display: "grid", placeItems: "center", zIndex: 3, background: "rgba(11,11,13,.78)", fontSize: 15 },
  toolbar: { display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 8, padding: "10px 12px", borderTop: "1px solid #2a2a2f", background: "#17171b" },
  button: { minWidth: 0, minHeight: 44, border: "1px solid #393940", borderRadius: 12, background: "#24242a", color: "#f6f5f3", fontSize: 13, fontWeight: 600 },
  primaryButton: { minWidth: 0, minHeight: 44, border: 0, borderRadius: 12, background: "#4d7cff", color: "white", fontSize: 13, fontWeight: 700 },
  keyboard: { display: "flex", gap: 8, padding: "0 12px 10px", background: "#17171b" },
  input: { minHeight: 54, resize: "none", border: "1px solid #393940", borderRadius: 12, background: "#0f0f12", color: "#fff", padding: 12, fontSize: 16 },
  keys: { display: "flex", gap: 8 },
  key: { minHeight: 40, flex: 1, border: "1px solid #393940", borderRadius: 10, background: "#24242a", color: "#f6f5f3", fontSize: 13 },
  hint: { margin: 0, padding: "0 12px 10px", background: "#17171b", color: "#aaaab2", textAlign: "center", fontSize: 12 },
};
