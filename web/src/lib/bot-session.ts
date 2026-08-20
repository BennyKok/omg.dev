// The client resolves a bot's conversation with the same rules the server
// binds it by. Two copies drifted once already: the client learned to skip
// delegated children while the server was still rebinding bot records to them,
// so the chat and the record disagreed about which session a bot owned.
export {
  botCanonicalSessionId,
  botChatSessionId,
  botConversationRef,
  findBotMainSession,
  isDelegatedSession,
  type BotSessionCandidate,
  type BotSessionRef,
} from "../../../src/bots/session.ts";

/**
 * The session object a bot's own stage column renders.
 *
 * The stage column is picked by sessionId (`botCanonicalSessionId`, then a
 * plain lookup by that id in the live session list). The resolver already
 * refuses to name a session owned by someone else, but it cannot invent
 * ownership a session hasn't been tagged with yet: a freshly launched session
 * the list hasn't caught up on, or the documented fallback to a saved id
 * whose session isn't live at all. Whatever the picker hands back, its
 * `botId` field was still read straight off the raw record — so a session
 * found by id alone, but not carrying this bot's `botId`, rendered with the
 * harness's generic session header instead of the bot's own, silently
 * dropping the bot surface the roster had just picked.
 *
 * The picker already knows which bot this column belongs to, so stamp that
 * identity on directly rather than trust whatever `botId` (if any) the raw
 * session record carries. A session already tagged with a DIFFERENT bot's id
 * is left untouched — that is a real conflict to surface, not a label to
 * silently overwrite.
 */
export function botStageSession<S extends { botId?: string | null; botName?: string | null }>(
  bot: { id: string; name: string },
  session: S,
): S {
  if (session.botId) return session;
  return { ...session, botId: bot.id, botName: bot.name };
}
