// Canvas drawing helpers for a 2D world. Game state is in world units;
// `drawWorld` applies the camera, so a sprite only needs its world position.
// One <canvas> draws thousands of shapes per frame with no DOM work.
//
//   drawWorld(ctx, cam, view, { background: "#2b3a55", worldSize: WORLD }, (ctx) => {
//     drawSprite(ctx, { x: p.x, y: p.y, size: 40, angle: p.angle, color: "#ff5a6a", shape: "circle" });
//   });
//
// `view` is the part of the canvas this camera fills, in CSS pixels. One
// player: the whole canvas. Split screen: one view per player.
import type { Camera } from "./camera";

export type Viewport = { x: number; y: number; w: number; h: number };

export function drawWorld(
  ctx: CanvasRenderingContext2D,
  cam: Camera,
  view: Viewport,
  options: { background?: string; worldSize?: { w: number; h: number } },
  draw: (ctx: CanvasRenderingContext2D) => void,
): void {
  ctx.save();
  ctx.beginPath();
  ctx.rect(view.x, view.y, view.w, view.h);
  ctx.clip();
  ctx.fillStyle = options.background ?? "#2b3a55";
  ctx.fillRect(view.x, view.y, view.w, view.h);
  ctx.translate(view.x + view.w / 2 - cam.x * cam.zoom, view.y + view.h / 2 - cam.y * cam.zoom);
  ctx.scale(cam.zoom, cam.zoom);
  if (options.worldSize) {
    ctx.fillStyle = "rgba(255,255,255,0.05)";
    ctx.fillRect(0, 0, options.worldSize.w, options.worldSize.h);
    ctx.lineWidth = 3;
    ctx.strokeStyle = "rgba(255,255,255,0.25)";
    ctx.strokeRect(0, 0, options.worldSize.w, options.worldSize.h);
  }
  draw(ctx);
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
 * An image from `public/` (for example "/sprites/car.png"), loaded once.
 * Returns null until it has loaded; `drawSprite` then draws nothing for it,
 * so pass a `color` too if the shape must show at once.
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
