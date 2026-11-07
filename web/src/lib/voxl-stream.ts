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
}

export interface VoxlStream {
  close(): void;
  send(command: string): void;
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

  function onCursor(buf: ArrayBuffer) {
    const v = new DataView(buf);
    const w = v.getUint16(2), h = v.getUint16(4), hx = v.getUint16(6), hy = v.getUint16(8);
    if (!w || !h || buf.byteLength < 14 + w * h * 4) {
      surface.style.cursor = "none";
      return;
    }
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    c.getContext("2d")?.putImageData(new ImageData(new Uint8ClampedArray(buf, 14, w * h * 4), w, h), 0, 0);
    surface.style.cursor = `url(${c.toDataURL("image/png")}) ${hx} ${hy}, default`;
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
  const move = (p: { clientX: number; clientY: number }) => {
    if (!desk.w) return;
    const s = voxlCmd.move(...toDesk(p));
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

  // Touch: a tap clicks where the finger is, a one-finger drag scrolls.
  let touch: { x: number; y: number; moved: boolean; at: number } | null = null;

  const onPointerMove = (e: PointerEvent) => {
    if (e.pointerType === "touch") {
      if (!touch) return;
      const dx = e.clientX - touch.x, dy = e.clientY - touch.y;
      if (Math.abs(dx) > 4 || Math.abs(dy) > 4) touch.moved = true;
      if (touch.moved) queueScroll(-dx * deskPerPx(), -dy * deskPerPx());
      touch.x = e.clientX;
      touch.y = e.clientY;
      return;
    }
    move(e);
  };
  const onPointerDown = (e: PointerEvent) => {
    e.preventDefault();
    surface.focus({ preventScroll: true });
    if (e.pointerType === "touch") {
      touch = { x: e.clientX, y: e.clientY, moved: false, at: Date.now() };
      return;
    }
    move(e);
    try { surface.setPointerCapture(e.pointerId); } catch {}
    input(voxlCmd.button(BUTTONS[e.button] ?? 1, true));
  };
  const onPointerUp = (e: PointerEvent) => {
    e.preventDefault();
    if (e.pointerType === "touch") {
      const t = touch;
      touch = null;
      if (t && !t.moved && Date.now() - t.at < 500) {
        move(e);
        input(voxlCmd.button(1, true));
        input(voxlCmd.button(1, false));
      }
      return;
    }
    move(e);
    input(voxlCmd.button(BUTTONS[e.button] ?? 1, false));
  };
  const onPointerCancel = () => {
    touch = null;
    input(voxlCmd.releaseAll);
  };
  const onWheel = (e: WheelEvent) => {
    e.preventDefault();
    move(e);
    const k = (e.deltaMode === 1 ? 40 : e.deltaMode === 2 ? 800 : 1) * deskPerPx();
    queueScroll(e.deltaX * k, e.deltaY * k);
  };
  const onContextMenu = (e: Event) => e.preventDefault();

  const down = new Map<string, number>();
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.isComposing) return;
    // Let the paste event carry the text: Ctrl/Cmd+V is sent after it.
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "v") return;
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
  const onPaste = (e: ClipboardEvent) => {
    const text = e.clipboardData?.getData("text/plain");
    if (!text) return;
    e.preventDefault();
    input(voxlCmd.clipboard(text));
    input(voxlCmd.key(XK_CONTROL_L, true));
    input(voxlCmd.key(0x76, true));
    input(voxlCmd.key(0x76, false));
    input(voxlCmd.key(XK_CONTROL_L, false));
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
  surface.addEventListener("paste", onPaste);

  return {
    send: input,
    close() {
      if (closed) return;
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
      surface.removeEventListener("paste", onPaste);
      resetDecoder();
      try { socket.close(); } catch {}
    },
  };
}
