// Browser side of the voxl stream (see src/computer/voxl.ts on the server).
//
// Ported from voxl's own web client (github.com/tembo/voxl, web/src, MIT),
// trimmed to what the Computer page needs: H.264 stripes decoded with
// WebCodecs and drawn to one canvas, mouse/wheel/touch/keyboard input, the
// remote cursor, and paste. It runs over an OmgSocket, so it works both on
// this box and through the omg.dev relay, exactly like the noVNC stream.
//
// Portions of this file are adapted from voxl and carry its licence:
//
// MIT License
//
// Copyright (c) 2026 Tembo
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in all
// copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.

import type { OmgSocket } from "@omg-dev/client";
import { clampCamera, coverScale, type Camera, type Size } from "./computer-camera";
import { createVoxlTrackpad, type TrackpadView } from "./voxl-trackpad";

const BIN_VIDEO = 0x01;
const BIN_CURSOR = 0x03;
const VIDEO_HEADER_BYTES = 16;

type Stripe = [y: number, h: number];

interface Hello {
  t: "hello";
  w: number;
  h: number;
  stripes?: Stripe[];
  readOnly?: boolean;
}

type ServerMessage = Hello | { t: "ping"; s: number } | { t: "clip"; d: string } | { t: "close" } | { t: string };

export const voxlCmd = {
  ack: (frame: number) => `a,${frame}`,
  move: (x: number, y: number) => `m,${x},${y}`,
  button: (button: number, down: boolean) => `b,${button},${down ? 1 : 0}`,
  scroll: (dx: number, dy: number) => `sp,${dx.toFixed(1)},${dy.toFixed(1)}`,
  key: (keysym: number, down: boolean) => `k,${keysym},${down ? 1 : 0}`,
  releaseAll: "r",
  clipboard: (text: string) => `c,${text}`,
  video: (on: boolean) => `v,${on ? 1 : 0}`,
  audio: (on: boolean) => `au,${on ? 1 : 0}`,
  keyframe: "kf",
  pong: (sent: number) => `po,${sent}`,
} as const;

export interface VoxlStats {
  fps: number;
  kbps: number;
  /** Server capture-to-send time, ms. */
  pipeMs: number;
  /** Receive-to-draw time in this browser, ms. */
  decodeMs: number;
}

export interface VoxlStreamOptions {
  socket: OmgSocket;
  canvas: HTMLCanvasElement;
  /** The element that takes pointer and keyboard input (focusable). */
  surface: HTMLElement;
  onLive?: (live: boolean) => void;
  onStats?: (stats: VoxlStats) => void;
  onError?: (message: string) => void;
  viewOnly?: () => boolean;
  /**
   * Drawn at the remote pointer while a finger is driving it. The desktop
   * image carries no pointer, and a phone shows no mouse cursor of its own.
   */
  cursor?: HTMLImageElement;
  /**
   * Let a finger zoom and pan the picture like a camera (the full page). Off,
   * the picture stays fitted and a pinch scrolls (the inline view).
   */
  camera?: boolean;
  /** A finger (true) or a mouse (false) is now driving the screen. */
  onTouchMode?: (touch: boolean) => void;
}

/**
 * The slice of noVNC's RFB that the shared clipboard code drives
 * (packages/protocol/src/computer-clipboard.ts), so voxl gets the same
 * copy, paste and shortcut handling as the VNC stream.
 */
export interface VoxlClipboardTarget extends EventTarget {
  viewOnly: boolean;
  sendKey(keysym: number, code: string | null, down?: boolean): void;
  clipboardPasteFrom(text: string): void;
}

export interface VoxlStream {
  close(): void;
  send(command: string): void;
  clipboard: VoxlClipboardTarget;
  /** Type text from the on-screen keyboard, one key tap per character. */
  typeText(text: string): void;
  tapKey(keysym: number): void;
}

/** Can this browser decode the stream? WebCodecs needs a secure page. */
export function voxlSupported(): string | null {
  if (typeof window === "undefined") return "no window";
  if (!window.isSecureContext) return "The fast stream needs HTTPS or localhost.";
  if (!("VideoDecoder" in window)) return "This browser cannot decode the fast stream (no WebCodecs).";
  return null;
}

