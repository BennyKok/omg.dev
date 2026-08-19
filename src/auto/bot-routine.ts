// Pure helpers for bot-owned automations — kept dependency-free (no store, no
// serve.ts, no scheduler) so each has its own unit test independent of the
// transport/scheduling wiring that uses them.

import { cronMatches } from "./scheduler.ts";
import type { AutoAgent } from "./store.ts";

/**
 * The message a fired routine delivers into the owning bot's own conversation.
 *
 * Visually distinct from a human message on purpose, mirroring the existing
 * "[Message from X to bot Y]" / "[Background task ...]" attribution convention
 * — so the bot doesn't mistake a scheduled check-in for someone talking to it.
 */
export function routineNudgeText(agent: AutoAgent): string {
  return `[Scheduled routine: ${agent.name}]\n\n${agent.prompt}`;
}

/**
 * Whether a cron schedule fires more often than `maxPerDay` over the next 24h.
 *
 * The per-bot cap alone doesn't stop one routine firing every minute — a
 * single too-frequent routine is worse than five reasonable ones. This is the
 * minimum-interval floor: reject a bot-owned schedule at save time when it
 * would cross the threshold. Default 48/day is ~every 30 minutes average.
 *
 * Only ever applied to bot-owned rows — user-owned auto agents keep today's
 * unrestricted cron.
 */
export function exceedsMaxFrequency(schedule: string, tz: string, maxPerDay = 48): boolean {
  let hits = 0;
  const start = Date.now();
  for (let m = 0; m < 24 * 60; m++) {
    if (cronMatches(schedule, new Date(start + m * 60_000), tz)) hits++;
    if (hits > maxPerDay) return true;
  }
  return false;
}
