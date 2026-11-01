// The composer field's height while dictation is live.
//
// Dictation rewrites its interim words as it hears more, so the text gets
// shorter and then longer again. A field sized to its text moved the whole
// composer (anchored at the bottom of the screen) up and down while you spoke.
// While `hold` is set the field keeps the tallest height it has reached; when
// it clears, the field fits its text again, once.

/** The height to draw, and the height to remember for the next read. */
export function heldFieldHeight(fitted: number, held: number, hold: boolean): { height: number; held: number } {
  if (!hold) return { height: fitted, held: 0 };
  const height = Math.max(fitted, held);
  return { height, held: height };
}

/**
 * Cap a fitted field height at `maxLines` lines of text plus the field's
 * vertical padding. Past the cap the field scrolls instead of growing, so
 * long dictation does not push the transcript up (Benny, 2026-11-01).
 * `lineHeight` is the computed CSS value in px; when it cannot be read
 * (NaN, or `normal`), the height is returned unchanged.
 */
export function cappedFieldHeight(fitted: number, lineHeight: number, padding: number, maxLines?: number): number {
  if (!maxLines || !Number.isFinite(lineHeight) || lineHeight <= 0) return fitted;
  return Math.min(fitted, Math.ceil(lineHeight * maxLines + (Number.isFinite(padding) ? padding : 0)));
}
