// Trackpad pointing for a finger on the voxl screen.
//
// Absolute pointing is right for a mouse and wrong for a finger: the target
// ends up under your own hand, there is no hover to aim with, and a tap
// teleports the pointer. So a finger drives the pointer like a laptop
// trackpad, and on the full page the view moves over the desktop like a
// camera (lib/computer-camera.ts) that follows the pointer.
//
//   one finger drag          moves the pointer (mild acceleration)
//   tap                      left-clicks where the POINTER is
//   two quick taps           double-click (both land on the same spot)
//   long press, release      right-click
//   long press, then drag    holds the left button: select text, drag things
//   two fingers slide        scroll
//   two fingers pinch        zoom the camera
//
// Pure and DOM-free: the stream (lib/voxl-stream.ts) owns the socket and the
// elements, and hands this module what it needs through `TrackpadIO`.

import {
  clampToDesk,
  followCursor,
  keepCursorInView,
  panCamera,
  viewCentre,
  zoomAbout,
  type Camera,
  type CameraView,
  type DeskPoint,
  type Size,
} from "./computer-camera";

/** The camera's window, in px, plus where it sits on the page. */
export interface TrackpadView extends CameraView {
  left: number;
  topOnPage: number;
}

export interface TrackpadIO {
  desk(): Size | null;
  view(): TrackpadView | null;
  /** The camera now. Without a camera, the fitted picture's scale and place. */
  camera(): Camera | null;
  /** Show this camera. Ignored when the view cannot zoom. */
  setCamera(camera: Camera): void;
  /** False in the fitted view: a pinch then scrolls instead of zooming. */
  canZoom(): boolean;
  /** Put the remote pointer here, in desktop px. */
  moveTo(at: DeskPoint): void;
  /** X button numbers: 1 left, 3 right. */
  button(button: 1 | 3, down: boolean): void;
  /** Scroll by desktop px. */
  scroll(dx: number, dy: number): void;
  /** Run `fn` after `ms`; returns a cancel. */
  later(fn: () => void, ms: number): () => void;
  /** A short haptic tick, where the device has one. */
  buzz?(): void;
}

/** Finger travel, in screen px, that turns a touch into a move. */
export const TRACKPAD_SLOP_PX = 6;
/** How long a still finger waits before it becomes a right-click or a drag. */
export const TRACKPAD_LONG_PRESS_MS = 500;
/** Pinch ratio change that decides a two-finger gesture is a zoom. */
const PINCH_LOCK = 0.12;
/** Two-finger travel, in screen px, that decides it is a scroll. */
const SCROLL_LOCK_PX = 10;

type Mode =
  | "pending" // one finger down, still
  | "held" // long press reached, still
  | "move" // one finger moving the pointer
  | "drag" // long press then move: left button held
  | "two" // two fingers, not yet a zoom or a scroll
  | "zoom"
  | "scroll"
  | "done"; // gesture over, wait for every finger to lift

export interface VoxlTrackpad {
  down(id: number, x: number, y: number): void;
  move(id: number, x: number, y: number): void;
  up(id: number): void;
  cancel(id: number): void;
  /** Where the pointer is, in desktop px, once a finger has placed it. */
  cursor(): DeskPoint | null;
  /** Keep the pointer on screen after the camera moved for another reason. */
  relayout(): void;
  dispose(): void;
}

