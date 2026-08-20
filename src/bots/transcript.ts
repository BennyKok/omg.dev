/**
 * What of a bot session's transcript the human is meant to see.
 *
 * A bot's backing session is an ordinary session, so its transcript carries
 * launch plumbing the bot chat must not show: the runtime contract, a prior
 * conversation summary on relaunch, and the `[Message from ...]` attribution
 * wrapper on every turn.
 *
 * The subtle part is the launch turn. The first user message is deliberately
 * bundled *into* the launch prompt — sending it separately raced the boot and
 * the bot answered neither, so the greeting went unanswered. That makes the
 * launch turn simultaneously plumbing and a real user message, and the two
 * have to be separated rather than the whole turn dropped. Hiding it wholesale
 * opens every conversation with a reply to an invisible question.
 */

const CONTRACT_HEADER = "=== omg.dev BOT RUNTIME CONTRACT";

const CONTRACT_BLOCK =
  /===\s*omg\.dev BOT RUNTIME CONTRACT[\s\S]*?===\s*END omg\.dev BOT RUNTIME CONTRACT\s*===/i;
const SUMMARY_BLOCK =
  /===\s*PRIOR CONVERSATION SUMMARY\s*===[\s\S]*?===\s*END PRIOR CONVERSATION SUMMARY\s*===/i;
/**
 * The structured handoff a rotation carries into the new session
 * (`src/bots/rotation.ts`). It is briefing material for the model, in the same
 * category as the contract and the prior-conversation summary, and it is hidden
 * for the same reason: a rotated conversation would otherwise open with a wall
 * of bulleted summary in the human's own message bubble.
 *
 * What the human is meant to see instead is the one-line notice the rotation
 * puts *outside* this block — see `rotationNoticeText`. Hiding the block and
 * showing the line is the whole of "visible but quiet".
 */
const CHECKPOINT_BLOCK =
  /===\s*omg\.dev BOT HANDOFF CHECKPOINT\s*===[\s\S]*?===\s*END omg\.dev BOT HANDOFF CHECKPOINT\s*===/i;
const ATTRIBUTION = /^\s*\[Message from [^\]]+ to bot [^\]]+\]\s*/i;

/** Remove the launch envelope, leaving whatever real message rode with it. */
export function stripBotLaunchEnvelope(text: string): string {
  return text
    .replace(CONTRACT_BLOCK, "")
    .replace(SUMMARY_BLOCK, "")
    .replace(CHECKPOINT_BLOCK, "")
    .trim();
}

/**
 * The quiet one-liner a rotated conversation opens with.
 *
 * Recognised here so the renderer can set it apart from something the human
 * typed. It rides in the launch turn as ordinary user text — the same way a
 * fired routine's `[Scheduled routine: ...]` message does — because that is
 * what puts it in front of the model as well as the reader.
 */
const ROTATION_NOTICE = /^\s*\[This conversation continues (?:with your updated configuration|in a fresh context window)\b[^\]]*\]\s*$/i;

export function isBotRotationNoticeText(text: string): boolean {
  return ROTATION_NOTICE.test(stripBotLaunchEnvelope(text).replace(ATTRIBUTION, ""));
}

/** The text of a user turn as the human should read it back in the bot chat. */
export function botVisibleUserText(text: string, isBotChat = true): string {
  if (!isBotChat) return text;
  return stripBotLaunchEnvelope(text).replace(ATTRIBUTION, "");
}

/**
 * True only for a launch turn that is *pure* plumbing. A launch turn carrying
 * the first user message is a real turn and must render.
 */
export function isBotLaunchOnlyText(text: string): boolean {
  return text.trimStart().startsWith(CONTRACT_HEADER) && stripBotLaunchEnvelope(text) === "";
}

/**
 * A background task session reporting home to the bot that spawned it.
 *
 * Heavy work does not run in a chat turn — the bot hands it to a task session,
 * which reports back with the markers from the subagent operating contract
 * (`[subagent progress]`, and one of complete/blocked/failed at the end). Those
 * arrive on the bot's session as ordinary user turns, so without this they
 * render as though the human typed `[subagent complete] rebased onto main…`
 * into their own chat.
 *
 * They are machinery, like the launch envelope and the attribution wrapper, and
 * they are hidden for the same reason. What the human should read is the bot's
 * own next message, which the bot contract requires it to write in plain words
 * — the report is the bot's source, not its output.
 */
const SUBAGENT_UPDATE = /^\s*\[subagent (?:progress|complete|blocked|failed)\]/i;
// The attribution wrapper the server puts on an agent-authored update, naming
// which background task is reporting. Older transcripts carry the bare marker
// with no wrapper, so both forms have to be recognised forever.
const BACKGROUND_ATTRIBUTION = /^\s*\[Background task [^\]]*\]/i;

export function isSubagentUpdateText(text: string): boolean {
  return BACKGROUND_ATTRIBUTION.test(text) || SUBAGENT_UPDATE.test(text);
}

/**
 * Transcript kinds a bot chat does not show.
 *
 * A task session's transcript is a log you read: every tool call, every result,
 * every reasoning block, because the point is auditing what the agent did. A bot
 * chat is a conversation you are having, and a conversation does not narrate its
 * own mechanics — nobody wants `$ rg -n "persistent bot" src` in the middle of
 * being answered.
 *
 * Nothing is lost, only relocated: the bot's session is still an ordinary
 * session, so opening it from the sessions rail shows the whole log, tools and
 * reasoning included. The bot chat is a view of that session, not a different
 * recording of it — and heavy work does not run here anyway, it runs in a
 * background session that has its own row in the fleet.
 *
 * Images, video and artifacts stay. A bot that answers you with a picture chose
 * to hand you that picture; it is the reply, not the machinery behind it.
 */
const HIDDEN_IN_BOT_CHAT = new Set(["tool_use", "tool_result", "thinking"]);

export function isBotHiddenLogKind(kind: string | undefined): boolean {
  return !!kind && HIDDEN_IN_BOT_CHAT.has(kind);
}
