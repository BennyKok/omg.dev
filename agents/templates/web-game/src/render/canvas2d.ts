// 2D renderer: canvas drawing helpers for a 2D world. Game state is in world units;
// `drawWorld` applies the camera, so a sprite only needs its world position.
// One <canvas> draws thousands of shapes per frame with no DOM work.
//
//   drawWorld(ctx, cam, view, { background: theme.background, floor: theme.world, worldSize: WORLD }, (ctx) => {
//     drawSprite(ctx, { x: p.x, y: p.y, size: 40, angle: p.angle, color: "#ff5a6a", shape: "circle" });
//   });
//
// `view` is the part of the canvas this camera fills, in CSS pixels. One
// player: the whole canvas. Split screen: one view per player (splitViewports).
import type { Camera } from "../game/camera";
import { cappedDpr, type CanvasSize, type Viewport } from "../game/view";

export type { Viewport };

/**
 * The 2D context of a canvas, with the pixel buffer sized for `size` and the
 * DPR capped at `maxDpr`. Call from a view's `resize`. Draw in CSS pixels.
 */
export function setup2d(canvas: HTMLCanvasElement, size: CanvasSize, maxDpr = 2): CanvasRenderingContext2D {
  const dpr = cappedDpr(size.dpr, maxDpr);
  canvas.width = Math.max(1, Math.round(size.width * dpr));
  canvas.height = Math.max(1, Math.round(size.height * dpr));
  const ctx = canvas.getContext("2d", { alpha: false });
  if (!ctx) throw new Error("This browser cannot draw on a 2D canvas.");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return ctx;
}

export type WorldStyle = {
  /** Outside the world. */
  background?: string;
  worldSize?: { w: number; h: number };
  /** The floor inside the world. */
  floor?: string;
  /** Checker tiles on the floor, in this colour, `tile` world units wide. */
  detail?: string;
  tile?: number;
  /** A thick rounded wall around the world. */
  edge?: string;
  edgeWidth?: number;
  radius?: number;
};

/** Clip to `view`, apply the camera, draw the floor, then call `draw` in world units. */
export function drawWorld(ctx: CanvasRenderingContext2D, cam: Camera, view: Viewport, style: WorldStyle, draw: (ctx: CanvasRenderingContext2D) => void): void {
  ctx.save();
  ctx.beginPath();
  ctx.rect(view.x, view.y, view.w, view.h);
  ctx.clip();
  ctx.fillStyle = style.background ?? "#2b3a55";
  ctx.fillRect(view.x, view.y, view.w, view.h);
  ctx.translate(view.x + view.w / 2 - cam.x * cam.zoom, view.y + view.h / 2 - cam.y * cam.zoom);
  ctx.scale(cam.zoom, cam.zoom);
  if (style.worldSize) {
    const { w, h } = style.worldSize;
    const r = style.radius ?? 28;
    const e = style.edgeWidth ?? 16;
    if (style.edge) {
      // The wall: a rounded frame, with a darker lower lip so it reads as raised.
      ctx.fillStyle = "rgba(0,0,0,0.12)";
      ctx.beginPath();
      ctx.roundRect(-e, -e + 6, w + e * 2, h + e * 2, r + e);
      ctx.fill();
      ctx.fillStyle = style.edge;
      ctx.beginPath();
      ctx.roundRect(-e, -e, w + e * 2, h + e * 2, r + e);
      ctx.fill();
    }
    ctx.save();
    ctx.beginPath();
    ctx.roundRect(0, 0, w, h, r);
    ctx.clip();
    ctx.fillStyle = style.floor ?? "rgba(255,255,255,0.05)";
    ctx.fillRect(0, 0, w, h);
    if (style.detail && style.tile) {
      // Soft checker tiles show movement when the camera follows.
      ctx.fillStyle = style.detail;
      const t = style.tile;
      for (let y = 0, row = 0; y < h; y += t, row++) {
        for (let x = (row % 2) * t; x < w; x += t * 2) {
          ctx.beginPath();
          ctx.roundRect(x + 3, y + 3, t - 6, t - 6, 10);
          ctx.fill();
        }
      }
    }
    // Inner shade along the top wall.
    const g = ctx.createLinearGradient(0, 0, 0, 24);
    g.addColorStop(0, "rgba(0,0,0,0.10)");
    g.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, 24);
    ctx.restore();
  }
  draw(ctx);
  ctx.restore();
}

