/**
 * The one owner of the `@bot` mention token.
 *
 * The composer writes this token and the server parses it, so the grammar must
 * not exist in two places. This module has no imports on purpose: the web
 * bundle and the server both pull it in directly, the same way
 * `web/src/lib/bot-session.ts` reuses `src/bots/session.ts`.
 *
 * Shape: `[@Display Name](omg:bot_1234abcd)`
 *
 * Why the id rides in the text rather than beside it:
 *   - `POST /api/sessions/:id/send` transmits `{ text, mode }` and nothing
 *     else. A metadata side-channel never reaches the server.
 *   - Drafts persist through `prompt-stash` as plain text, so a side-channel
 *     would also be lost on reload.
 *   - Bot names are neither unique nor stable (a bot may rename itself), so
 *     resolving a display name at delivery time can address the wrong bot.
 *
 * Why the markdown-link shape: the server markdown-renders user rows in a
 * normal session, so this renders as a plain `@Name` link instead of leaking
 * the raw id at readers. The `omg:` scheme is inert in a browser.
 */

/** Bot ids are `bot_<hex>` — see `createBot` in `src/bots/store.ts`. */
const BOT_ID = "bot_[0-9a-f]{4,32}";

/** Global: callers that need per-match state must build their own instance. */
export function botMentionPattern(): RegExp {
  return new RegExp(`\\[@([^\\]\\n]{1,120})\\]\\(omg:(${BOT_ID})\\)`, "g");
}

export type ParsedBotMention = {
  botId: string;
  /** The name as it was written, for messages. Never trust it for identity. */
  label: string;
};

/**
 * A display name is free text and may contain the very characters that end a
 * markdown link. Fold those to spaces so the token cannot be broken open by a
 * bot named `Ops (staging)` or `a]b`.
 */
export function sanitizeMentionLabel(name: string): string {
  return name.replace(/[[\]()\r\n]/g, " ").replace(/\s+/g, " ").trim();
}

export function formatBotMentionToken(botId: string, name: string): string {
  const label = sanitizeMentionLabel(name) || botId;
  return `[@${label}](omg:${botId})`;
}

/**
 * Every mention in `text`, in first-appearance order, one entry per bot. A
 * repeated mention of the same bot must not deliver twice.
 */
export function parseBotMentions(text: string): ParsedBotMention[] {
  if (!text || !text.includes("](omg:bot_")) return [];
  const seen = new Set<string>();
  const out: ParsedBotMention[] = [];
  const pattern = botMentionPattern();
  for (const match of text.matchAll(pattern)) {
    const botId = match[2];
    if (seen.has(botId)) continue;
    seen.add(botId);
    out.push({ botId, label: match[1] });
  }
  return out;
}
