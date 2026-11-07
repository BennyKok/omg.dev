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
  const pointer = { w: 0, h: 0, hx: 0, hy: 0, url: "", x: -1, y: -1, touch: false };

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
  const moveTo = (clientX: number, clientY: number, touch: boolean) => {
    if (!desk.w) return;
    const [x, y] = toDesk({ clientX, clientY });
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
  const click = (button: number) => {
    input(voxlCmd.button(button, true));
    input(voxlCmd.button(button, false));
  };

  // Touch, as voxl's own client does it: tap clicks, drag left-drags (selects
  // text), long press right-clicks, two fingers scroll, a quick second tap
  // double-clicks the same spot.
  const SLOP = 10, LONG_PRESS = 550, MULTI_TAP_MS = 400, MULTI_TAP_PX = 24;
  const pts = new Map<number, { x: number; y: number }>();
  let mode: "pending" | "drag" | "scroll" | "done" | null = null;
  let start = { x: 0, y: 0 };
  let pressTimer: ReturnType<typeof setTimeout> | undefined;
  let lastMid: [number, number] = [0, 0];
  let lastTap = { x: 0, y: 0, t: -Infinity };
  const mid = (): [number, number] => {
    let x = 0, y = 0;
    for (const p of pts.values()) { x += p.x; y += p.y; }
    return [x / pts.size, y / pts.size];
  };
  const touchDown = (e: PointerEvent) => {
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pts.size === 1) {
      mode = "pending";
      start = { x: e.clientX, y: e.clientY };
      pressTimer = setTimeout(() => {
        if (mode !== "pending") return;
        moveTo(start.x, start.y, true);
        click(3);
        mode = "done";
        navigator.vibrate?.(10);
      }, LONG_PRESS);
    } else if (pts.size === 2) {
      clearTimeout(pressTimer);
      if (mode === "drag") input(voxlCmd.button(1, false));
      mode = "scroll";
      lastMid = mid();
    }
  };
  const touchMove = (e: PointerEvent) => {
    const p = pts.get(e.pointerId);
    if (!p) return;
    p.x = e.clientX;
    p.y = e.clientY;
    if (mode === "pending" && Math.hypot(p.x - start.x, p.y - start.y) > SLOP) {
      clearTimeout(pressTimer);
      mode = "drag";
      moveTo(start.x, start.y, true);
      input(voxlCmd.button(1, true));
    }
    if (mode === "drag") moveTo(p.x, p.y, true);
    else if (mode === "scroll" && pts.size >= 2) {
      const m = mid(), k = deskPerPx();
      queueScroll((lastMid[0] - m[0]) * k, (lastMid[1] - m[1]) * k);
      lastMid = m;
    }
  };
  const touchUp = (e: PointerEvent) => {
    if (!pts.delete(e.pointerId)) return;
    if (mode === "pending") {
      clearTimeout(pressTimer);
      const now = performance.now();
      const at = now - lastTap.t < MULTI_TAP_MS && Math.hypot(start.x - lastTap.x, start.y - lastTap.y) < MULTI_TAP_PX
        ? lastTap : start;
      lastTap = { x: at.x, y: at.y, t: now };
      moveTo(at.x, at.y, true);
      click(1);
      mode = "done";
    } else if (mode === "drag") {
      input(voxlCmd.button(1, false));
      mode = "done";
    } else if (mode === "scroll" && pts.size < 2) mode = "done";
    if (pts.size === 0) mode = null;
  };
  const touchCancel = (e: PointerEvent) => {
    clearTimeout(pressTimer);
    if (mode === "drag") input(voxlCmd.button(1, false));
    pts.delete(e.pointerId);
    if (pts.size === 0) mode = null;
  };

  const onPointerMove = (e: PointerEvent) => {
    if (e.pointerType === "touch") touchMove(e);
    else moveTo(e.clientX, e.clientY, false);
  };
  const onPointerDown = (e: PointerEvent) => {
    e.preventDefault();
    try { surface.setPointerCapture(e.pointerId); } catch {}
    if (e.pointerType === "touch") {
      touchDown(e);
      return;
    }
    surface.focus({ preventScroll: true });
    moveTo(e.clientX, e.clientY, false);
    input(voxlCmd.button(BUTTONS[e.button] ?? 1, true));
  };
  const onPointerUp = (e: PointerEvent) => {
    e.preventDefault();
    if (e.pointerType === "touch") {
      touchUp(e);
      return;
    }
    moveTo(e.clientX, e.clientY, false);
    input(voxlCmd.button(BUTTONS[e.button] ?? 1, false));
  };
  const onPointerCancel = (e: PointerEvent) => {
    if (e.pointerType === "touch") touchCancel(e);
    else input(voxlCmd.releaseAll);
  };
  const onWheel = (e: WheelEvent) => {
    e.preventDefault();
    moveTo(e.clientX, e.clientY, false);
    const k = (e.deltaMode === 1 ? 40 : e.deltaMode === 2 ? 800 : 1) * deskPerPx();
    queueScroll(e.deltaX * k, e.deltaY * k);
  };
  const onContextMenu = (e: Event) => e.preventDefault();
  const onResize = () => drawPointer();

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
      send(voxlCmd.releaseAll);
      closed = true;
      clearInterval(statsTimer);
      clearTimeout(pressTimer);
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
      if (opts.cursor) opts.cursor.style.display = "none";
      resetDecoder();
      try { socket.close(); } catch {}
    },
  };
}
