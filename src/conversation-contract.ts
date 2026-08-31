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

/**
 * Who wrote a stored turn.
 *
 * `verified` means SERVER-RESOLVED, not cryptographically vouched, and the
 * name is a historical overclaim worth reading carefully before relying on it.
 * It is true whenever the box was able to name the sender at all. How much
 * that is worth depends entirely on how the box is reached:
 *
 *   - Through a hosted Computer, the address came from control-plane's
 *     HMAC-signed grant, checked against the share row, forwarded on a fixed
 *     header whitelist. A browser cannot put it there.
 *   - Directly on a self-hosted box, it came from an address the caller
 *     declared, validated against the configured roster. That names an
 *     existing member rather than a stranger, but the box's `/api/*` has no
 *     auth token and never has (see bots/access.ts), so it is exactly as
 *     trustworthy as every other header on that API — which is to say the box
 *     already trusts whoever can reach it.
 *
 * Both are attribution, and neither is authorization. Nothing anywhere should
 * read this field as a permission check.
 *
 * `false` is the honest unknown: no marker, no recorded send, or an author the
 * box could not resolve to an address. The client renders those unattributed
 * rather than guessing (see isOtherHumanMessageAuthor).
 *
 * FOLLOW-UP: rename to `source: "managed" | "box" | "unknown"`, which says
 * this in the type instead of in a comment. Deliberately not done in the same
 * change as the behaviour, because it alters a persisted discriminant that
 * older cached bundles still read, and that migration deserves its own review.
 */
export type MessageAuthorRef =
  | { kind: "human" | "bot"; participantId: string; verified: true }
  | { kind: "legacy"; participantId: "legacy:unknown"; verified: false };
