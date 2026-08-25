/**
 * Fan a tagged message out to the bots it mentions.
 *
 * `src/bots/mention-token.ts` owns the token grammar; this module owns the
 * decision of which mentions are deliverable and what happens to them. It does
 * not own delivery itself — `deliverBotMessage` in `src/commands/serve.ts`
 * stays the single owner of "how a message reaches a bot", and is injected
 * here so this module is testable without a live server.
 */

import type { Bot } from "./store.ts";
import { parseBotMentions, type ParsedBotMention } from "./mention-token.ts";

/** Why a parsed mention did not turn into a delivery. */
export type MentionSkipReason =
  | "unknown"
  | "disabled"
  | "rotating"
  | "self"
  | "delivery-failed";

export type MentionOutcome = {
  botId: string;
  label: string;
  delivered: boolean;
  reason?: MentionSkipReason;
  error?: string;
};

/**
 * A bot mid-rotation cannot take a turn. The message routes are already strict
 * about this, so a mention must be too rather than racing a rotation.
 */
function rotationBlocked(bot: Bot): boolean {
  return (
    bot.rotationState === "queued" ||
    bot.rotationState === "rotating" ||
    (bot.rotationState === "failed" && bot.rotationReason === "config")
  );
}

export type MentionTarget = { mention: ParsedBotMention; bot: Bot };

/**
 * Split parsed mentions into what can be delivered and what cannot.
 *
 * `selfBotId` drops a bot tagging itself, which would otherwise queue a turn
 * onto its own session and let it talk to itself in a loop.
 *
 * One `bots` snapshot is passed in rather than calling `getBot` per mention:
 * `getBot` re-reads the whole bots file every call.
 */
export function resolveBotMentions(
  text: string,
  bots: readonly Bot[],
  opts: { selfBotId?: string } = {},
): { targets: MentionTarget[]; skipped: MentionOutcome[] } {
  const mentions = parseBotMentions(text);
  if (!mentions.length) return { targets: [], skipped: [] };

  const byId = new Map(bots.map((bot) => [bot.id, bot]));
  const targets: MentionTarget[] = [];
  const skipped: MentionOutcome[] = [];

  for (const mention of mentions) {
    const bot = byId.get(mention.botId);
    const base = { botId: mention.botId, label: mention.label, delivered: false };
    if (!bot) {
      skipped.push({ ...base, reason: "unknown" });
      continue;
    }
    if (opts.selfBotId && bot.id === opts.selfBotId) {
      skipped.push({ ...base, reason: "self" });
      continue;
    }
    if (!bot.enabled) {
      skipped.push({ ...base, reason: "disabled" });
      continue;
    }
    if (rotationBlocked(bot)) {
      skipped.push({ ...base, reason: "rotating" });
      continue;
    }
    targets.push({ mention, bot });
  }
  return { targets, skipped };
}

export type MentionDispatchDeps = {
  /** Add the bot to the source conversation. Purely a record write. */
  addParticipant: (conversationId: string, bot: Bot) => void | Promise<void>;
  /** Build the delivered text for one bot. */
  attribute: (bot: Bot) => string;
  /**
   * Hand off to the single delivery owner. The caller is responsible for
   * wrapping this in the per-bot critical section, because delivery and
   * rotation must not interleave on the same `bot.sessionId`.
   */
  deliver: (bot: Bot, text: string) => Promise<{ error?: string } | void>;
  onError?: (bot: Bot, error: unknown) => void;
};

/**
 * Deliver to every resolved target. Bots run concurrently because each one
 * may cold start, which takes seconds; serializing N of them would stall the
 * caller for N times that. Concurrency is safe only because the caller
 * serializes per bot, and each bot appears at most once (`parseBotMentions`
 * dedupes).
 */
export async function dispatchBotMentions(
  targets: readonly MentionTarget[],
  conversationId: string | undefined,
  deps: MentionDispatchDeps,
): Promise<MentionOutcome[]> {
  return Promise.all(
    targets.map(async ({ bot, mention }): Promise<MentionOutcome> => {
      const base = { botId: bot.id, label: mention.label };
      try {
        // Participation is recorded before delivery so the bot can read the
        // conversation it is about to be asked about.
        if (conversationId) await deps.addParticipant(conversationId, bot);
        const result = await deps.deliver(bot, deps.attribute(bot));
        if (result && "error" in result && result.error) {
          return { ...base, delivered: false, reason: "delivery-failed", error: result.error };
        }
        return { ...base, delivered: true };
      } catch (err) {
        deps.onError?.(bot, err);
        return {
          ...base,
          delivered: false,
          reason: "delivery-failed",
          error: err instanceof Error ? err.message : String(err),
        };
      }
    }),
  );
}
