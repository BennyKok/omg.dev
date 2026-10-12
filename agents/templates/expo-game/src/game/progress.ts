// Saved progress and settings, as plain data plus pure functions. The storage
// part (AsyncStorage) is in profile-store.ts. Keep this file free of React so
// it can be tested with `bun test`.

export type Settings = { sound: boolean; touchControls: boolean; players: 1 | 2 };

export type Unlock = {
  id: string;
  label: string;
  description: string;
  /** Best score needed on `gameId` (or any game when omitted). */
  scoreAtLeast: number;
  gameId?: string;
};

export type RunResult = {
  gameId: string;
  score: number;
  /** Free text lines for the results screen, such as "Time 0:42". */
  stats?: { label: string; value: string }[];
  won?: boolean;
};

export type Profile = {
  version: 1;
  settings: Settings;
  bestScores: Record<string, number>;
  unlocked: string[];
  plays: number;
  lastRun: (RunResult & { newBest: boolean; newlyUnlocked: string[] }) | null;
  /** Place for one game's own saved data, such as a selected skin. */
  selected: Record<string, string>;
};

export const DEFAULT_SETTINGS: Settings = { sound: true, touchControls: true, players: 1 };

export const emptyProfile = (): Profile => ({
  version: 1,
  settings: { ...DEFAULT_SETTINGS },
  bestScores: {},
  unlocked: [],
  plays: 0,
  lastRun: null,
  selected: {},
});

/** Read saved JSON of any shape and return a valid Profile. Unknown or broken data gives defaults. */
export function migrateProfile(raw: unknown): Profile {
  const base = emptyProfile();
  if (!raw || typeof raw !== "object") return base;
  const r = raw as Partial<Profile>;
  const settings: Partial<Settings> = r.settings && typeof r.settings === "object" ? r.settings : {};
  const scores: Record<string, number> = {};
  if (r.bestScores && typeof r.bestScores === "object") {
    for (const [k, v] of Object.entries(r.bestScores)) if (typeof v === "number" && Number.isFinite(v)) scores[k] = v;
  }
  return {
    ...base,
    settings: {
      sound: typeof settings.sound === "boolean" ? settings.sound : base.settings.sound,
      touchControls: typeof settings.touchControls === "boolean" ? settings.touchControls : base.settings.touchControls,
      players: settings.players === 2 ? 2 : 1,
    },
    bestScores: scores,
    unlocked: Array.isArray(r.unlocked) ? r.unlocked.filter((x): x is string => typeof x === "string") : [],
    plays: typeof r.plays === "number" && Number.isFinite(r.plays) ? r.plays : 0,
    lastRun: r.lastRun && typeof r.lastRun === "object" ? (r.lastRun as Profile["lastRun"]) : null,
    selected: r.selected && typeof r.selected === "object" ? { ...r.selected } : {},
  };
}

/** Add a finished run. Returns a new profile; it records the best score and any new unlocks. */
export function recordRun(profile: Profile, run: RunResult, unlocks: readonly Unlock[]): Profile {
  const prev = profile.bestScores[run.gameId];
  const newBest = prev === undefined || run.score > prev;
  const bestScores = { ...profile.bestScores, [run.gameId]: newBest ? run.score : prev };
  const unlocked = [...profile.unlocked];
  const newlyUnlocked: string[] = [];
  for (const u of unlocks) {
    if (unlocked.includes(u.id)) continue;
    const best = u.gameId ? bestScores[u.gameId] ?? 0 : Math.max(0, ...Object.values(bestScores));
    if (best >= u.scoreAtLeast) {
      unlocked.push(u.id);
      newlyUnlocked.push(u.id);
    }
  }
  return { ...profile, bestScores, unlocked, plays: profile.plays + 1, lastRun: { ...run, newBest, newlyUnlocked } };
}

export const isUnlocked = (profile: Profile, id: string, unlocks: readonly Unlock[]): boolean => {
  const u = unlocks.find((x) => x.id === id);
  return !u || u.scoreAtLeast <= 0 || profile.unlocked.includes(id);
};

/** 83.4 seconds -> "1:23.4" */
export function formatTime(seconds: number): string {
  const s = Math.max(0, seconds);
  const m = Math.floor(s / 60);
  return `${m}:${(s - m * 60).toFixed(1).padStart(4, "0")}`;
}