/** avc1.PPCCLL from the first SPS in an Annex-B keyframe. */
export function codecFromSps(d: Uint8Array): string | null {
  const hex2 = (x: number) => x.toString(16).padStart(2, "0");
  for (let i = 0; i + 6 < d.length; i++) {
    if (d[i] === 0 && d[i + 1] === 0 && d[i + 2] === 1 && (d[i + 3] & 0x1f) === 7) {
      return "avc1." + hex2(d[i + 4]) + hex2(d[i + 5]) + hex2(d[i + 6]);
    }
  }
  return null;
}

export function parseVideoHeader(b: Uint8Array) {
  const u32 = (i: number) => ((b[i] << 24) | (b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]) >>> 0;
  return { key: (b[1] & 1) === 1, frame: u32(2), pipe: u32(6), stripe: b[10], parts: b[12] };
}

// ---- keyboard: browser key -> X keysym (voxl's mapping) ----

const NAMED: Record<string, number> = {
  Backspace: 0xff08, Tab: 0xff09, Enter: 0xff0d, Escape: 0xff1b, Delete: 0xffff,
  Home: 0xff50, ArrowLeft: 0xff51, ArrowUp: 0xff52, ArrowRight: 0xff53, ArrowDown: 0xff54,
  PageUp: 0xff55, PageDown: 0xff56, End: 0xff57, Insert: 0xff63, CapsLock: 0xffe5,
  ContextMenu: 0xff67, AltGraph: 0xfe03, " ": 0x20,
};
for (let i = 1; i <= 24; i++) NAMED["F" + i] = 0xffbd + i;
const BY_CODE: Record<string, number> = {
  ShiftLeft: 0xffe1, ShiftRight: 0xffe2, AltLeft: 0xffe9, AltRight: 0xffea, NumpadEnter: 0xff0d,
};
const XK_CONTROL_L = 0xffe3, XK_CONTROL_R = 0xffe4, XK_SUPER_L = 0xffeb, XK_SUPER_R = 0xffec;

export function keysymOf(e: Pick<KeyboardEvent, "code" | "key">, isMac: boolean): number {
  const isCtrl = e.code.startsWith("Control");
  const isMeta = e.code.startsWith("Meta") || e.code.startsWith("OS");
  if (isCtrl || isMeta) {
    const right = e.code.endsWith("Right");
    // A Mac's Command is the Linux desktop's Control, so shortcuts carry over.
    if (isCtrl || (isMac && isMeta)) return right ? XK_CONTROL_R : XK_CONTROL_L;
    return right ? XK_SUPER_R : XK_SUPER_L;
  }
  if (BY_CODE[e.code] !== undefined) return e.code === "AltRight" && e.key === "AltGraph" ? 0xfe03 : BY_CODE[e.code];
  const k = e.key;
  if (NAMED[k] !== undefined) return NAMED[k];
  if (!k || k === "Dead" || k === "Unidentified" || k === "Process" || [...k].length !== 1) return 0;
  const cp = k.codePointAt(0)!;
  return (cp >= 0x20 && cp <= 0x7e) || (cp >= 0xa0 && cp <= 0xff) ? cp : 0x01000000 + cp;
}

/** DOM button -> X button (left, middle, right, back, forward). */
const BUTTONS = [1, 2, 3, 8, 9];

/** A plain arrow, 12x19 with its tip at 0,0, for before the server sends the real one. */
const DEFAULT_POINTER =
  "data:image/svg+xml," +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="12" height="19" viewBox="0 0 12 19">' +
      '<path d="M.5.5v16l4-4 3 6 2-1-3-6h5.5z" fill="#fff" stroke="#000"/></svg>',
  );

/** A real mouse within this long of a finger is the browser's own echo of the touch. */
const MOUSE_AFTER_TOUCH_MS = 1000;

