// Daily challenge: one seed per calendar day, the same for every player on
// that date, numbered from the launch day, with a streak. Pure functions; the
// saved state lives in the profile (progress.ts).
//
// The day is the player's local date, as in Wordle: a new challenge starts at
// the player's midnight.
//
// No React and no DOM in this file.

export type DailyState = {
  /** "2026-10-22" of the last finished daily, or "". */
  lastDay: string;
  /** Days in a row with a finished daily. */
  streak: number;
  /** Best daily score per day key. Only recent days are kept. */
  best: Record<string, number>;
};

export const emptyDaily = (): DailyState => ({ lastDay: "", streak: 0, best: {} });

const pad = (n: number) => String(n).padStart(2, "0");

/** The local calendar day of a date, as "YYYY-MM-DD". */
export function dayKey(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function parseDay(key: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key);
  if (!m) return null;
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) / 86_400_000;
}

/** The seed of a day: 20261022 for "2026-10-22". Feed it to createGame. */
export function dailySeed(key: string): number {
  return Number(key.replace(/-/g, "")) || 1;
}

/** The challenge number: 1 on the launch day, 2 the next day. Never below 1. */
export function dailyNumber(key: string, launchDay: string): number {
  const a = parseDay(launchDay);
  const b = parseDay(key);
  if (a === null || b === null) return 1;
  return Math.max(1, b - a + 1);
}

/** The streak as it stands today: it is lost when yesterday was missed. */
export function currentStreak(state: DailyState, today: string): number {
  const t = parseDay(today);
  const l = parseDay(state.lastDay);
  if (t === null || l === null) return 0;
  return t - l <= 1 ? state.streak : 0;
}

/** Record a finished daily. A replay on the same day keeps the streak and the best score. */
export function recordDaily(state: DailyState, today: string, score: number): DailyState {
  const t = parseDay(today);
  const l = parseDay(state.lastDay);
  let streak = 1;
  if (t !== null && l !== null) {
    if (t === l) streak = Math.max(1, state.streak);
    else if (t - l === 1) streak = state.streak + 1;
  }
  const best: Record<string, number> = {};
  // Keep two weeks of daily bests so the saved profile stays small.
  for (const [k, v] of Object.entries(state.best)) {
    const d = parseDay(k);
    if (d !== null && t !== null && t - d < 14) best[k] = v;
  }
  best[today] = Math.max(score, best[today] ?? -Infinity);
  return { lastDay: today, streak, best };
}
