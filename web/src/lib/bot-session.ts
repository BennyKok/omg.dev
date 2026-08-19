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