export function openVoxlStream(opts: VoxlStreamOptions): VoxlStream {
  const { socket, canvas, surface } = opts;
  const isMac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
  const viewOnly = () => opts.viewOnly?.() ?? false;
  let ctx: CanvasRenderingContext2D | null = null;
  let desk = { w: 0, h: 0 };
  let layout: Stripe[] = [];
  let closed = false;
  let kfRequested = 0;

  interface StripeState { dec: VideoDecoder | null; codec: string | null; waitingKey: boolean; ts: number; ids: Map<number, number> }
  interface Part { i: number; y: number; frame: VideoFrame }
  interface Pending { need: number; got: Part[]; t0: number }
  const stripes: StripeState[] = [];
  const frames = new Map<number, Pending>();
  const order: number[] = [];
  const st = { frames: 0, bytes: 0, decodeMs: 0, pipeMs: 0, last: performance.now() };

  const send = (s: string) => {
    if (!closed && socket.readyState === 1) socket.send(s);
  };
  const input = (s: string) => {
    if (!viewOnly()) send(s);
  };

  function resetDecoder() {
    for (const sd of stripes) {
      if (sd.dec && sd.dec.state !== "closed") {
        try { sd.dec.close(); } catch {}
      }
    }
    stripes.length = 0;
    for (const f of frames.values()) for (const g of f.got) g.frame.close();
    frames.clear();
    order.length = 0;
  }

  function requestKeyframe() {
    const now = performance.now();
    if (now - kfRequested > 500) {
      kfRequested = now;
      send(voxlCmd.keyframe);
    }
  }

  const stripeState = (i: number): StripeState =>
    (stripes[i] ??= { dec: null, codec: null, waitingKey: true, ts: 0, ids: new Map() });

  function flush() {
    while (order.length) {
      const id = order[0];
      const f = frames.get(id);
      if (f && f.got.length < f.need) return;
      order.shift();
      frames.delete(id);
      if (!f) continue;
      for (const g of f.got) {
        ctx?.drawImage(g.frame, 0, g.y);
        g.frame.close();
      }
      send(voxlCmd.ack(id));
      st.frames++;
      st.decodeMs += performance.now() - f.t0;
    }
  }

  function makeDecoder(i: number, codec: string): VideoDecoder {
    const sd = stripeState(i);
    const dec = new VideoDecoder({
      output: (frame) => {
        const id = sd.ids.get(frame.timestamp);
        sd.ids.delete(frame.timestamp);
        const f = id === undefined ? undefined : frames.get(id);
        if (!f) {
          frame.close();
          return;
        }
        f.got.push({ i, y: layout[i]?.[0] ?? 0, frame });
        flush();
      },
      error: () => {
        resetDecoder();
        requestKeyframe();
      },
    });
    dec.configure({ codec, optimizeForLatency: true, hardwareAcceleration: "no-preference" });
    return dec;
  }

  function onVideo(b: Uint8Array) {
    const h = parseVideoHeader(b);
    const data = b.subarray(VIDEO_HEADER_BYTES);
    st.bytes += b.length;
    let f = frames.get(h.frame);
    if (!f) {
      f = { need: h.parts, got: [], t0: performance.now() };
      frames.set(h.frame, f);
      order.push(h.frame);
      st.pipeMs += h.pipe / 10;
    }
    const sd = stripeState(h.stripe);
    if (sd.waitingKey && !h.key) {
      f.need--;
      requestKeyframe();
      flush();
      return;
    }
    if (h.key) {
      const codec = codecFromSps(data) ?? "avc1.640034";
      if (!sd.dec || sd.dec.state === "closed" || codec !== sd.codec) {
        if (sd.dec && sd.dec.state !== "closed") {
          try { sd.dec.close(); } catch {}
        }
        sd.codec = codec;
        sd.ids.clear();
        try {
          sd.dec = makeDecoder(h.stripe, codec);
        } catch {
          f.need--;
          flush();
          return;
        }
      }
      sd.waitingKey = false;
    }
    const ts = ++sd.ts;
    sd.ids.set(ts, h.frame);
    try {
      sd.dec!.decode(new EncodedVideoChunk({ type: h.key ? "key" : "delta", timestamp: ts, data }));
    } catch {
      resetDecoder();
      requestKeyframe();
    }
  }

  // The remote pointer: its image (desktop pixels) and where we last put it.
  // Until the server sends one, a plain arrow stands in, so a finger can see
  // the pointer it is driving from the first touch.
  const pointer = { w: 12, h: 19, hx: 0, hy: 0, url: DEFAULT_POINTER, x: -1, y: -1, touch: false };

  function onCursor(buf: ArrayBuffer) {
    const v = new DataView(buf);
    const w = v.getUint16(2), h = v.getUint16(4), hx = v.getUint16(6), hy = v.getUint16(8);
    if (!w || !h || buf.byteLength < 14 + w * h * 4) {
      surface.style.cursor = "none";
      Object.assign(pointer, { w: 0, h: 0, url: "" });
      drawPointer();
      return;
    }
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    c.getContext("2d")?.putImageData(new ImageData(new Uint8ClampedArray(buf, 14, w * h * 4), w, h), 0, 0);
    const url = c.toDataURL("image/png");
    surface.style.cursor = `url(${url}) ${hx} ${hy}, default`;
    Object.assign(pointer, { w, h, hx, hy, url });
    drawPointer();
  }

  /** Place the pointer image over the picture. Shown only while touch drives it. */
  function drawPointer() {
    const el = opts.cursor;
    if (!el) return;
    if (!pointer.touch || !pointer.url || pointer.x < 0 || !desk.w) {
      el.style.display = "none";
      return;
    }
    const r = canvas.getBoundingClientRect();
    const host = surface.getBoundingClientRect();
    const scale = Math.min(r.width / desk.w, r.height / desk.h);
    // Never smaller than a normal pointer, so a phone-sized desktop keeps one you can see.
    const k = Math.max(scale, 24 / Math.max(pointer.w, pointer.h));
    const ox = r.left - host.left + (r.width - desk.w * scale) / 2;
    const oy = r.top - host.top + (r.height - desk.h * scale) / 2;
    if (el.src !== pointer.url) el.src = pointer.url;
    el.style.display = "block";
    el.style.width = `${pointer.w * k}px`;
    el.style.height = `${pointer.h * k}px`;
    el.style.transform = `translate(${ox + pointer.x * scale - pointer.hx * k}px, ${oy + pointer.y * scale - pointer.hy * k}px)`;
  }

  function onText(s: string) {
    let m: ServerMessage;
    try {
      m = JSON.parse(s) as ServerMessage;
    } catch {
      return;
    }
    if (m.t === "ping") {
      send(voxlCmd.pong((m as { s: number }).s));
    } else if (m.t === "clip") {
      // The Computer's clipboard changed (after a copy there).
      clipboard.dispatchEvent(new CustomEvent("clipboard", { detail: { text: (m as { d: string }).d } }));
    } else if (m.t === "close") {
      socket.close();
    } else if (m.t === "hello") {
      const hello = m as Hello;
      desk = { w: hello.w, h: hello.h };
      if (canvas.width !== hello.w || canvas.height !== hello.h) {
        canvas.width = hello.w;
        canvas.height = hello.h;
      }
      ctx = canvas.getContext("2d", { alpha: false, desynchronized: true });
      layout = hello.stripes?.length ? hello.stripes : [[0, hello.h]];
      resetDecoder();
      layoutCamera();
      opts.onLive?.(true);
    }
  }

  socket.binaryType = "arraybuffer";
  socket.addEventListener("open", () => {
    send(voxlCmd.video(true));
    send(voxlCmd.audio(false));
  });
  socket.addEventListener("message", (e) => {
    const data = e.data;
    if (typeof data === "string") return onText(data);
    if (!(data instanceof ArrayBuffer)) return;
    const b = new Uint8Array(data);
    if (b[0] === BIN_VIDEO) onVideo(b);
    else if (b[0] === BIN_CURSOR) onCursor(data);
  });
  socket.addEventListener("close", () => {
    if (closed) return;
    opts.onLive?.(false);
    opts.onError?.("The fast stream disconnected.");
  });
  socket.addEventListener("error", () => opts.onError?.("The fast stream failed."));

  const statsTimer = setInterval(() => {
    const now = performance.now();
    const dt = (now - st.last) / 1000;
    const n = st.frames;
    opts.onStats?.({
      fps: n / dt,
      kbps: (st.bytes * 8) / 1000 / dt,
      decodeMs: n ? st.decodeMs / n : 0,
      pipeMs: n ? st.pipeMs / n : 0,
    });
    Object.assign(st, { frames: 0, bytes: 0, decodeMs: 0, pipeMs: 0, last: now });
  }, 1000);

  // ---- input ----
  // The canvas is drawn with object-fit: contain, so map through the
  // letterboxed picture, not the element box.
  function toDesk(p: { clientX: number; clientY: number }): [number, number] {
    const r = canvas.getBoundingClientRect();
    const scale = Math.min(r.width / (desk.w || 1), r.height / (desk.h || 1));
    const ox = r.left + (r.width - desk.w * scale) / 2;
    const oy = r.top + (r.height - desk.h * scale) / 2;
    const x = Math.round((p.clientX - ox) / scale);
    const y = Math.round((p.clientY - oy) / scale);
    return [Math.max(0, Math.min(desk.w - 1, x)), Math.max(0, Math.min(desk.h - 1, y))];
  }
  const deskPerPx = () => {
    const r = canvas.getBoundingClientRect();
    return 1 / Math.min(r.width / (desk.w || 1), r.height / (desk.h || 1));
  };
  let lastMove = "";
  /** Send the pointer to desktop px. `touch` draws it, since a finger has none of its own. */
  const moveDesk = (dx: number, dy: number, touch: boolean) => {
    const x = Math.round(dx);
    const y = Math.round(dy);
    pointer.x = x;
    pointer.y = y;
    pointer.touch = touch;
    drawPointer();
    const s = voxlCmd.move(x, y);
    if (s !== lastMove) {
      lastMove = s;
      input(s);
    }
  };
  const moveTo = (clientX: number, clientY: number, touch: boolean) => {
    if (!desk.w) return;
    const [x, y] = toDesk({ clientX, clientY });
    moveDesk(x, y, touch);
  };
  let sx = 0, sy = 0, queued = false;
  const queueScroll = (dx: number, dy: number) => {
    sx += dx;
    sy += dy;
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      if (Math.abs(sx) >= 0.5 || Math.abs(sy) >= 0.5) input(voxlCmd.scroll(sx, sy));
      sx = sy = 0;
    });
  };

  // ---- a finger: trackpad pointing and the camera (lib/voxl-trackpad.ts) ----
  // A finger drives the pointer like a laptop trackpad. On the full page the
  // canvas is also sized and moved so the desktop fills the phone and the
  // view follows the pointer. A real mouse switches back to absolute pointing
  // and the fitted picture. This follows the input device, not a toggle: the
  // media query is only the first guess, because an iPad can have both.
  let touchMode = !!window.matchMedia?.("(pointer: coarse)").matches;
  let lastTouchAt = 0;
  let cam: Camera | null = null;
  /** Set by a pinch. Until then the desktop keeps filling the view as it resizes. */
  let pinched = false;
  const deskSize = (): Size | null => (desk.w ? { width: desk.w, height: desk.h } : null);
  const cameraOn = () => !!opts.camera && touchMode && desk.w > 0;

  /** The camera's window: the surface, less what the on-screen keyboard covers. */
  const viewBox = (): TrackpadView | null => {
    const box = surface.getBoundingClientRect();
    if (box.width <= 0 || box.height <= 0) return null;
    const vv = window.visualViewport;
    return {
      width: box.width,
      height: box.height,
      left: box.left,
      topOnPage: box.top,
      top: vv ? Math.max(0, vv.offsetTop - box.top) : 0,
      bottom: vv ? Math.min(box.height, vv.offsetTop + vv.height - box.top) : box.height,
    };
  };

  /** Where the fitted (object-contain) picture sits, as a camera. */
  const fitted = (): Camera | null => {
    if (!desk.w) return null;
    const r = canvas.getBoundingClientRect();
    const host = surface.getBoundingClientRect();
    const scale = Math.min(r.width / desk.w, r.height / desk.h);
    if (!(scale > 0)) return null;
    return {
      scale,
      x: r.left - host.left + (r.width - desk.w * scale) / 2,
      y: r.top - host.top + (r.height - desk.h * scale) / 2,
    };
  };

  /** Size and place the canvas for a camera. Null hands it back to its classes. */
  const applyCamera = (next: Camera | null) => {
    cam = next;
    const s = canvas.style;
    if (!next) {
      s.position = s.left = s.top = s.width = s.height = s.maxWidth = "";
    } else {
      s.position = "absolute";
      s.maxWidth = "none";
      s.left = `${next.x}px`;
      s.top = `${next.y}px`;
      s.width = `${desk.w * next.scale}px`;
      s.height = `${desk.h * next.scale}px`;
    }
    drawPointer();
  };

  const trackpad = createVoxlTrackpad({
    desk: deskSize,
    view: viewBox,
    camera: () => (cameraOn() ? cam : fitted()),
    setCamera: (next) => {
      if (!cameraOn()) return;
      if (cam && next.scale !== cam.scale) pinched = true;
      applyCamera(next);
    },
    canZoom: cameraOn,
    moveTo: (at) => moveDesk(at.x, at.y, true),
    button: (button, isDown) => input(voxlCmd.button(button, isDown)),
    scroll: queueScroll,
    later: (fn, ms) => {
      const t = setTimeout(fn, ms);
      return () => clearTimeout(t);
    },
    buzz: () => navigator.vibrate?.(10),
  });

  /** Lay the camera out for the current desktop, view and input device. */
  const layoutCamera = () => {
    const view = viewBox();
    const size = deskSize();
    if (!cameraOn() || !view || !size) {
      if (cam) applyCamera(null);
      else drawPointer();
      return;
    }
    const prev = cam;
    applyCamera(
      clampCamera(
        prev && pinched ? prev : { scale: coverScale(view, size), x: prev?.x ?? 0, y: prev?.y ?? 0 },
        view,
        size,
      ),
    );
    trackpad.relayout();
  };

  const setTouchMode = (on: boolean) => {
    if (on === touchMode) return;
    touchMode = on;
    if (!on) pointer.touch = false;
    opts.onTouchMode?.(on);
    layoutCamera();
  };
  opts.onTouchMode?.(touchMode);

  /** A mouse event this soon after a finger is the browser echoing the touch. */
  const touchEcho = () => performance.now() - lastTouchAt < MOUSE_AFTER_TOUCH_MS;

  const onPointerMove = (e: PointerEvent) => {
    if (e.pointerType === "touch") trackpad.move(e.pointerId, e.clientX, e.clientY);
    else if (!touchEcho()) moveTo(e.clientX, e.clientY, false);
  };
  const onPointerDown = (e: PointerEvent) => {
    e.preventDefault();
    try { surface.setPointerCapture(e.pointerId); } catch {}
    if (e.pointerType === "touch") {
      lastTouchAt = performance.now();
      setTouchMode(true);
      trackpad.down(e.pointerId, e.clientX, e.clientY);
      return;
    }
    if (touchEcho()) return;
    setTouchMode(false);
    surface.focus({ preventScroll: true });
    moveTo(e.clientX, e.clientY, false);
    input(voxlCmd.button(BUTTONS[e.button] ?? 1, true));
  };
  const onPointerUp = (e: PointerEvent) => {
    e.preventDefault();
    if (e.pointerType === "touch") {
      lastTouchAt = performance.now();
      trackpad.up(e.pointerId);
      return;
    }
    if (touchEcho()) return;
    moveTo(e.clientX, e.clientY, false);
    input(voxlCmd.button(BUTTONS[e.button] ?? 1, false));
  };
  const onPointerCancel = (e: PointerEvent) => {
    if (e.pointerType === "touch") trackpad.cancel(e.pointerId);
    else input(voxlCmd.releaseAll);
  };
  const onWheel = (e: WheelEvent) => {
    e.preventDefault();
    moveTo(e.clientX, e.clientY, false);
    const k = (e.deltaMode === 1 ? 40 : e.deltaMode === 2 ? 800 : 1) * deskPerPx();
    queueScroll(e.deltaX * k, e.deltaY * k);
  };
  const onContextMenu = (e: Event) => e.preventDefault();
  const onResize = () => layoutCamera();
  const resizeObserver = typeof ResizeObserver !== "undefined" ? new ResizeObserver(onResize) : null;

  // Physical keys. Copy, cut and paste shortcuts are taken first by the shared
  // clipboard code (capture phase), which sends them itself.
  const down = new Map<string, number>();
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.isComposing) return;
    const ks = keysymOf(e, isMac);
    if (!ks) return;
    e.preventDefault();
    down.set(e.code, ks);
    input(voxlCmd.key(ks, true));
  };
  const onKeyUp = (e: KeyboardEvent) => {
    const ks = down.get(e.code);
    if (ks === undefined) return;
    e.preventDefault();
    down.delete(e.code);
    input(voxlCmd.key(ks, false));
  };
  const onBlur = () => {
    if (down.size) {
      down.clear();
      input(voxlCmd.releaseAll);
    }
  };

  const clipboard = Object.assign(new EventTarget(), {
    viewOnly: false,
    sendKey(keysym: number, _code: string | null, isDown = true) {
      input(voxlCmd.key(keysym, isDown));
    },
    clipboardPasteFrom(text: string) {
      input(voxlCmd.clipboard(text));
    },
  }) as VoxlClipboardTarget;

  const tapKey = (keysym: number) => {
    input(voxlCmd.key(keysym, true));
    input(voxlCmd.key(keysym, false));
  };

  surface.addEventListener("pointermove", onPointerMove);
  surface.addEventListener("pointerdown", onPointerDown);
  surface.addEventListener("pointerup", onPointerUp);
  surface.addEventListener("pointercancel", onPointerCancel);
  surface.addEventListener("wheel", onWheel, { passive: false });
  surface.addEventListener("contextmenu", onContextMenu);
  surface.addEventListener("keydown", onKeyDown);
  surface.addEventListener("keyup", onKeyUp);
  surface.addEventListener("blur", onBlur);
  window.addEventListener("resize", onResize);
  resizeObserver?.observe(surface);
  window.visualViewport?.addEventListener("resize", onResize);
  window.visualViewport?.addEventListener("scroll", onResize);

  return {
    send: input,
    clipboard,
    tapKey,
    typeText(text: string) {
      for (const ch of text) {
        if (ch === "\n") tapKey(0xff0d);
        else tapKey(keysymOf({ code: "", key: ch }, isMac));
      }
    },
    close() {
      if (closed) return;
      trackpad.dispose();
      send(voxlCmd.releaseAll);
      closed = true;
      clearInterval(statsTimer);
      surface.removeEventListener("pointermove", onPointerMove);
      surface.removeEventListener("pointerdown", onPointerDown);
      surface.removeEventListener("pointerup", onPointerUp);
      surface.removeEventListener("pointercancel", onPointerCancel);
      surface.removeEventListener("wheel", onWheel);
      surface.removeEventListener("contextmenu", onContextMenu);
      surface.removeEventListener("keydown", onKeyDown);
      surface.removeEventListener("keyup", onKeyUp);
      surface.removeEventListener("blur", onBlur);
      window.removeEventListener("resize", onResize);
      resizeObserver?.disconnect();
      window.visualViewport?.removeEventListener("resize", onResize);
      window.visualViewport?.removeEventListener("scroll", onResize);
      applyCamera(null);
      if (opts.cursor) opts.cursor.style.display = "none";
      resetDecoder();
      try { socket.close(); } catch {}
    },
  };
}
