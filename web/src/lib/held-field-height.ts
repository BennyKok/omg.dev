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
