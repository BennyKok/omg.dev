// Pure timer state. It stores the END time, not a counter, so a reload, a
// background tab or a sleeping phone cannot make it drift or reset.
export type TimerState =
  | { status: "idle"; durationMs: number }
  | { status: "running"; durationMs: number; endsAt: number }
  | { status: "paused"; durationMs: number; remainingMs: number };

export const idleTimer = (durationMs: number): TimerState => ({ status: "idle", durationMs });

export function startTimer(state: TimerState, now: number): TimerState {
  return { status: "running", durationMs: state.durationMs, endsAt: now + state.durationMs };
}

export function pauseTimer(state: TimerState, now: number): TimerState {
  if (state.status !== "running") return state;
  return { status: "paused", durationMs: state.durationMs, remainingMs: Math.max(0, state.endsAt - now) };
}

export function resumeTimer(state: TimerState, now: number): TimerState {
  if (state.status !== "paused") return state;
  return { status: "running", durationMs: state.durationMs, endsAt: now + state.remainingMs };
}

export function resetTimer(state: TimerState): TimerState {
  return idleTimer(state.durationMs);
}

export function remainingMs(state: TimerState, now: number): number {
  if (state.status === "idle") return state.durationMs;
  if (state.status === "paused") return state.remainingMs;
  return Math.max(0, state.endsAt - now);
}

export function isFinished(state: TimerState, now: number): boolean {
  return state.status === "running" && now >= state.endsAt;
}

/** "mm:ss" for a millisecond count, rounded up so 0:00 means finished. */
export function formatClock(ms: number): string {
  const total = Math.ceil(Math.max(0, ms) / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export type KeyValueStore = {
  getItem: (key: string) => Promise<string | null>;
  setItem: (key: string, value: string) => Promise<void>;
};

export async function loadTimer(store: KeyValueStore, key: string, fallbackMs: number): Promise<TimerState> {
  try {
    const raw = await store.getItem(key);
    const p = raw ? (JSON.parse(raw) as Partial<Record<string, unknown>>) : null;
    if (p && typeof p.durationMs === "number") {
      if (p.status === "running" && typeof p.endsAt === "number") return { status: "running", durationMs: p.durationMs, endsAt: p.endsAt };
      if (p.status === "paused" && typeof p.remainingMs === "number") return { status: "paused", durationMs: p.durationMs, remainingMs: p.remainingMs };
      if (p.status === "idle") return idleTimer(p.durationMs);
    }
  } catch {
    // Fall through to a fresh timer.
  }
  return idleTimer(fallbackMs);
}

export async function saveTimer(store: KeyValueStore, key: string, state: TimerState): Promise<void> {
  await store.setItem(key, JSON.stringify(state));
}
