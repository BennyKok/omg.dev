// Challenge a friend: a link that carries a seed, a score and a name,
// `?c=<seed>&s=<score>&n=<name>`. Opening it plays the same level and then
// shows "You won" or "You lost" against that score. Every parameter is
// checked and cleaned here, because anyone can edit a link.
//
// No React and no DOM in this file.

export type Challenge = { seed: number; score: number; name: string };

export const MAX_SEED = 2_147_483_647;
export const MAX_SCORE = 9_999_999;
export const MAX_NAME = 16;
export const DEFAULT_NAME = "A friend";

/** A whole number from digits only, inside 0..max. Anything else gives null. */
function whole(raw: string | null, max: number): number | null {
  if (raw === null || !/^\d{1,10}$/.test(raw.trim())) return null;
  const n = Number(raw.trim());
  return Number.isSafeInteger(n) && n <= max ? n : null;
}

/** Letters, digits, spaces and . - _ ' only, at most 16 characters, no leading or double spaces. */
export function cleanName(raw: string | null | undefined): string {
  if (!raw) return "";
  return raw
    .normalize("NFKC")
    .replace(/[^\p{L}\p{N} ._'-]/gu, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_NAME)
    .trim();
}

/** The challenge in a query string ("?c=1&s=2&n=Ana"), or null when the link is not a valid challenge. */
export function parseChallenge(search: string): Challenge | null {
  const p = new URLSearchParams(search);
  if (!p.has("c")) return null;
  const seed = whole(p.get("c"), MAX_SEED);
  const score = whole(p.get("s"), MAX_SCORE);
  if (seed === null || seed < 1 || score === null) return null;
  return { seed, score, name: cleanName(p.get("n")) || DEFAULT_NAME };
}

/** A challenge link on `base` (the page address without a query). */
export function challengeUrl(base: string, c: Challenge): string {
  const url = new URL(base);
  for (const k of ["c", "s", "n"]) url.searchParams.delete(k);
  url.hash = "";
  url.searchParams.set("c", String(Math.min(MAX_SEED, Math.max(1, Math.floor(c.seed)))));
  url.searchParams.set("s", String(Math.min(MAX_SCORE, Math.max(0, Math.floor(c.score)))));
  const name = cleanName(c.name);
  if (name) url.searchParams.set("n", name);
  return url.toString();
}

/** "won", "lost" or "tie" for my score against the challenge. */
export function challengeOutcome(mine: number, theirs: number): "won" | "lost" | "tie" {
  return mine > theirs ? "won" : mine < theirs ? "lost" : "tie";
}

/** A random seed for a free round, so each round differs and a challenge can replay it. */
export function randomSeed(random: () => number = Math.random): number {
  return 1 + Math.floor(random() * (MAX_SEED - 1));
}

/** "❤️❤️🤍" style bars for a share line. */
export function emojiBar(value: number, max: number, full: string, empty: string): string {
  const n = Math.max(0, Math.min(max, Math.round(value)));
  return full.repeat(n) + empty.repeat(max - n);
}
