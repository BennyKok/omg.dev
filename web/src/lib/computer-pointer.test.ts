import { afterEach, beforeEach, expect, test } from "bun:test";
import { window } from "../test-support/render";
import { dispatchComputerMouse } from "./computer-pointer";

Object.assign(globalThis, {
  MouseEvent: window.MouseEvent,
  MutationObserver: window.MutationObserver,
});
const { default: RFB } = await import("@novnc/novnc");

let canvas: HTMLCanvasElement;
let packets: Array<{ x: number; y: number; mask: number }>;

beforeEach(() => {
  canvas = document.createElement("canvas");
  document.body.appendChild(canvas);
  canvas.getBoundingClientRect = () => ({
    x: 0, y: 0, left: 0, top: 0, right: 800, bottom: 600,
    width: 800, height: 600, toJSON() {},
  });
  packets = [];
  // Use noVNC's real input/capture handlers, without a remote framebuffer.
  // Only the wire output is replaced, so a leaked capture layer is observable.
  const rfb = Object.create(RFB.prototype);
  Object.assign(rfb, {
    _canvas: canvas,
    _mouseButtonMask: 0,
    _mouseMoveTimer: null,
    _mouseLastMoveTime: 0,
    _sendMouse(x: number, y: number, mask: number) {
      packets.push({ x, y, mask });
    },
  });
  for (const type of ["mousedown", "mouseup", "mousemove"]) {
    canvas.addEventListener(type, (event) => rfb._handleMouse(event));
  }
});

afterEach(() => {
  // Release a leaked capture even when the regression assertion fails.
  window.dispatchEvent(new window.MouseEvent("mouseup"));
  canvas.remove();
});

for (const button of [0, 2]) {
  test(`button ${button} releases capture before the next trackpad gesture`, () => {
    for (let gesture = 0; gesture < 3; gesture++) {
      const at = { x: 120 + gesture * 30, y: 160 };
      dispatchComputerMouse(canvas, at, "mousemove", 0);
      dispatchComputerMouse(canvas, at, "mousedown", button === 2 ? 2 : 1, button);
      const capture = document.getElementById("noVNC_mouse_capture_elem")!;
      expect(capture.style.display).not.toBe("none");
      dispatchComputerMouse(canvas, at, "mouseup", 0, button);
      expect(capture.style.display).toBe("none");
      expect(packets.slice(-2)).toEqual([
        { ...at, mask: button === 2 ? 4 : 1 },
        { ...at, mask: 0 },
      ]);
    }
  });
}

test("ordinary mouse drag still uses noVNC capture", () => {
  canvas.dispatchEvent(new window.MouseEvent("mousedown", {
    bubbles: true, clientX: 40, clientY: 50, buttons: 1,
  }));
  window.dispatchEvent(new window.MouseEvent("mousemove", {
    clientX: 90, clientY: 100, buttons: 1,
  }));
  window.dispatchEvent(new window.MouseEvent("mouseup", {
    clientX: 90, clientY: 100, buttons: 0,
  }));
  expect(packets).toEqual([
    { x: 40, y: 50, mask: 1 },
    { x: 90, y: 100, mask: 1 },
    { x: 90, y: 100, mask: 0 },
  ]);
  expect(document.getElementById("noVNC_mouse_capture_elem")!.style.display).toBe("none");
});
