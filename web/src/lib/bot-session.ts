type BotSessionRef = {
  id: string;
  sessionId?: string | null;
};

type SessionRef = {
  sessionId?: string | null;
  nativeSessionId?: string | null;
  botId?: string | null;
  parentSessionId?: string | null;
  parentNativeSessionId?: string | null;
  subagentDepth?: number | null;
};

/**
 * Resolve only the persistent bot's main conversation.
 *
 * Child sessions inherit botId for attribution. A broad botId match can
 * therefore open a delegated task instead of the bot's saved conversation.
 */
export function findBotMainSession<T extends SessionRef>(bot: BotSessionRef, sessions: T[]): T | undefined {
  const savedSessionId = bot.sessionId?.trim();
  if (savedSessionId) {
    const exact = sessions.find((session) => session.sessionId === savedSessionId || session.nativeSessionId === savedSessionId);
    if (exact) return exact;
  }

  return sessions.find((session) => session.botId === bot.id && !session.parentSessionId && !session.parentNativeSessionId && !session.subagentDepth);
}
