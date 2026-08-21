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
  B extends { id: string; sessionId?: string },
  S extends BotSessionCandidate & { sessionId: string | null },
>(bots: B[], sessions: S[], conversations: BotConversationUnread[]): BotConversationRow<B, S>[] {
  return bots.map((bot) => {
    const own = conversations.filter((conversation) => conversation.botId === bot.id);
    // Prefer the shared resolver, then the server's row for this bot when it
    // named a conversation the client's session list does not carry.
    const canonical = botCanonicalSessionId(bot, sessions) ??
      (own.length === 1 ? own[0].sessionId : null);
    const conversation = canonical
      ? own.find((item) => item.sessionId === canonical)
      : undefined;
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
}

export const BOT_UNREAD_DOT_CLASS = "size-2 shrink-0 rounded-full bg-primary";

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
