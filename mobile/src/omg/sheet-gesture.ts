import type { SheetTouchOrigin } from "./sheet-scroll";
export type SheetStage = "compact" | "expanded";

export function canDragSheet(dx: number, dy: number, origin: SheetTouchOrigin | null, expanded: boolean): boolean {
  // The native recognizer owns the activation distance. Its first event
  // can report slightly less travel than that threshold on iOS.
  if (dy === 0 || Math.abs(dy) <= Math.abs(dx) * 1.3) return false;
  if (origin?.blocked || (origin?.offset ?? 0) > 1) return false;
  // At full height, upward drags belong to scrolling. The handle has no
  // scroll origin, so it can still be dragged in either direction.
  return !origin || dy > 0 || !expanded;
}

export function sheetDragPosition(start: number, dy: number, compact: number, expanded: number) {
  const desired = start - dy;
  return { height: Math.max(compact, Math.min(expanded, desired)), pull: Math.max(0, compact - desired) };
}

export function sheetDragDestination(start: number, dy: number, vy: number, compact: number, expanded: number): SheetStage | "dismiss" {
  const desired = start - dy;
  if (compact - desired > Math.min(96, compact * 0.3) || (start <= compact + 1 && dy > 20 && vy > 0.65)) return "dismiss";
  if (dy < -36 || (dy < -12 && vy < -0.4)) return "expanded";
  if (dy > 36 || (dy > 12 && vy > 0.4)) return "compact";
  return desired > (compact + expanded) / 2 ? "expanded" : "compact";
}
