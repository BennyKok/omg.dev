import type { Conversation, ConversationParticipant, MessageAuthorRef } from "../../../src/conversation-contract";

export type AuthoredMessage = { role?: string; author?: MessageAuthorRef };
export type ChatIdentity = {
  viewerParticipantId: string | null;
  conversation: Conversation | null;
};

export function otherMessageSender(message: AuthoredMessage, identity: ChatIdentity): ConversationParticipant | null {
  const author = message.author;
  if (message.role !== "user" || author?.kind !== "human" || !author.verified ||
      !identity.viewerParticipantId || author.participantId === identity.viewerParticipantId) return null;
  return identity.conversation?.participants.find((person) => person.id === author.participantId) ?? {
    id: author.participantId, kind: "human", role: "member", display: { fallback: "Member" },
    joinedAt: 0, historyAccess: "all",
  };
}

export function messageSpeaker(message: AuthoredMessage): string {
  const author = message.author;
  return message.role === "user" && author?.kind === "human" && author.verified
    ? `user:${author.participantId}` : message.role ?? "system";
}
