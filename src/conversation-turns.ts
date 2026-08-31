/**
 * The one place a human turn is recorded, for every surface that accepts one.
 *
 * Two routes accept human text: the bot message POST and the ordinary session
 * send. Both have to do the same three things, in the same order, or the two
 * surfaces disagree about who is in a conversation and who wrote what. They
 * used to do it twice, and had already drifted: one passed an explicit
 * `role: "member"`, so the first person to write into a conversation with an
 * empty roster could never become its owner, while the other left the role to
 * be derived and could.
 *
 * This module exists so that stays one decision. It is deliberately a third
 * module rather than a function on conversations.ts: conversations.ts already
 * imports the authorship store to resolve an author, so putting the writer
 * there would make that pair circular.
 *
 * THE TEXT TO PASS IS THE DELIVERED TEXT
 *
 * `deliveredText` must be exactly what reaches the agent, not what the client
 * typed. Attribution is keyed by a digest of the turn (conversation-authorship
 * .ts explains why that is the only key that survives the round trip), so a
 * digest taken before the server rewrites the text would never match the row
 * the transcript ends up holding.
 *
 * That is also what removes the ambiguity limit for bot conversations. The bot
 * path prepends `[Message from <email> to bot <name>]`, so two people who both
 * send "yes" produce two different delivered texts and therefore two different
 * digests. The digest key is only lossy where the text really is identical,
 * which is the ordinary-session case.
 */

import {
  ensureConversationHuman,
  viewerConversationParticipantId,
} from "./conversations.ts";
import { recordAuthoredSend } from "./conversation-authorship.ts";
import { userRoster } from "./users.ts";

export type HumanTurn = {
  /**
   * The durable conversation this turn belongs to. Null or empty means the
   * caller could not resolve one, and the turn is recorded for authorship only
   * — a face beside a message is still better than nothing, and the roster is
   * the part that needs an id.
   */
  conversationId?: string | null;
  /** The runtime session whose transcript will hold this turn. */
  sessionId: string;
  /** The sender's email. Must be an identity the server resolved itself. */
  identity: string;
  /** Exactly what was handed to the agent. See the module note. */
  deliveredText: string;
  at?: number;
};

/**
 * Join the sender to the conversation roster and record who wrote this turn.
 *
 * Idempotent on both halves: re-recording the same turn does not duplicate a
 * participant, and does not turn one author into an ambiguous pair.
 *
 * Deliberately does NOT pass a role. ensureConversationHuman seats the first
 * human in an empty roster as owner and everyone after as a member, which is
 * the behaviour both surfaces want and neither should restate.
 */
export function recordHumanTurn(turn: HumanTurn): void {
  const identity = turn.identity.trim();
  // Only an address can be a person. conversationHumanParticipantId hashes any
  // non-empty string, so it would happily mint a participant for the literal
  // "user" that resolveBotMessageAuthor falls back to, and that id names
  // nobody while looking exactly like somebody. viewerConversationParticipantId
  // already owns this rule for the read side; this is the write side of it.
  const participantId = viewerConversationParticipantId(identity);
  if (!participantId || !turn.sessionId) return;

  const conversationId = turn.conversationId?.trim();
  if (conversationId) {
    const profile = userRoster().find(
      (user) => user.email.trim().toLowerCase() === identity.toLowerCase(),
    );
    ensureConversationHuman({
      conversationId,
      identity,
      name: profile?.name,
      avatar: profile?.avatar,
    });
  }

  recordAuthoredSend({
    sessionId: turn.sessionId,
    participantId,
    text: turn.deliveredText,
    at: turn.at,
  });
}
