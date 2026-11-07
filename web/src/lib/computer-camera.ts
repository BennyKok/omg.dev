// The phone's camera on the Computer's desktop.
//
// A 1280x800 desktop fitted into a portrait phone is a strip a third of the
// screen tall with unreadable text and black above and below it. On a touch
// screen the page instead fills the phone with the desktop and moves over it
// like a camera: the view follows the cursor, a pinch zooms, two fingers pan.
//
// noVNC already scales its canvas to fit the element it sits in, and maps
// pointer events through that canvas's bounding box. So zooming is only a
// matter of making that element bigger than the screen, and panning a matter
// of moving it. Nothing here touches noVNC or the RFB protocol.
//
// Pure and DOM-free. Units: `scale` is screen px per desktop px, `x`/`y` are
// where the desktop's top-left corner sits in the view, in screen px.

export interface Size {
  width: number;
  height: number;
}

/**
 * The area the desktop is drawn in. `top`/`bottom` narrow the part that can be
 * seen, in view px, when the on-screen keyboard covers the bottom of it.
 */
export interface CameraView extends Size {
  top?: number;
  bottom?: number;
}

export interface Camera {
  scale: number;
  x: number;
  y: number;
}

/** A point on the desktop, in desktop px. */
export interface DeskPoint {
  x: number;
  y: number;
}

/** How close the cursor may come to the edge of the view before it pulls. */
export const CAMERA_FOLLOW_MARGIN_PX = 48;

const band = (view: CameraView) => {
  const top = Math.max(0, view.top ?? 0);
  const bottom = Math.min(view.height, view.bottom ?? view.height);
  return { top, bottom: Math.max(top, bottom) };
};

/** The whole desktop in view, with bars where the shapes differ. */
export function fitScale(view: Size, desk: Size): number {
  return Math.min(view.width / desk.width, view.height / desk.height);
}

/** The desktop filling the whole view, with no bars. Where a phone opens. */
export function coverScale(view: Size, desk: Size): number {
  return Math.max(view.width / desk.width, view.height / desk.height);
}

/** The closest a pinch can go: twice the fill, and never less than 1.5 to 1. */
export function maxScale(view: Size, desk: Size): number {
  return Math.max(coverScale(view, desk) * 2, 1.5);
}

/** Keep one axis on screen: centred when it fits, edge to edge when it does not. */
function clampAxis(offset: number, size: number, lo: number, hi: number): number {
  const span = hi - lo;
  if (size <= span) return lo + (span - size) / 2;
  return Math.min(lo, Math.max(hi - size, offset));
}

/** A camera inside its limits: zoom in range, and no empty edge where the desktop could be. */
export function clampCamera(camera: Camera, view: CameraView, desk: Size): Camera {
  const scale = Math.min(maxScale(view, desk), Math.max(fitScale(view, desk), camera.scale));
  const { top, bottom } = band(view);
  return {
    scale,
    x: clampAxis(camera.x, desk.width * scale, 0, view.width),
    y: clampAxis(camera.y, desk.height * scale, top, bottom),
  };
}

/** Move the camera just enough that `cursor` is at least `margin` inside the visible part. */
export function followCursor(
  camera: Camera,
  view: CameraView,
  desk: Size,
  cursor: DeskPoint,
  margin = CAMERA_FOLLOW_MARGIN_PX,
): Camera {
  const { top, bottom } = band(view);
  const pull = (offset: number, at: number, lo: number, hi: number) => {
    const m = Math.min(margin, (hi - lo) / 2);
    const on = offset + at * camera.scale;
    if (on < lo + m) return offset + (lo + m - on);
    if (on > hi - m) return offset - (on - (hi - m));
    return offset;
  };
  return clampCamera(
    {
      scale: camera.scale,
      x: pull(camera.x, cursor.x, 0, view.width),
      y: pull(camera.y, cursor.y, top, bottom),
    },
    view,
    desk,
  );
}

/** Zoom to `scale` while the desktop point under `at` (view px) stays under it. */
export function zoomAbout(camera: Camera, scale: number, at: DeskPoint, view: CameraView, desk: Size): Camera {
  const deskX = (at.x - camera.x) / camera.scale;
  const deskY = (at.y - camera.y) / camera.scale;
  const next = Math.min(maxScale(view, desk), Math.max(fitScale(view, desk), scale));
  return clampCamera({ scale: next, x: at.x - deskX * next, y: at.y - deskY * next }, view, desk);
}

/** Slide the desktop by a finger's travel. */
export function panCamera(camera: Camera, dx: number, dy: number, view: CameraView, desk: Size): Camera {
  return clampCamera({ ...camera, x: camera.x + dx, y: camera.y + dy }, view, desk);
}

/** The desktop point at the middle of the visible part. Where a cursor starts. */
export function viewCentre(camera: Camera, view: CameraView, desk: Size): DeskPoint {
  const { top, bottom } = band(view);
  return clampToDesk(
    { x: (view.width / 2 - camera.x) / camera.scale, y: ((top + bottom) / 2 - camera.y) / camera.scale },
    desk,
  );
}

/** Pull `cursor` back inside the visible part, so a pan never leaves it off screen. */
export function keepCursorInView(cursor: DeskPoint, camera: Camera, view: CameraView, desk: Size): DeskPoint {
  const { top, bottom } = band(view);
  const toDesk = (screen: number, offset: number) => (screen - offset) / camera.scale;
  return clampToDesk(
    {
      x: Math.min(toDesk(view.width - 1, camera.x), Math.max(toDesk(0, camera.x), cursor.x)),
      y: Math.min(toDesk(bottom - 1, camera.y), Math.max(toDesk(top, camera.y), cursor.y)),
    },
    desk,
  );
}

export function clampToDesk(point: DeskPoint, desk: Size): DeskPoint {
  return {
    x: Math.min(desk.width - 1, Math.max(0, point.x)),
    y: Math.min(desk.height - 1, Math.max(0, point.y)),
  };
}
