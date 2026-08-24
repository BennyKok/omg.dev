import { botCanonicalSessionId, type BotSessionCandidate } from "./bot-session";

export type BotConversationUnread = {
  sessionId: string;
  conversationId?: string;
  botId: string;
  assignedUser?: string | null;
  unread: boolean;
  lastMessagePreview?: string;
  lastMessageTs?: number | null;
};

export type BotConversationRow<B, S> = {
  key: string;
  bot: B;
  session: S | undefined;
  sessionId: string | null;
  conversationId: string | null;
  unread: boolean;
  lastMessagePreview?: string;
  lastMessageTs?: number | null;
};

export type BotRosterActivityState = "working" | "idle" | "disabled";

/**
 * The bot roster's shared activity vocabulary.
 *
 * Keep this separate from conversation read state. A bot can finish work and
 * leave an unread reply, so combining the two facts into one badge would make
 * one state overwrite the other.
 */
export function botRosterActivityState(
  enabled: boolean,
  working: boolean,
): BotRosterActivityState {
  if (!enabled) return "disabled";
  return working ? "working" : "idle";
}

/** A complete row label. Read state must not be communicated by colour alone. */
export function botRosterRowAriaLabel(input: {
  name: string;
  enabled: boolean;
  working: boolean;
  unread: boolean;
}): string {
  const activity = botRosterActivityState(input.enabled, input.working);
  return `${input.name}, ${activity}, ${input.unread ? "unread" : "read"} conversation`;
}

export function hasUnreadBotConversation(conversations: BotConversationUnread[]): boolean {
  return conversations.some((conversation) => conversation.unread);
}

/**
 * One roster row per persistent bot.
 *
 * The row is backed by that bot's canonical conversation, resolved with the
 * same rules the server binds by (`botCanonicalSessionId`). This used to fan
 * out instead: every session carrying the bot's `botId` became its own row.
 * Delegated children inherit `botId`, so a bot that had spawned background
 * work appeared two or three times, each copy captioned with a subagent's
 * last line. The server now sends one conversation per bot, and this stays
 * canonical-aware so a roster rendered against an older payload still
 * collapses to one row instead of showing the duplicates again.
 */
export function botConversationRows<
  B extends { id: string; sessionId?: string; lastMessageAt?: number | null },
  S extends BotSessionCandidate & { sessionId: string | null },
>(bots: B[], sessions: S[], conversations: BotConversationUnread[]): BotConversationRow<B, S>[] {
  const inputOrder = new Map(bots.map((bot, index) => [bot.id, index]));
  const rows = bots.map((bot) => {
    const own = conversations.filter((conversation) => conversation.botId === bot.id);
    // Both sides run the same resolver, but not over the same input: the server
    // resolves against every session it knows, the client only against the
    // fleet list this view is holding. When that list is missing the bot's
    // conversation the two answers diverge, and the row then matched no server
    // conversation at all — so it rendered read, with no preview and no
    // timestamp, for a bot that had unread messages waiting. Unread is the
    // server's to report (it owns the read watermark), and the server sends
    // exactly one conversation per bot, so an unmatched resolution falls back
    // to that row rather than dropping it.
    const resolved = botCanonicalSessionId(bot, sessions);
    const conversation =
      (resolved ? own.find((item) => item.sessionId === resolved) : undefined) ??
      (own.length === 1 ? own[0] : undefined);
    // Taken from the conversation that was actually used, so the id the row
    // opens and the id its unread state came from can never be two sessions.
    const canonical = conversation?.sessionId ?? resolved;
    // Keyed by bot, not by session: the row survives a rebind of the bot's
    // conversation without React tearing it down and losing scroll position.
    return {
      key: `bot:${bot.id}`,
      bot,
      session: sessions.find((item) => item.sessionId === canonical),
      sessionId: canonical,
      conversationId: conversation?.conversationId ?? canonical,
      unread: !!conversation?.unread,
      lastMessagePreview: conversation?.lastMessagePreview,
      lastMessageTs: conversation?.lastMessageTs,
    };
  });
  // Both the desktop rail and mobile page use this result, so recency has one
  // owner. The canonical conversation timestamp wins over the bot record's
  // fallback. Equal or missing timestamps keep the saved bot order stable.
  return rows.sort((a, b) => {
    const aTs = a.lastMessageTs ?? a.bot.lastMessageAt ?? 0;
    const bTs = b.lastMessageTs ?? b.bot.lastMessageAt ?? 0;
    return bTs - aTs || (inputOrder.get(a.bot.id) ?? 0) - (inputOrder.get(b.bot.id) ?? 0);
  });
}

export const BOT_UNREAD_DOT_CLASS =
  "inline-block size-2 shrink-0 rounded-full bg-primary";

export function botUnreadActionForTranscript(input: {
  role?: string;
  text?: string;
  conversationId: string;
  selectedConversationId: string | null;
  botsVisible: boolean;
}): "ignore" | "mark-read" | "refresh" {
  const peerArrival = input.role === "user" && input.text?.startsWith("[Peer message from ");
  if (input.role !== "assistant" && !peerArrival) return "ignore";
  return input.botsVisible && input.selectedConversationId === input.conversationId
    ? "mark-read"
    : "refresh";
}

/**
 * The transcript channels the roster watches, one per canonical conversation,
 * in a stable order.
 *
 * The order matters as much as the contents. The subscribing effect keys on
 * this list, so returning it in payload order would make an unrelated roster
 * refresh look like a changed subscription set and churn every channel.
 */
export function botConversationSubscriptionIds(
  conversations: BotConversationUnread[],
): string[] {
  return [...new Set(conversations.map((conversation) => conversation.sessionId))].sort();
}

/**
 * Clear one conversation's unread flag without waiting for the server.
 *
 * Returns the same array when there was nothing to clear, so an open of an
 * already-read conversation does not produce a new roster identity and re-run
 * the effects that key on it.
 */
export function clearBotConversationUnread(
  conversations: BotConversationUnread[],
  sessionId: string,
): BotConversationUnread[] {
  return conversations.some(
    (conversation) => conversation.sessionId === sessionId && conversation.unread,
  )
    ? conversations.map((conversation) =>
        conversation.sessionId === sessionId ? { ...conversation, unread: false } : conversation,
      )
    : conversations;
}
