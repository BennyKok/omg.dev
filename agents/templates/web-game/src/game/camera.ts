// A follow camera. The camera holds the world point shown at the centre of the
// view. Drawing code subtracts it: screenX = (worldX - cam.x) * zoom + viewW / 2.
//
// No React and no DOM in this file.
import { clamp, type Rect, type Vec } from "./collision";

export type Camera = { x: number; y: number; zoom: number };

export const createCamera = (x = 0, y = 0, zoom = 1): Camera => ({ x, y, zoom });

export type FollowOptions = {
  /** 0 = frozen, 1 = snap. Per step the camera closes this share of the gap, scaled by dt. */
  stiffness?: number;
  /** Seconds of target velocity to look ahead. */
  lookAhead?: number;
  velocity?: Vec;
  /** Keep the view inside this world. */
  world?: Rect;
  viewW?: number;
  viewH?: number;
};

export function followCamera(cam: Camera, target: Vec, dt: number, o: FollowOptions = {}): void {
  const stiffness = o.stiffness ?? 8; // per second
  const k = 1 - Math.exp(-stiffness * dt);
  const ahead = o.lookAhead ?? 0;
  const tx = target.x + (o.velocity?.x ?? 0) * ahead;
  const ty = target.y + (o.velocity?.y ?? 0) * ahead;
  cam.x += (tx - cam.x) * k;
  cam.y += (ty - cam.y) * k;
  if (o.world && o.viewW && o.viewH) clampCamera(cam, o.world, o.viewW, o.viewH);
}

/** Keep the camera so the view never shows outside the world. A world smaller than the view is centred. */
export function clampCamera(cam: Camera, world: Rect, viewW: number, viewH: number): void {
  const halfW = viewW / cam.zoom / 2;
  const halfH = viewH / cam.zoom / 2;
  cam.x = world.w <= halfW * 2 ? world.x + world.w / 2 : clamp(cam.x, world.x + halfW, world.x + world.w - halfW);
  cam.y = world.h <= halfH * 2 ? world.y + world.h / 2 : clamp(cam.y, world.y + halfH, world.y + world.h - halfH);
}

export function worldToScreen(cam: Camera, p: Vec, viewW: number, viewH: number): Vec {
  return { x: (p.x - cam.x) * cam.zoom + viewW / 2, y: (p.y - cam.y) * cam.zoom + viewH / 2 };
}

export function screenToWorld(cam: Camera, p: Vec, viewW: number, viewH: number): Vec {
  return { x: (p.x - viewW / 2) / cam.zoom + cam.x, y: (p.y - viewH / 2) / cam.zoom + cam.y };
}
