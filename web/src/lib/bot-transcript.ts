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
const ATTRIBUTION = /^\s*\[Message from [^\]]+ to bot [^\]]+\]\s*/i;

/** Remove the launch envelope, leaving whatever real message rode with it. */
export function stripBotLaunchEnvelope(text: string): string {
  return text.replace(CONTRACT_BLOCK, "").replace(SUMMARY_BLOCK, "").trim();
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

export function isSubagentUpdateText(text: string): boolean {
  return SUBAGENT_UPDATE.test(text);
}
