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

/**
 * First/last row of a same-speaker run. Other-human name chrome uses the
 * first; the face uses the last. A one-row run is both. Speakers must already
 * be resolved (see chatRenderItemSpeaker) — this never guesses identity.
 */
export function speakerRunEdges(
  speakers: readonly string[],
  index: number,
): { firstOfRun: boolean; lastOfRun: boolean } {
  const speaker = speakers[index];
  return {
    firstOfRun: index === 0 || speakers[index - 1] !== speaker,
    lastOfRun: index === speakers.length - 1 || speakers[index + 1] !== speaker,
  };
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
