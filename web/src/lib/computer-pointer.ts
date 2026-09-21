/** Feed the virtual trackpad cursor into noVNC's DOM input handlers. */
export function dispatchComputerMouse(
  canvas: HTMLCanvasElement,
  at: { x: number; y: number },
  type: "mousemove" | "mousedown" | "mouseup",
  buttons: number,
  button = 0,
) {
  // A press installs noVNC's window-level capture proxy. A release sent
  // straight to the canvas stops there and never reaches that proxy, leaving
  // its full-screen layer above the trackpad. Let the proxy forward the
  // release to the canvas and clean up its own capture.
  const target = type === "mouseup" ? canvas.ownerDocument.defaultView! : canvas;
  target.dispatchEvent(new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    clientX: at.x,
    clientY: at.y,
    button,
    buttons,
  }));
}
