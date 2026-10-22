// Joystick maths for the on-screen stick. No React and no DOM in this file.

/**
 * Turn a finger offset from the stick centre (in px) into a stick value.
 * `x`/`y` are -1..1 for `setStick`; `knobX`/`knobY` are the knob offset in px,
 * kept inside `radius`. A small dead zone stops drift from a resting thumb.
 */
export function stickFromOffset(dx: number, dy: number, radius: number, deadZone = 0.12): { x: number; y: number; knobX: number; knobY: number } {
  const len = Math.hypot(dx, dy);
  const k = len > radius ? radius / len : 1;
  const knobX = dx * k;
  const knobY = dy * k;
  const x = radius > 0 ? knobX / radius : 0;
  const y = radius > 0 ? knobY / radius : 0;
  if (Math.hypot(x, y) < deadZone) return { x: 0, y: 0, knobX, knobY };
  return { x, y, knobX, knobY };
}
