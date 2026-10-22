// Drag maths for the drag field (TouchControls kind "drag"). No React and no
// DOM in this file.
//
// Relative mode (the default) is a floating stick: the point where the finger
// lands is the centre, and the offset from it is the stick value. When the
// finger goes further than `radius`, the centre follows it, so a change of
// direction acts at once. It writes the same stick as the joystick, so game
// rules read it with axisX and axisY and need no change.
//
// Absolute mode gives the finger position on the field (0..1), for a paddle
// or a basket that sits under the finger. Rules read it with dragTarget.

export type DragAxes = "x" | "y" | "xy";
export type Point = { x: number; y: number };

/**
 * Relative drag. `anchor` is the floating centre, `finger` the finger, both in
 * px. Returns the stick value (-1..1 on each used axis) and the new centre.
 * A small dead zone stops drift from a resting finger.
 */
export function dragStick(anchor: Point, finger: Point, radius: number, axes: DragAxes = "xy", deadZone = 0.15): { x: number; y: number; anchor: Point } {
  const useX = axes !== "y";
  const useY = axes !== "x";
  let dx = useX ? finger.x - anchor.x : 0;
  let dy = useY ? finger.y - anchor.y : 0;
  const len = Math.hypot(dx, dy);
  let next = anchor;
  if (radius > 0 && len > radius) {
    // The centre follows the finger and stays `radius` behind it.
    const k = (len - radius) / len;
    next = { x: anchor.x + dx * k, y: anchor.y + dy * k };
    dx = useX ? finger.x - next.x : 0;
    dy = useY ? finger.y - next.y : 0;
  }
  const x = radius > 0 ? dx / radius : 0;
  const y = radius > 0 ? dy / radius : 0;
  if (Math.hypot(x, y) < deadZone) return { x: 0, y: 0, anchor: next };
  return { x, y, anchor: next };
}

/** Absolute drag: the finger position inside `rect` as 0..1 across and down, clamped to the field. */
export function dragPosition(finger: Point, rect: { left: number; top: number; width: number; height: number }): Point {
  const clamp = (v: number) => Math.min(1, Math.max(0, v));
  return {
    x: rect.width > 0 ? clamp((finger.x - rect.left) / rect.width) : 0.5,
    y: rect.height > 0 ? clamp((finger.y - rect.top) / rect.height) : 0.5,
  };
}

/** Two players share the field: a finger that lands on the left half is P1, on the right half P2. */
export function dragPlayer(fingerX: number, rect: { left: number; width: number }, players: 1 | 2): "p1" | "p2" {
  return players === 2 && fingerX >= rect.left + rect.width / 2 ? "p2" : "p1";
}
