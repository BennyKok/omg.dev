/**
 * A POLL THAT FINDS NOTHING NEW MUST NOT RENDER THE SCREEN.
 *
 * The session screen polls its held queue every 2 s and its open questions
 * every 5 s. Each answer was a new array, so React rendered the whole screen
 * on every poll, and the transcript's inline renderItem re-ran for every
 * mounted row, a few dozen on a long chat, for a list that had not changed.
 * Hand the previous array back when the answer has the same content, and
 * React skips the render. The rows are small JSON from the machine, so
 * comparing their serialised form is exact and cheap.
 */
export function keepIfSame<T>(prev: T[], next: T[]): T[] {
  if (prev === next) return prev;
  if (prev.length !== next.length) return next;
  return JSON.stringify(prev) === JSON.stringify(next) ? prev : next;
}
