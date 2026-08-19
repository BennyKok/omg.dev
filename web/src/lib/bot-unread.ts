export type BotConversationUnread = {
  sessionId: string;
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
  unread: boolean;
  lastMessagePreview?: string;
  lastMessageTs?: number | null;
};

export function hasUnreadBotConversation(conversations: BotConversationUnread[]): boolean {
  return conversations.some((conversation) => conversation.unread);
}

export function botConversationRows<
  B extends { id: string; sessionId?: string },
  S extends { sessionId: string | null; botId?: string | null },
>(bots: B[], sessions: S[], conversations: BotConversationUnread[]): BotConversationRow<B, S>[] {
  const rows: BotConversationRow<B, S>[] = [];
  for (const bot of bots) {
    const ids = new Set<string>();
    for (const conversation of conversations) {
      if (conversation.botId === bot.id) ids.add(conversation.sessionId);
    }
    for (const session of sessions) {
      if (session.sessionId && session.botId === bot.id) ids.add(session.sessionId);
    }
    if (bot.sessionId) ids.add(bot.sessionId);
    if (!ids.size) {
      rows.push({ key: `bot:${bot.id}`, bot, session: undefined, sessionId: null, unread: false });
      continue;
    }
    for (const sessionId of ids) {
      const conversation = conversations.find((item) => item.sessionId === sessionId);
      rows.push({
        key: `conversation:${sessionId}`,
        bot,
        session: sessions.find((item) => item.sessionId === sessionId),
        sessionId,
        unread: !!conversation?.unread,
        lastMessagePreview: conversation?.lastMessagePreview,
        lastMessageTs: conversation?.lastMessageTs,
      });
    }
  }
  return rows;
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
