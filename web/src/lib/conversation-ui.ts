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

/**
 * The botId a render should trust for bot chrome (header avatar/settings,
 * composer, message-send endpoint) — the single place that decides between
 * "trust the caller" and "derive it from this session's own data."
 *
 * `trustedBotId` is anything other than `undefined` (including explicit
 * `null`) when the caller already resolved and verified which bot this
 * render belongs to — the bot-stage column, reached via the canonical,
 * botId-verified picker (botCanonicalSessionId / botStageSession in
 * ../../../src/bots/session.ts and ./bot-session.ts). That resolution wins
 * outright over re-deriving identity from this session's own conversation
 * snapshot, which can lag behind rotation, or share a runtime attachment
 * with a nested, child, same-name, or already-open regular session —
 * exactly the cases `productBotId` cannot tell apart from this session's
 * data alone, because it only has this session's data to look at.
 *
 * Every other caller (a grid card, the generic mobile session-detail sheet
 * opened from the plain session list) never resolved a bot from navigation
 * and passes `undefined`, so it keeps deriving from `productBotId` exactly
 * as before — a regular session's chrome does not change.
 */
export function renderedBotId(
  session: ConversationSessionIdentity,
  trustedBotId: string | null | undefined,
): string | null {
  return trustedBotId !== undefined ? trustedBotId : productBotId(session);
}
