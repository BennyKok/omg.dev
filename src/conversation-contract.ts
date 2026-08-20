export type ConversationParticipantRole = "owner" | "member" | "observer";
export type ConversationHistoryAccess = "all" | "from_join";

export type ConversationParticipant = {
  id: string;
  kind: "human" | "bot";
  role: ConversationParticipantRole;
  display: {
    name?: string | null;
    avatar?: string | null;
    fallback: string;
  };
  joinedAt: number;
  leftAt?: number | null;
  historyAccess: ConversationHistoryAccess;
};

export type ConversationRuntimeAttachment = {
  sessionId: string;
  participantId?: string | null;
  kind: "primary" | "execution";
  attachedAt: number;
  detachedAt?: number | null;
};

export type Conversation = {
  id: string;
  title?: string | null;
  participants: ConversationParticipant[];
  runtimeSessions: ConversationRuntimeAttachment[];
  createdAt: number;
  updatedAt: number;
  legacy?: {
    source: "bot_session" | "regular_session";
    botId?: string | null;
    sessionId: string;
  };
};

export type MessageAuthorRef =
  | { kind: "human" | "bot"; participantId: string; verified: true }
  | { kind: "legacy"; participantId: "legacy:unknown"; verified: false };
