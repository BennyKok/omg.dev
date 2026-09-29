/**
 * The Computer "kiosk": one page of the Computer browser, shown on its own.
 *
 * Some pages must be filled in by the person, never by omg (Expo's sign-up,
 * for example: its terms forbid automated registration). The kiosk opens such
 * a page in a phone-width app window on the Computer desktop, with no tabs and
 * no address bar. The client shows only that window's page area, cut out of
 * the normal Computer screen stream, so it reads as a sheet inside omg while
 * it stays the real site in the real browser.
 *
 * The server owns the window. `GET /api/computer/kiosk` reports where its page
 * is on the desktop, and the client crops the stream to that rectangle.
 */

export const COMPUTER_KIOSK_PATH = "/api/computer/kiosk";

/** A rectangle in desktop pixels. */
export interface KioskRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface KioskFrame {
  /** False when no kiosk window is open, or it is still loading. */
  open: boolean;
  /** The page area of the top kiosk window (a sign-in popup, when one is open). */
  rect?: KioskRect;
  /** The desktop size, the size of the streamed frame buffer. */
  screen?: { width: number; height: number };
  /** The page address, so the sheet can name the site. */
  url?: string;
  /**
   * Text fields on the page, in pixels relative to `rect`. A tap on one of
   * them raises the phone keyboard; a tap elsewhere does not.
   */
  inputs?: KioskRect[];
  /** True when the focused element on the page takes text. */
  editing?: boolean;
}

/** The host to show under the sheet title, for example "expo.dev". */
export function kioskHost(frame: KioskFrame | null | undefined, fallback = "expo.dev"): string {
  try {
    return frame?.url ? new URL(frame.url).hostname.replace(/^www\./, "") || fallback : fallback;
  } catch {
    return fallback;
  }
}

/**
 * How to cut the kiosk page out of the full desktop stream: scale the whole
 * frame buffer by `scale`, then move it by (`left`, `top`) inside a view of
 * `viewWidth` by `viewHeight`, with overflow hidden. The page fills the view
 * width; any height left over stays empty below the page.
 */
export function kioskLayout(frame: KioskFrame, viewWidth: number): {
  scale: number; left: number; top: number; width: number; height: number; pageHeight: number;
} | null {
  if (!frame.open || !frame.rect || !frame.screen || frame.rect.width <= 0 || viewWidth <= 0) return null;
  const scale = viewWidth / frame.rect.width;
  return {
    scale,
    left: -frame.rect.x * scale,
    top: -frame.rect.y * scale,
    width: frame.screen.width * scale,
    height: frame.screen.height * scale,
    pageHeight: frame.rect.height * scale,
  };
}

/** True when a point (view pixels, relative to the page) is on a text field. */
export function kioskHitsInput(frame: KioskFrame, scale: number, x: number, y: number): boolean {
  if (frame.editing) return true;
  const px = x / scale;
  const py = y / scale;
  return (frame.inputs ?? []).some((r) => px >= r.x && px <= r.x + r.width && py >= r.y && py <= r.y + r.height);
}

/** The X11 keysym for one typed character. Latin-1 is its own keysym. */
export function keysymFor(character: string): number {
  if (character === "\n" || character === "\r") return 0xff0d;
  const point = character.codePointAt(0) ?? 0;
  return point < 0x100 ? point : 0x01000000 + point;
}

/** Keys that produce no character, by `KeyboardEvent.key`. */
export const NAMED_KEYSYMS: Record<string, number> = {
  Enter: 0xff0d,
  Backspace: 0xff08,
  Tab: 0xff09,
  Escape: 0xff1b,
  ArrowLeft: 0xff51,
  ArrowUp: 0xff52,
  ArrowRight: 0xff53,
  ArrowDown: 0xff54,
};
