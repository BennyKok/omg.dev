import { afterEach, beforeEach, expect, test } from "bun:test";
import { mount, window, type Mounted } from "../test-support/render";
const { ImageLightbox } = await import("./ImageLightbox");
let ui: Mounted;
let closed: number;
const originalAnimate = window.HTMLElement.prototype.animate;
const dialog = () => document.querySelector('[role="dialog"]') as HTMLElement;
const picture = () => dialog().querySelector('img') as HTMLElement;
const backdrop = () => dialog().firstElementChild as HTMLElement;
function pointer(target: HTMLElement, type: string, id: number, x = 100, y = 100) {
  ui.flush(() => target.dispatchEvent(new window.PointerEvent(type, {
    bubbles: true, pointerId: id, pointerType: "touch", clientX: x, clientY: y,
  })));
}
beforeEach(() => {
  closed = 0;
  Object.defineProperty(window.HTMLElement.prototype, "animate", { configurable:true, writable:true, value:undefined });
  ui = mount();
  ui.render(<ImageLightbox src="test.png" width={400} height={300} open onClose={() => closed++} />);
  // happy-dom has no pointer capture; the browser gesture check covers it.
  for (const node of [dialog(), picture().parentElement!]) node.setPointerCapture = () => {};
});
afterEach(() => { ui.cleanup(); window.HTMLElement.prototype.animate = originalAnimate; });
test("pinching with a finger outside the image zooms without closing", () => {
  pointer(picture(), 'pointerdown', 1, 100);
  pointer(backdrop(), 'pointerdown', 2, 200);
  expect(closed).toBe(0);
  pointer(dialog(), 'pointermove', 2, 300);
  expect(dialog().textContent).toContain('200%');
  pointer(dialog(), 'pointermove', 2, 200);
  expect(dialog().textContent).toContain('100%');
  pointer(dialog(), 'pointerup', 2, 200);
  pointer(dialog(), 'pointerup', 1, 100);
  expect(closed).toBe(0);
});
test("cancelled touches never dismiss", () => {
  pointer(picture(), 'pointerdown', 1);
  pointer(picture(), 'pointercancel', 1);
  expect(closed).toBe(0);
});
test("only a completed backdrop tap dismisses", () => {
  pointer(backdrop(), 'pointerdown', 1);
  expect(closed).toBe(0);
  pointer(dialog(), 'pointerup', 1);
  expect(closed).toBe(1);
});
test("a slow drag across the backdrop is not a tap", () => {
  pointer(backdrop(), 'pointerdown', 1);
  for(let x=101;x<=115;x++) pointer(dialog(), 'pointermove', 1, x);
  pointer(dialog(), 'pointerup', 1, 115);
  expect(closed).toBe(0);
});
test("a first image tap leaves the viewer open for a double tap", () => {
  pointer(picture(), 'pointerdown', 1);
  pointer(picture(), 'pointerup', 1);
  expect(closed).toBe(0);
  ui.flush(() => picture().dispatchEvent(new window.MouseEvent('dblclick', { bubbles:true, clientX:100, clientY:100 })));
  expect(dialog().textContent).toContain('250%');
});
test("two fingers at minimum zoom never become a backdrop tap", () => {
  pointer(backdrop(), 'pointerdown', 1, 100);
  pointer(backdrop(), 'pointerdown', 2, 200);
  pointer(dialog(), 'pointerup', 2, 200);
  pointer(dialog(), 'pointerup', 1, 100);
  expect(closed).toBe(0);
});
test("lost capture cancels a tap and permits a fresh gesture", () => {
  pointer(backdrop(), 'pointerdown', 1);
  pointer(dialog(), 'lostpointercapture', 1);
  expect(closed).toBe(0);
  pointer(picture(), 'pointerdown', 2, 100);
  pointer(backdrop(), 'pointerdown', 3, 200);
  pointer(dialog(), 'pointermove', 3, 300);
  expect(dialog().textContent).toContain('200%');
  expect(closed).toBe(0);
});
