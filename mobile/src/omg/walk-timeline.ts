/**
 * When the Home Screen village changes pose.
 *
 * No imports, deliberately: village-widget-data.ts reaches expo-asset,
 * expo-file-system and expo-widgets, and importing any of those pulls in React
 * Native, which the check harness cannot parse. The rule below is the part
 * with real behaviour in it, so it lives where a test can reach it.
 */
/**
 * The four walk poses, one per timeline entry. WidgetKit does not run a render
 * loop, so this is the only motion a Home Screen widget can express, and the
 * system decides when it actually redraws.
 */
export const WALK_PHASES = 4;

/**
 * How many entries one write covers.
 *
 * This used to be WALK_PHASES, so a write bought exactly four redraws and the
 * village then froze until the app next came forward. Cycling the four poses
 * over more entries buys the same wall-clock window at a shorter step, which
 * is what makes a change visible between two glances. Every entry carries a
 * full copy of the props, so this is also what the timeline costs in the App
 * Group defaults — do not raise it without measuring that.
 */
export const WALK_ENTRIES = 8;

/**
 * One timeline entry per pose, `stepMs` apart, cycling the poses.
 *
 * ── THE PHASE COMES FROM THE CLOCK, NOT FROM THE ENTRY INDEX ──────────────
 *
 * It used to be `index % WALK_PHASES`, which meant every write started the
 * cycle again at pose 0. That is fine if a write is rare. It is not: the
 * bridge rewrites the timeline on every status change, and again every 30
 * seconds while the app is in the foreground (see widgetRefresh). Each rewrite
 * put a fresh pose-0 entry at `now`, so the pose being displayed was pinned at
 * 0 for as long as anybody was using the app, and the agents stood still on
 * the exact spot they start from. Benny: "I still dont see it strolling left
 * and right."
 *
 * Deriving the pose from the entry's own wall-clock time makes a rewrite
 * IDEMPOTENT with respect to the walk: the same instant always gets the same
 * pose, whoever wrote it and however many times. The village keeps pacing
 * across rewrites instead of restarting, and two glances a step apart differ.
 */
export function walkPhaseAt(time: number, stepMs: number): number {
  return Math.floor(time / stepMs) % WALK_PHASES;
}

export function walkTimeline<T extends { walkPhase: number }>(
  props: Omit<T, "walkPhase">,
  stepMs: number,
  from: Date = new Date(),
  count: number = WALK_ENTRIES,
): { date: Date; props: T }[] {
  const entries: { date: Date; props: T }[] = [];
  for (let index = 0; index < count; index += 1) {
    const date = new Date(from.getTime() + index * stepMs);
    entries.push({
      date,
      props: { ...props, walkPhase: walkPhaseAt(date.getTime(), stepMs) } as T,
    });
  }
  return entries;
}