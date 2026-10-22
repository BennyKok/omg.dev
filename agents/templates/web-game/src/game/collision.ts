// Small collision helpers for top-down and side-on games. Shapes are plain
// objects, so game state stays easy to save, copy and test.
//
// No React and no DOM in this file.

export type Vec = { x: number; y: number };
export type Circle = { x: number; y: number; r: number };
/** Rectangle by its top-left corner. */
export type Rect = { x: number; y: number; w: number; h: number };

export const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
export const dist = (a: Vec, b: Vec): number => Math.hypot(a.x - b.x, a.y - b.y);

export function circlesOverlap(a: Circle, b: Circle): boolean {
  const r = a.r + b.r;
  return (a.x - b.x) ** 2 + (a.y - b.y) ** 2 < r * r;
}

export function rectsOverlap(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

export function pointInRect(p: Vec, r: Rect): boolean {
  return p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h;
}

export function circleRectOverlap(c: Circle, r: Rect): boolean {
  const nx = clamp(c.x, r.x, r.x + r.w);
  const ny = clamp(c.y, r.y, r.y + r.h);
  return (c.x - nx) ** 2 + (c.y - ny) ** 2 < c.r * c.r;
}

/**
 * Move a circle out of a rectangle. Returns the push-out normal (unit vector)
 * when they overlapped, or null. Mutates the circle. Use the normal to bounce
 * or to slide.
 */
export function pushCircleOutOfRect(c: Circle, r: Rect): Vec | null {
  const nx = clamp(c.x, r.x, r.x + r.w);
  const ny = clamp(c.y, r.y, r.y + r.h);
  let dx = c.x - nx;
  let dy = c.y - ny;
  const d = Math.hypot(dx, dy);
  if (d >= c.r) return null;
  if (d === 0) {
    // Centre is inside the rectangle: leave by the nearest side.
    const left = c.x - r.x;
    const right = r.x + r.w - c.x;
    const top = c.y - r.y;
    const bottom = r.y + r.h - c.y;
    const m = Math.min(left, right, top, bottom);
    if (m === left) { c.x = r.x - c.r; return { x: -1, y: 0 }; }
    if (m === right) { c.x = r.x + r.w + c.r; return { x: 1, y: 0 }; }
    if (m === top) { c.y = r.y - c.r; return { x: 0, y: -1 }; }
    c.y = r.y + r.h + c.r;
    return { x: 0, y: 1 };
  }
  dx /= d;
  dy /= d;
  c.x = nx + dx * c.r;
  c.y = ny + dy * c.r;
  return { x: dx, y: dy };
}

/** Keep a circle inside a rectangular world. Returns which sides it touched. */
export function keepCircleInside(c: Circle, world: Rect): { x: -1 | 0 | 1; y: -1 | 0 | 1 } {
  const hit = { x: 0 as -1 | 0 | 1, y: 0 as -1 | 0 | 1 };
  if (c.x < world.x + c.r) { c.x = world.x + c.r; hit.x = -1; }
  else if (c.x > world.x + world.w - c.r) { c.x = world.x + world.w - c.r; hit.x = 1; }
  if (c.y < world.y + c.r) { c.y = world.y + c.r; hit.y = -1; }
  else if (c.y > world.y + world.h - c.r) { c.y = world.y + world.h - c.r; hit.y = 1; }
  return hit;
}

/** Shortest signed turn from angle a to angle b, in radians (-PI..PI). */
export function angleDiff(a: number, b: number): number {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}

/** Small seeded random generator, so levels and tests repeat. */
export function seeded(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}
