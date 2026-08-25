/**
 * `@` bot tagging for the composer.
 *
 * This is the input-field half of a mention: it detects an `@` trigger under
 * the caret, ranks the viewer's bots, and produces the text to insert. It is
 * deliberately pure so the composer in App.tsx stays a thin shell over it.
 *
 * The inserted token carries the bot id, not just the name. The grammar has a
 * single owner in `src/bots/mention-token.ts`, which the server parses on send
 * to deliver the message to the tagged bot.
 */

import { formatBotMentionToken } from "../../../src/bots/mention-token.ts";

/** The minimum shape this module needs. `PersistentBot` satisfies it. */
export type MentionableBot = {
  id: string;
  name: string;
  enabled?: boolean;
};

export type BotMentionState = {
  /** Index of the `@` itself. */
  start: number;
  /** Caret index, i.e. end of the typed query. */
  end: number;
  /** Lowercased text typed after the `@`. */
  query: string;
};

/**
 * The trigger must follow start-of-text or whitespace so an email address
 * ("a@b.com") and a shell handle never open the picker. The query stops at
 * the first space, so only the first word after `@` is a live query even
 * though bot names may contain spaces.
 */
const MENTION_TRIGGER = /(^|\s)@([A-Za-z0-9._-]{0,80})$/;

export function botMentionAt(
  value: string,
  cursor: number | null | undefined,
): BotMentionState | null {
  if (cursor == null) return null;
  const before = value.slice(0, cursor);
  const match = before.match(MENTION_TRIGGER);
  if (!match) return null;
  return {
    start: cursor - match[2].length - 1,
    end: cursor,
    query: match[2].toLowerCase(),
  };
}

/**
 * Names are free text: not unique, not slugs, and they may contain spaces or
 * punctuation (`src/bots/store.ts`, and a bot may rename itself). Compare on a
 * folded form so "research bot", "Research-Bot" and "researchbot" all match
 * what the user typed.
 */
function fold(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * Disabled bots are excluded: `POST /api/bots/:id/messages` rejects them, so
 * offering one would tag a bot that cannot answer.
 */
export function matchBots(
  bots: readonly MentionableBot[],
  query: string,
  // Generous on purpose. This was 8, which silently hid bots from anyone with
  // a roster bigger than that: a bare `@` could never reach the tail of the
  // list. The popover scrolls, so the cap only needs to bound the DOM.
  limit = 50,
): MentionableBot[] {
  const q = fold(query);
  const usable = bots.filter((bot) => bot.enabled !== false && bot.name.trim().length > 0);
  const ranked = usable
    .map((bot) => {
      const name = fold(bot.name);
      if (!q) return { bot, rank: 0 };
      if (name.startsWith(q)) return { bot, rank: 0 };
      if (name.includes(q)) return { bot, rank: 1 };
      return null;
    })
    .filter((entry): entry is { bot: MentionableBot; rank: number } => entry !== null);

  // Stable: equal ranks keep roster order rather than reshuffling per keystroke.
  ranked.sort((a, b) => a.rank - b.rank);
  return ranked.slice(0, limit).map((entry) => entry.bot);
}

/**
 * The tag carries the bot id, so a rename or a duplicate display name can
 * never redirect a mention to the wrong bot. It renders as `@Name` for the
 * reader; `src/bots/mention-token.ts` owns the exact shape.
 */
export function formatBotMention(bot: MentionableBot): string {
  return `${formatBotMentionToken(bot.id, bot.name)} `;
}

/** Replace the active trigger with the tag. Returns the new value and caret. */
export function applyBotMention(
  value: string,
  active: BotMentionState,
  bot: MentionableBot,
): { value: string; cursor: number } {
  const replacement = formatBotMention(bot);
  return {
    value: value.slice(0, active.start) + replacement + value.slice(active.end),
    cursor: active.start + replacement.length,
  };
}
