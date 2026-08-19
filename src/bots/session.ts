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
 * The session id a bot's chat should read.
 *
 * The bot's live conversation when there is one, otherwise the conversation it
 * will reattach to. Falling back to the raw saved id instead would put a
 * corrupt binding back on screen: `findBotMainSession` refuses to return the
 * delegated child, and the chat would then render that child anyway.
 */
export function botChatSessionId(
  bot: BotSessionRef,
  sessions: readonly BotSessionCandidate[],
): string | null {
  const live = findBotMainSession(bot, sessions);
  return live?.sessionId ?? botConversationRef(bot, sessions).sessionId ?? null;
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

/**
 * The single conversation a bot's roster row is backed by.
 *
 * The roster invariant is one row per persistent bot. Getting there needs more
 * than "pick a session with this botId", because child sessions inherit
 * `botId` (see the note at the top of this file). A bot that delegated three
 * subagents matched four sessions, and both the API and the list view turned
 * each one into its own row — the roster showed "Bot Improver" twice, "iOS
 * Manager" twice, and so on, each duplicate carrying a subagent's last line as
 * if the bot had said it.
 *
 * Resolution order, and why:
 *
 * 1. The configured primary, when it names a real conversation that is not
 *    delegated. This is the binding the bot's own record owns.
 * 2. A configured primary that names a delegated child is a corrupt binding,
 *    so it is repaired to that child's root ancestor rather than trusted.
 *    `botConversationRef` owns that walk.
 * 3. Otherwise the bot's own top-level sessions, lowest id first. Sorting
 *    matters: `find` returns whatever the session list happened to order
 *    first, so two stale top-level sessions could alternate between refreshes
 *    and read as a moving duplicate. A stable key makes the choice the same on
 *    every request and on every client.
 * 4. Otherwise the saved id even though nothing live matches it. The
 *    transcript is filed on disk under that id, so it still names the right
 *    history.
 *
 * Returns null only for a bot that has never held a conversation, which the
 * roster renders as a single "say hi" row.
 */
export function botCanonicalSessionId(
  bot: BotSessionRef,
  sessions: readonly BotSessionCandidate[],
): string | null {
  const saved = bot.sessionId?.trim();
  if (saved) {
    const exact = findById(sessions, saved);
    if (exact && !isDelegatedSession(exact)) return exact.sessionId ?? saved;
    // Present but delegated: repair rather than adopt the child.
    if (exact) {
      const repaired = botConversationRef(bot, sessions).sessionId;
      if (repaired) return repaired;
    }
  }
  const own = sessions
    .filter((session) => session.botId === bot.id && !isDelegatedSession(session))
    .map((session) => session.sessionId)
    .filter((id): id is string => !!id)
    .sort();
  if (own.length) return own[0];
  return saved || null;
}