/** A soft oval shadow on the floor under an object of radius r at (x, y). */
export function drawShadow(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, alpha = 0.16): void {
  ctx.save();
  ctx.fillStyle = `rgba(0,0,0,${alpha})`;
  ctx.beginPath();
  ctx.ellipse(x, y + r * 0.85, r * 0.95, r * 0.36, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

export type SpriteShape = "circle" | "rect";

export type Sprite = {
  x: number;
  y: number;
  size?: number;
  w?: number;
  h?: number;
  /** Radians. */
  angle?: number;
  color?: string;
  shape?: SpriteShape;
  /** An emoji or short text drawn in the middle. */
  label?: string;
  opacity?: number;
  borderColor?: string;
  /** A small highlight that makes a flat circle look round. */
  shine?: boolean;
  /** A loaded image (see `loadImage`). Drawn instead of the colour. */
  image?: CanvasImageSource | null;
};

/** A shape, emoji or image centred on (x, y) in world units. */
export function drawSprite(ctx: CanvasRenderingContext2D, s: Sprite): void {
  const w = s.w ?? s.size ?? 20;
  const h = s.h ?? s.size ?? 20;
  ctx.save();
  ctx.globalAlpha *= s.opacity ?? 1;
  ctx.translate(s.x, s.y);
  if (s.angle) ctx.rotate(s.angle);
  if (s.image) {
    ctx.drawImage(s.image, -w / 2, -h / 2, w, h);
  } else if (s.color || s.borderColor) {
    ctx.beginPath();
    if (s.shape === "circle") ctx.ellipse(0, 0, w / 2, h / 2, 0, 0, Math.PI * 2);
    else ctx.roundRect(-w / 2, -h / 2, w, h, Math.min(4, w / 2, h / 2));
    if (s.color) {
      ctx.fillStyle = s.color;
      ctx.fill();
    }
    if (s.borderColor) {
      ctx.lineWidth = 2;
      ctx.strokeStyle = s.borderColor;
      ctx.stroke();
    }
    if (s.shine && s.shape === "circle") {
      ctx.beginPath();
      ctx.ellipse(-w * 0.18, -h * 0.2, w * 0.2, h * 0.13, -0.6, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(255,255,255,0.45)";
      ctx.fill();
    }
  }
  if (s.label) {
    ctx.font = `${Math.min(w, h) * 0.6}px system-ui, "Apple Color Emoji", "Segoe UI Emoji", sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = "#ffffff";
    ctx.fillText(s.label, 0, 0);
  }
  ctx.restore();
}

/** Text in world units, such as a score popup. */
export function drawText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, size = 16, color = "#ffffff"): void {
  ctx.save();
  ctx.font = `800 ${size}px system-ui, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = color;
  ctx.fillText(text, x, y);
  ctx.restore();
}

const images = new Map<string, HTMLImageElement>();

/**
 * An image by URL (an art slot in src/app/art.ts, or "/sprites/car.png" from
 * public/), loaded once. Returns null until it has loaded, so draw the
 * placeholder shape until then:  `const img = src ? loadImage(src) : null`.
 */
export function loadImage(src: string): HTMLImageElement | null {
  let img = images.get(src);
  if (!img) {
    img = new Image();
    img.src = src;
    images.set(src, img);
  }
  return img.complete && img.naturalWidth > 0 ? img : null;
}
