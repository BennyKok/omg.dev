import { expect, test } from "bun:test";
import {
  clampCamera,
  coverScale,
  fitScale,
  followCursor,
  keepCursorInView,
  maxScale,
  panCamera,
  viewCentre,
  zoomAbout,
} from "./computer-camera";

const desk = { width: 1280, height: 800 };
// A portrait phone, below the control row.
const phone = { width: 390, height: 750 };

test("a phone opens with the desktop filling it, not fitted into a strip", () => {
  expect(fitScale(phone, desk)).toBeCloseTo(390 / 1280);
  expect(coverScale(phone, desk)).toBeCloseTo(750 / 800);
  const cam = clampCamera({ scale: coverScale(phone, desk), x: 0, y: 0 }, phone, desk);
  // Full height, no bar above or below.
  expect(cam.y).toBe(0);
  expect(desk.height * cam.scale).toBeCloseTo(750);
});

test("a desktop smaller than the view is centred, a larger one never shows an empty edge", () => {
  const fit = clampCamera({ scale: 0, x: 500, y: 500 }, phone, desk);
  expect(fit.scale).toBeCloseTo(fitScale(phone, desk));
  expect(fit.x).toBeCloseTo(0);
  expect(fit.y).toBeCloseTo((750 - 800 * fit.scale) / 2);

  const cover = clampCamera({ scale: coverScale(phone, desk), x: 200, y: 0 }, phone, desk);
  expect(cover.x).toBe(0);
  const right = clampCamera({ scale: coverScale(phone, desk), x: -5000, y: 0 }, phone, desk);
  expect(right.x).toBeCloseTo(390 - 1280 * cover.scale);
});

test("zoom stays between the whole desktop and the closest pinch", () => {
  expect(clampCamera({ scale: 99, x: 0, y: 0 }, phone, desk).scale).toBe(maxScale(phone, desk));
  expect(clampCamera({ scale: 0.01, x: 0, y: 0 }, phone, desk).scale).toBeCloseTo(fitScale(phone, desk));
});

test("the camera follows a cursor that nears the edge, and stays still otherwise", () => {
  const cam = clampCamera({ scale: 1, x: 0, y: 0 }, phone, desk);
  expect(followCursor(cam, phone, desk, { x: 100, y: 300 })).toEqual(cam);
  const moved = followCursor(cam, phone, desk, { x: 600, y: 300 }, 48);
  // The cursor ends 48px inside the right edge.
  expect(moved.x + 600 * moved.scale).toBeCloseTo(390 - 48);
});

test("with the keyboard up, the cursor is kept above it", () => {
  const view = { ...phone, top: 0, bottom: 400 };
  const cam = clampCamera({ scale: 1, x: 0, y: 0 }, view, desk);
  const moved = followCursor(cam, view, desk, { x: 100, y: 700 }, 48);
  expect(moved.y + 700 * moved.scale).toBeCloseTo(400 - 48);
  // And the desktop can scroll up far enough to show its bottom above the keyboard.
  const bottom = clampCamera({ scale: 1, x: 0, y: -5000 }, view, desk);
  expect(bottom.y + 800).toBeCloseTo(400);
});

test("a pinch keeps the point between the fingers in place", () => {
  const cam = clampCamera({ scale: 1, x: -300, y: -20 }, phone, desk);
  const at = { x: 200, y: 300 };
  const before = { x: (at.x - cam.x) / cam.scale, y: (at.y - cam.y) / cam.scale };
  const zoomed = zoomAbout(cam, 1.4, at, phone, desk);
  expect(zoomed.scale).toBe(1.4);
  expect(zoomed.x + before.x * zoomed.scale).toBeCloseTo(at.x);
  expect(zoomed.y + before.y * zoomed.scale).toBeCloseTo(at.y);
});

test("a pan slides the desktop and stops at its edges", () => {
  const cam = clampCamera({ scale: 1, x: -300, y: -20 }, phone, desk);
  expect(panCamera(cam, 50, 0, phone, desk).x).toBe(-250);
  expect(panCamera(cam, 5000, 0, phone, desk).x).toBe(0);
});

test("a cursor starts in the middle of what you see, and a pan never leaves it off screen", () => {
  const cam = clampCamera({ scale: 1, x: -300, y: -20 }, phone, desk);
  expect(viewCentre(cam, phone, desk)).toEqual({ x: 300 + 195, y: 20 + 375 });
  const kept = keepCursorInView({ x: 10, y: 10 }, cam, phone, desk);
  expect(kept).toEqual({ x: 300, y: 20 });
});
