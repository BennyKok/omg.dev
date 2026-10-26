/**
 * The iPad hardware-keyboard shortcut bar.
 *
 * With a hardware keyboard attached, focusing a field on iPad does not raise
 * the on-screen keyboard. It raises a small floating bar (language key, field
 * arrows, dictation, predictions) about 66-71px tall at the bottom.
 *
 * The viewport sync used to fit the app shell to the visible height whenever
 * the keyboard was "not open", so the whole layout shrank when a field took
 * focus and grew back when it lost focus: a jump on every focus change. Now
 * the shell keeps its resting height, and only the session composer lifts
 * above the bar (and slides back down on blur).
 *
 * Safari reports the bar in one of two ways, and not always the same one:
 *
 * - It shrinks the visual viewport, so `innerHeight - visualViewport.height`
 *   is the bar's height.
 * - It shrinks the layout viewport itself (`innerHeight` drops by the bar's
 *   height, the visual viewport with it) and scrolls the page by the same
 *   amount. The first measure then reads 0, so the bar can only be seen
 *   against the height the window had with nothing focused.
 *
 * In the second form Safari scrolls the page even when the focused field is
 * already clear of the bar. The caller translates the shell back by that
 * scroll, so the header and transcript stay put.
 *
 * The bar is also handed back in pieces: it slides away after the blur, so the
 * covered height is still bar-sized for a few frames with nothing focused.
 * `active` carries the state through that tail.
 */

/** At or below this covered height it is not the on-screen keyboard. */
export const SHORTCUT_BAR_MAX_PX = 120;

export type ShortcutBarState = {
  /** The bar is up, or still sliding away. */
  active: boolean;
  /** The tallest bar seen since load, in layout px. 0 until one is seen. */
  reserve: number;
  /** `innerHeight` the last time nothing was focused and no bar was up. */
  restHeight: number;
};

export const INITIAL_SHORTCUT_BAR_STATE: ShortcutBarState = { active: false, reserve: 0, restHeight: 0 };

export type ShortcutBarSample = {
  /** `window.innerHeight`. */
  layoutHeight: number;
  /** `innerHeight` minus the (unscaled) visual viewport height. */
  visualCoverPx: number;
  /** A field that can raise a keyboard has focus. */
  focused: boolean;
  /** The Terminal tab fits itself to the visible band; leave it alone. */
  terminal: boolean;
};

export type ShortcutBarResult = ShortcutBarState & {
  /** How much of the resting window the bar covers right now. */
  coveredPx: number;
  /**
   * Lift the composer by `reserve`. True from the moment of focus once the
   * bar's height is known: the measurement comes in pieces while the bar
   * slides in, and Safari scrolls before it is complete.
   */
  lifted: boolean;
};

export function shortcutBarStep(prev: ShortcutBarState, sample: ShortcutBarSample): ShortcutBarResult {
  const { layoutHeight, visualCoverPx, focused, terminal } = sample;
  let restHeight = prev.restHeight;
  if (!focused && !prev.active) restHeight = layoutHeight;
  else if (layoutHeight > restHeight) restHeight = layoutHeight;
  const layoutShrink = Math.max(0, restHeight - layoutHeight);
  const coveredPx =
    Math.max(0, visualCoverPx) + (layoutShrink <= SHORTCUT_BAR_MAX_PX ? layoutShrink : 0);
  const barSized = coveredPx >= 1 && coveredPx <= SHORTCUT_BAR_MAX_PX;
  const active = !terminal && barSized && (focused || prev.active);
  const reserve = active && coveredPx > prev.reserve ? Math.ceil(coveredPx) : prev.reserve;
  const lifted =
    !terminal && reserve > 0 && (active || (focused && coveredPx <= SHORTCUT_BAR_MAX_PX));
  return { active, reserve, restHeight, coveredPx, lifted };
}

/**
 * The composer field a tap should focus, or null to leave the tap alone.
 *
 * Safari scrolls the page by the bar's height when a tap focuses a field and
 * the bar slides in, even when the field is already clear of it. Our shell
 * can only follow that scroll a frame or two late, which shows as a wobble.
 * Focusing the field ourselves with `preventScroll` stops the scroll at the
 * source, so the caller cancels the tap and focuses the field this returns.
 *
 * Only a tap on the composer itself counts: its buttons and links keep their
 * own taps, and a field that already has focus keeps native caret placement.
 */
export function composerFieldForTap(target: EventTarget | null): HTMLTextAreaElement | null {
  if (!(target instanceof Element)) return null;
  const composer = target.closest("[data-lfg-bar-lift]");
  if (!composer) return null;
  if (target.closest("button, a, input, select, label, [role='button']")) return null;
  const field = composer.querySelector("textarea");
  if (!field || field.disabled || field.readOnly) return null;
  if (field.ownerDocument.activeElement === field) return null;
  return field;
}
