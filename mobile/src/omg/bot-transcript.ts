/**
 * What of a bot's backing session the human is meant to read as a chat.
 *
 * A bot's session is a normal managed session (see the server's
 * `POST /api/bots/:id/messages`, src/commands/serve.ts), so its transcript
 * carries the same plumbing any session does — tool calls, tool results,
 * thinking blocks — plus one thing unique to a bot's FIRST turn: the launch
 * envelope the server folds in with the human's own opening line (bundling
 * them avoids a race between the agent's boot and a message sent right after
 * it — see the server route's own comment). A bot chat should read as talking
 * to somebody, not as a session log, so both get stripped here at the
 * rendering boundary — never in the message store itself, so the underlying
 * session is still a complete, honest transcript when opened as a session.
 *
 * Mirrors the web's web/src/lib/bot-transcript.ts in spirit (same envelope
 * strip, same hidden-kind set), narrower in scope: this branch's server does
 * not carry the prior-conversation-summary block, background-task reports, or
 * bot-to-bot peer messages the web strips, because this branch's minimal
 * `POST /api/bots/:id/messages` (see serve.ts's own note on it) does not
 * generate any of those. Extend this file, not that endpoint, once the
 * pending reconciliation lands the fuller bot stack.
 */

const ENVELOPE_HEADER = "=== omg.dev BOT CHAT LAUNCH ===";
const ENVELOPE_BLOCK =
  /===\s*omg\.dev BOT CHAT LAUNCH\s*===[\s\S]*?===\s*END omg\.dev BOT CHAT LAUNCH\s*===/i;

/**
 * Remove the launch envelope, leaving whatever real message rode in with it.
 *
 * A pure, namespace-marked string transform — safe to run over EVERY
 * incoming message, bot chat or not, because the marker never occurs in
 * ordinary text. That is what lets it double as the optimistic-send dedupe
 * fix in app/session/[id].tsx: the echoed first turn of a new bot
 * conversation comes back as `envelope + "\n\n" + text`, which would
 * otherwise never text-match the plain `text` the composer sent
 * optimistically, leaving two copies of the human's own first line on
 * screen.
 */
export function stripBotLaunchEnvelope(text: string): string {
  return text.replace(ENVELOPE_BLOCK, "").trim();
}

/** True only for a launch turn that is *pure* plumbing — should never happen
 * given the server always folds real text in, but a transcript reloaded
 * mid-launch could still catch it half-written. */
export function isBotLaunchOnlyText(text: string): boolean {
  return text.trimStart().startsWith(ENVELOPE_HEADER) && stripBotLaunchEnvelope(text) === "";
}

/** Transcript kinds a bot chat does not show — the machinery behind a reply,
 * not the reply. See transcript.tsx's own header for why `kind` is how a
 * message's shape is read. */
const HIDDEN_IN_BOT_CHAT = new Set(["tool_use", "tool_result", "thinking"]);

export function isBotHiddenKind(kind: string | undefined): boolean {
  return !!kind && HIDDEN_IN_BOT_CHAT.has(kind);
}

/**
 * The messages array as a bot chat should read it: plumbing kinds dropped,
 * the launch envelope stripped off whichever turn carried it, and a
 * now-fully-stripped launch-only turn dropped rather than left as an empty
 * bubble.
 *
 * Applied at render time (see app/session/[id].tsx's `data` memo), not to the
 * `messages` state itself — the same session opened from the sessions rail
 * still shows its whole, honest log.
 */
export function filterBotChatEntries<T extends { role?: string; kind?: string; text?: string }>(
  entries: readonly T[],
): T[] {
  const out: T[] = [];
  for (const entry of entries) {
    if (isBotHiddenKind(entry.kind)) continue;
    if (entry.role !== "user" || typeof entry.text !== "string") {
      out.push(entry);
      continue;
    }
    if (isBotLaunchOnlyText(entry.text)) continue;
    const stripped = stripBotLaunchEnvelope(entry.text);
    out.push(stripped === entry.text ? entry : { ...entry, text: stripped });
  }
  return out;
}
