/**
 * The one line a run of work shows: "Working for 4s" while the agent is still
 * in it, "Worked for 12s" once it is done. Mirrors toolGroupWorkLabel in the
 * root src/transcript-rows.ts so both clients say the same thing about the
 * same run. Pure, so the two copies can be checked against each other.
 */

/** "4s", "1m 20s", "2m". Never zero for work that did happen. */
export function formatWorkDuration(ms: number): string {
  const seconds = Math.max(1, Math.round(ms / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return rest ? `${minutes}m ${rest}s` : `${minutes}m`;
}

export function workLabel(
  entries: ReadonlyArray<{ ts?: number | null }>,
  options: { live: boolean; now?: number; endTs?: number | null },
): string {
  let start: number | null = null;
  let last: number | null = null;
  for (const entry of entries) {
    if (typeof entry.ts !== "number") continue;
    if (start === null || entry.ts < start) start = entry.ts;
    if (last === null || entry.ts > last) last = entry.ts;
  }
  if (options.live) {
    const now = options.now ?? Date.now();
    return start === null ? "Working…" : `Working for ${formatWorkDuration(now - start)}`;
  }
  const end = options.endTs ?? last;
  if (start === null || end === null || end <= start) return "Worked";
  return `Worked for ${formatWorkDuration(end - start)}`;
}