export function createVoxlTrackpad(io: TrackpadIO): VoxlTrackpad {
  const pts = new Map<number, { x: number; y: number }>();
  let mode: Mode | null = null;
  let cursor: DeskPoint | null = null;
  let start = { x: 0, y: 0 };
  let last = { x: 0, y: 0 };
  /** The first touch only shows the pointer; it does not click. */
  let reveal = false;
  let cancelPress: (() => void) | null = null;
  let pinch0 = { distance: 0, x: 0, y: 0 };
  let pinch = { distance: 0, x: 0, y: 0 };

  const stopPress = () => {
    cancelPress?.();
    cancelPress = null;
  };

  const two = () => {
    const [a, b] = [...pts.values()];
    return { distance: Math.hypot(a.x - b.x, a.y - b.y), x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  };

  /** Put the pointer at `at`, bring the camera along, and send it. */
  const place = (at: DeskPoint) => {
    const desk = io.desk();
    const view = io.view();
    const camera = io.camera();
    cursor = desk ? clampToDesk(at, desk) : at;
    if (desk && view && camera && io.canZoom()) io.setCamera(followCursor(camera, view, desk, cursor));
    io.moveTo(cursor);
  };

  /** The pointer, placed in the middle of the view if no finger has placed it yet. */
  const ensureCursor = (): boolean => {
    if (cursor) return true;
    const desk = io.desk();
    const view = io.view();
    const camera = io.camera();
    if (!desk || !view || !camera) return false;
    place(viewCentre(camera, view, desk));
    return true;
  };

  const moveBy = (dx: number, dy: number) => {
    const camera = io.camera();
    if (!camera || !cursor) return;
    // Mild acceleration: slow drags stay precise, fast ones cross the screen.
    // Finger travel is screen px; zoomed in, the same travel is a finer move.
    const speed = Math.min(2.5, 1 + Math.hypot(dx, dy) / 12) / camera.scale;
    place({ x: cursor.x + dx * speed, y: cursor.y + dy * speed });
  };

  const click = (button: 1 | 3) => {
    if (!cursor) return;
    io.moveTo(cursor);
    io.button(button, true);
    io.button(button, false);
  };

  const releaseDrag = () => {
    if (mode === "drag") io.button(1, false);
  };

  const zoomBy = (next: typeof pinch, prev: typeof pinch) => {
    const desk = io.desk();
    const view = io.view();
    let camera = io.camera();
    if (!desk || !view || !camera) return;
    if (prev.distance > 0) {
      camera = zoomAbout(
        camera,
        camera.scale * (next.distance / prev.distance),
        { x: next.x - view.left, y: next.y - view.topOnPage },
        view,
        desk,
      );
    }
    camera = panCamera(camera, next.x - prev.x, next.y - prev.y, view, desk);
    io.setCamera(camera);
    if (cursor) {
      const kept = keepCursorInView(cursor, camera, view, desk);
      if (kept.x !== cursor.x || kept.y !== cursor.y) {
        cursor = kept;
        io.moveTo(kept);
      }
    }
  };

  return {
    down(id, x, y) {
      pts.set(id, { x, y });
      if (pts.size === 1) {
        mode = "pending";
        start = last = { x, y };
        reveal = !cursor;
        if (!ensureCursor()) {
          mode = "done";
          return;
        }
        cancelPress = io.later(() => {
          cancelPress = null;
          if (mode !== "pending") return;
          mode = "held";
          io.buzz?.();
        }, TRACKPAD_LONG_PRESS_MS);
      } else if (pts.size === 2) {
        stopPress();
        releaseDrag();
        mode = "two";
        pinch0 = pinch = two();
      }
    },

    move(id, x, y) {
      const p = pts.get(id);
      if (!p) return;
      p.x = x;
      p.y = y;
      if (pts.size >= 2) {
        if (mode !== "two" && mode !== "zoom" && mode !== "scroll") return;
        const next = two();
        if (mode === "two") {
          const ratio = pinch0.distance > 0 ? next.distance / pinch0.distance : 1;
          if (io.canZoom() && Math.abs(ratio - 1) > PINCH_LOCK) mode = "zoom";
          else if (Math.hypot(next.x - pinch0.x, next.y - pinch0.y) > SCROLL_LOCK_PX) mode = "scroll";
        }
        if (mode === "zoom") zoomBy(next, pinch);
        else if (mode === "scroll") {
          const scale = io.camera()?.scale || 1;
          // Natural scrolling: the page follows the fingers.
          io.scroll((pinch.x - next.x) / scale, (pinch.y - next.y) / scale);
        }
        // Until the gesture locks, keep the reference so the first step is not lost.
        if (mode !== "two") pinch = next;
        return;
      }
      if (mode === "pending" || mode === "held") {
        if (Math.hypot(x - start.x, y - start.y) <= TRACKPAD_SLOP_PX) return;
        stopPress();
        if (mode === "held") io.button(1, true);
        mode = mode === "held" ? "drag" : "move";
      }
      if (mode !== "move" && mode !== "drag") return;
      const dx = x - last.x;
      const dy = y - last.y;
      last = { x, y };
      moveBy(dx, dy);
    },

    up(id) {
      if (!pts.delete(id)) return;
      if (pts.size === 0) {
        stopPress();
        // A tap clicks WHERE THE POINTER IS, not where the finger landed.
        if (mode === "pending" && !reveal) click(1);
        else if (mode === "held") click(3);
        else releaseDrag();
        mode = null;
        return;
      }
      if (pts.size === 1 && (mode === "two" || mode === "zoom" || mode === "scroll")) {
        // The finger still down carries on from where it is, moving the pointer.
        const [rest] = [...pts.values()];
        last = { ...rest };
        mode = "move";
      }
    },

    cancel(id) {
      if (!pts.delete(id)) return;
      stopPress();
      releaseDrag();
      mode = pts.size ? "done" : null;
    },

    cursor: () => cursor,

    relayout() {
      if (!cursor) return;
      const desk = io.desk();
      const view = io.view();
      const camera = io.camera();
      if (!desk || !view || !camera) return;
      if (io.canZoom()) io.setCamera(followCursor(camera, view, desk, cursor));
      io.moveTo(cursor);
    },

    dispose() {
      stopPress();
      releaseDrag();
      pts.clear();
      mode = null;
    },
  };
}
