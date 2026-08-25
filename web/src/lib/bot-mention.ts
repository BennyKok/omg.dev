/**
 * `@` bot tagging for the composer.
 *
 * This is the input-field half of a mention: it detects an `@` trigger under
 * the caret, ranks the viewer's bots, and produces the text to insert. It is
 * deliberately pure so the composer in App.tsx stays a thin shell over it.
 *
 * What this does NOT do: route anything. A tagged bot is text in the message
 * body. Delivery today is by URL path (`POST /api/bots/:id/messages` ->
 * `deliverBotMessage`), and `docs/bot-mode-design.md` still lists mention
 * routing as unbuilt. Nothing here should be read as "the tagged bot was
 * notified".
 */

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
  limit = 8,
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
 * The inserted token keeps the bot's real name verbatim, including spaces, so
 * the message reads the way a human wrote it. There is no parser consuming
 * this yet; when mention routing is built it should carry the bot id rather
 * than try to recover a multi-word name from this text.
 */
export function formatBotMention(bot: MentionableBot): string {
  return `@${bot.name} `;
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
