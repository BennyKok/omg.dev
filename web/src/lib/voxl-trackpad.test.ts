import { beforeEach, expect, test } from "bun:test";
import { coverScale, type Camera } from "./computer-camera";
import { createVoxlTrackpad, TRACKPAD_SLOP_PX, type TrackpadIO, type VoxlTrackpad } from "./voxl-trackpad";

const desk = { width: 1280, height: 800 };
// A portrait phone. The camera fills it with the desktop, as the page does.
const view = { width: 390, height: 750, left: 0, topOnPage: 0 };

let sent: string[];
let camera: Camera;
let zoomable: boolean;
let timers: Array<{ fn: () => void; live: boolean }>;
let pad: VoxlTrackpad;

const fireTimers = () => {
  for (const t of timers.splice(0)) if (t.live) t.fn();
};

beforeEach(() => {
  sent = [];
  timers = [];
  zoomable = true;
  camera = { scale: coverScale(view, desk), x: 0, y: 0 };
  const io: TrackpadIO = {
    desk: () => desk,
    view: () => view,
    camera: () => camera,
    setCamera: (next) => {
      camera = next;
    },
    canZoom: () => zoomable,
    moveTo: (at) => sent.push(`m,${Math.round(at.x)},${Math.round(at.y)}`),
    button: (b, down) => sent.push(`b,${b},${down ? 1 : 0}`),
    scroll: (dx, dy) => sent.push(`s,${Math.round(dx)},${Math.round(dy)}`),
    later: (fn) => {
      const t = { fn, live: true };
      timers.push(t);
      return () => {
        t.live = false;
      };
    },
  };
  pad = createVoxlTrackpad(io);
});

const tap = (x = 100, y = 100) => {
  pad.down(1, x, y);
  pad.up(1);
};
const clicks = () => sent.filter((s) => s.startsWith("b,"));

test("the first touch shows the pointer in the middle of the view and does not click", () => {
  tap(10, 10);
  expect(pad.cursor()).not.toBeNull();
  expect(clicks()).toEqual([]);
  const at = pad.cursor()!;
  // The middle of what the phone shows, not where the finger landed.
  expect(at.x * camera.scale + camera.x).toBeCloseTo(view.width / 2, 0);
  expect(at.y * camera.scale + camera.y).toBeCloseTo(view.height / 2, 0);
});

test("a drag moves the pointer by the finger's travel, not to the finger", () => {
  tap();
  const from = pad.cursor()!;
  pad.down(1, 300, 600);
  pad.move(1, 300 + 2, 600);
  pad.move(1, 300 + 10, 600);
  pad.up(1);
  const to = pad.cursor()!;
  expect(to.x).toBeGreaterThan(from.x);
  expect(to.y).toBeCloseTo(from.y);
  // Nowhere near the finger at 310,600 on screen.
  expect(Math.abs(to.x * camera.scale + camera.x - 310)).toBeGreaterThan(50);
  expect(clicks()).toEqual([]);
});

test("a tap left-clicks where the pointer is", () => {
  tap();
  const at = pad.cursor()!;
  sent = [];
  tap(5, 700);
  expect(sent).toEqual([`m,${Math.round(at.x)},${Math.round(at.y)}`, "b,1,1", "b,1,0"]);
});

test("a wobble inside the slop is still a tap", () => {
  tap();
  sent = [];
  pad.down(1, 100, 100);
  pad.move(1, 100 + TRACKPAD_SLOP_PX - 1, 100);
  pad.up(1);
  expect(clicks()).toEqual(["b,1,1", "b,1,0"]);
});

test("a long press right-clicks on release", () => {
  tap();
  sent = [];
  pad.down(1, 100, 100);
  fireTimers();
  expect(clicks()).toEqual([]);
  pad.up(1);
  expect(clicks()).toEqual(["b,3,1", "b,3,0"]);
});

test("a long press then a drag holds the left button to select", () => {
  tap();
  sent = [];
  pad.down(1, 100, 100);
  fireTimers();
  pad.move(1, 120, 100);
  pad.move(1, 140, 110);
  expect(clicks()).toEqual(["b,1,1"]);
  pad.up(1);
  expect(clicks()).toEqual(["b,1,1", "b,1,0"]);
});

test("a long press timer that fires after a move does nothing", () => {
  tap();
  sent = [];
  pad.down(1, 100, 100);
  const pending = timers.slice();
  pad.move(1, 140, 100);
  for (const t of pending) t.fn();
  pad.up(1);
  expect(clicks()).toEqual([]);
});

test("two fingers sliding together scroll and do not zoom", () => {
  tap();
  const scale = camera.scale;
  sent = [];
  pad.down(1, 100, 400);
  pad.down(2, 200, 400);
  pad.move(1, 100, 380);
  pad.move(2, 200, 380);
  pad.move(1, 100, 340);
  pad.move(2, 200, 340);
  pad.up(1);
  pad.up(2);
  expect(camera.scale).toBe(scale);
  const scroll = sent.filter((s) => s.startsWith("s,"));
  expect(scroll.length).toBeGreaterThan(0);
  // Fingers up, content down: natural scrolling, in desktop px.
  const dy = scroll.map((s) => Number(s.split(",")[2])).reduce((a, b) => a + b, 0);
  expect(dy).toBeGreaterThan(0);
  expect(clicks()).toEqual([]);
});

test("a pinch zooms the camera and keeps the pointer on screen", () => {
  tap();
  const scale = camera.scale;
  pad.down(1, 150, 400);
  pad.down(2, 250, 400);
  pad.move(1, 100, 400);
  pad.move(2, 300, 400);
  pad.up(1);
  pad.up(2);
  expect(camera.scale).toBeGreaterThan(scale);
  const at = pad.cursor()!;
  const sx = at.x * camera.scale + camera.x;
  const sy = at.y * camera.scale + camera.y;
  expect(sx).toBeGreaterThanOrEqual(0);
  expect(sx).toBeLessThanOrEqual(view.width);
  expect(sy).toBeGreaterThanOrEqual(0);
  expect(sy).toBeLessThanOrEqual(view.height);
  expect(clicks()).toEqual([]);
});

test("without a camera a pinch scrolls instead of zooming", () => {
  zoomable = false;
  tap();
  const before = { ...camera };
  sent = [];
  pad.down(1, 150, 400);
  pad.down(2, 250, 400);
  pad.move(1, 100, 380);
  pad.move(2, 300, 380);
  pad.up(1);
  pad.up(2);
  expect(camera).toEqual(before);
  expect(sent.some((s) => s.startsWith("s,"))).toBe(true);
});

test("the camera follows the pointer to the edge of the desktop", () => {
  tap();
  const x0 = camera.x;
  pad.down(1, 100, 400);
  for (let x = 100; x <= 3000; x += 20) pad.move(1, x, 400);
  pad.up(1);
  expect(camera.x).toBeLessThan(x0);
  // The pointer reached the right edge, and the right edge is on screen.
  expect(pad.cursor()!.x).toBe(desk.width - 1);
  expect(camera.x + desk.width * camera.scale).toBeCloseTo(view.width);
});

test("a cancelled drag lets go of the button", () => {
  tap();
  sent = [];
  pad.down(1, 100, 100);
  fireTimers();
  pad.move(1, 140, 100);
  pad.cancel(1);
  expect(clicks()).toEqual(["b,1,1", "b,1,0"]);
});
