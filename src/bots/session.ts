// Which session is a bot's own conversation — the single owner of that answer.
//
// A bot has exactly one conversation, and it must never be a task the bot
// delegated. Two facts make that easy to get wrong:
//
// 1. Child sessions INHERIT `botId` for attribution (see the lineage pass at
//    the end of listSessions in sessions.ts). So `session.botId === bot.id`
//    matches the bot's conversation AND every subagent it ever spawned.
// 2. Whatever session a lookup returns gets persisted back onto the bot record
//    (`deliverBotMessage`). A single wrong match is therefore permanent: the
//    bot's saved conversation id becomes a child's id, the chat opens the
//    child, and the human's next message is queued behind that child's task.
//
// That is not hypothetical — it happened. A bot's conversation process died
// while two of its subagents were still running, a broad `botId` match picked a
// surviving child, and the bot's record was rebound to it. The human then had a
// bot chat showing a delegated acceptance-test run, with no way back to the
// real conversation and messages stacking up behind a turn that was never
// theirs.
//
// So resolution lives here, is used by the server and the web client, and
// rejects delegated sessions on every path.

/** A bot's identity plus the conversation id currently saved on its record. */
export type BotSessionRef = {
  id: string;
  sessionId?: string | null;
};

/** The session fields conversation resolution reads, in either read model. */
export type BotSessionCandidate = {
  sessionId?: string | null;
  nativeSessionId?: string | null;
  botId?: string | null;
  parentSessionId?: string | null;
  parentNativeSessionId?: string | null;
  subagentDepth?: number | null;
  spawnedBy?: string | null;
};

/** Cap the ancestor walk so a corrupted parent cycle cannot spin. */
const MAX_ANCESTOR_HOPS = 8;

/**
 * A session that belongs to someone else's turn: a delegated child, not a
 * bot's own conversation. Any one of these markers is enough.
 */
export function isDelegatedSession(session: BotSessionCandidate): boolean {
  return (
    !!session.parentSessionId ||
    !!session.parentNativeSessionId ||
    !!session.subagentDepth ||
    session.spawnedBy === "subagent"
  );
}

function matchesId(session: BotSessionCandidate, id: string): boolean {
  return session.sessionId === id || session.nativeSessionId === id;
}

function findById<T extends BotSessionCandidate>(
  sessions: readonly T[],
  id: string,
): T | undefined {
  return sessions.find((session) => matchesId(session, id));
}

/**
 * Resolve only the bot's main conversation.
 *
 * The saved id wins when it names a real conversation. When it names a
 * delegated child the binding is corrupt, so it is ignored rather than
 * trusted — falling through to the bot's own top-level session if one is live.
 */
export function findBotMainSession<T extends BotSessionCandidate>(
  bot: BotSessionRef,
  sessions: readonly T[],
): T | undefined {
  const saved = bot.sessionId?.trim();
  if (saved) {
    const exact = findById(sessions, saved);
    if (exact && !isDelegatedSession(exact)) return exact;
  }
  return sessions.find(
    (session) => session.botId === bot.id && !isDelegatedSession(session),
  );
}

/**
 * The conversation id a bot's next process must attach to, with a corrupted
 * binding repaired.
 *
 * When the saved id names one of the bot's delegated children, the bot's real
 * conversation is that child's root ancestor — the session the child was
 * spawned from. Walking up recovers the original id even when its process is
 * long dead, which is the whole point: that id is the key the transcript is
 * filed under (`lfg://session/<id>`), so recovering it brings the human's chat
 * history back instead of adopting a subagent's thread as the bot's history.
 *
 * Returns null when there is nothing safe to attach to, which tells the caller
 * to mint a fresh conversation.
 */
export function botConversationRef(
  bot: BotSessionRef,
  sessions: readonly BotSessionCandidate[],
): { sessionId?: string } {
  const saved = bot.sessionId?.trim();
  if (!saved) return {};

  const exact = findById(sessions, saved);
  if (!exact || !isDelegatedSession(exact)) return { sessionId: saved };

  const seen = new Set<string>([saved]);
  let current: BotSessionCandidate = exact;
  for (let hop = 0; hop < MAX_ANCESTOR_HOPS; hop++) {
    const parentId = (current.parentSessionId ?? current.parentNativeSessionId)?.trim();
    if (!parentId || seen.has(parentId)) return {};
    seen.add(parentId);
    const parent = findById(sessions, parentId);
    // A parent that is no longer live is still the right conversation id: the
    // bot is about to be relaunched onto it, and its transcript is on disk.
    if (!parent) return { sessionId: parentId };
    if (!isDelegatedSession(parent)) return { sessionId: parent.sessionId ?? parentId };
    current = parent;
  }
  return {};
}
