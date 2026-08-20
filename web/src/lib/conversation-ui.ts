import type {
  Conversation,
  ConversationParticipant,
  MessageAuthorRef,
} from "../../../src/conversation-contract";

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

/** Look up a message's sender by the participant id MessageAuthorRef carries. */
export function conversationParticipantById(
  conversation: Conversation | null | undefined,
  participantId: string | null | undefined,
): ConversationParticipant | undefined {
  if (!conversation || !participantId) return undefined;
  return conversation.participants.find((participant) => participant.id === participantId);
}

/** The name to show for a participant, honoring the server's explicit fallback. */
export function conversationParticipantDisplayName(participant: ConversationParticipant): string {
  return participant.display.name?.trim() || participant.display.fallback || "Member";
}

/**
 * A stand-in for a verified author whose participant record is gone —
 * removed from the roster, or from a Computer this browser can no longer
 * enumerate. The id is real (it came from the server-verified MessageAuthorRef,
 * not a guess), but there is nothing to show for it beyond "somebody else": an
 * honest fallback, not an invented name or a dropped avatar.
 */
export function unknownConversationParticipant(participantId: string): ConversationParticipant {
  return {
    id: participantId,
    kind: "human",
    role: "member",
    display: { fallback: "Member" },
    joinedAt: 0,
    historyAccess: "all",
  };
}

/**
 * Whether a verified human message author is someone OTHER than the current
 * viewer — the signal that decides "draw their avatar beside this bubble" in
 * a shared bot conversation.
 *
 * Both ids must be known. A null viewerParticipantId ("who am I" could not be
 * resolved — see BootstrapPayload["viewer"]) must not make every message read
 * as someone else's; it degrades to "unknown", same as an unverified author.
 */
export function isOtherHumanMessageAuthor(
  author: MessageAuthorRef | null | undefined,
  viewerParticipantId: string | null | undefined,
): boolean {
  if (!author || author.kind !== "human" || !author.verified) return false;
  if (!viewerParticipantId) return false;
  return author.participantId !== viewerParticipantId;
}
