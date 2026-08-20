import type { Conversation, ConversationParticipant } from "../../../src/conversation-contract";

export type ConversationSessionIdentity = {
  sessionId?: string | null;
  conversation?: Conversation | null;
  botId?: string | null;
};

export function activeConversationParticipants(
  session: Pick<ConversationSessionIdentity, "conversation">,
): ConversationParticipant[] {
  return session.conversation?.participants.filter((participant) => !participant.leftAt) ?? [];
}

/** Product routing prefers the durable roster and never a child runtime tag. */
export function productBotId(session: ConversationSessionIdentity): string | null {
  const conversation = session.conversation;
  if (conversation) {
    const attachment = conversation.runtimeSessions.find(
      (row) => row.sessionId === session.sessionId && row.kind === "primary",
    );
    const attached = attachment?.participantId?.startsWith("bot:")
      ? attachment.participantId.slice(4)
      : null;
    if (
      attached &&
      conversation.participants.some(
        (participant) => participant.id === attachment?.participantId && participant.kind === "bot" && !participant.leftAt,
      )
    ) return attached;
    const first = conversation.participants.find(
      (participant) => participant.kind === "bot" && !participant.leftAt,
    );
    if (first?.id.startsWith("bot:")) return first.id.slice(4);
    // A typed conversation with no active bot is a regular conversation. Do
    // not let a stale inherited Session.botId override its product identity.
    return null;
  }
  return session.botId ?? null;
}

export function isBotConversation(session: ConversationSessionIdentity): boolean {
  return !!productBotId(session);
}
