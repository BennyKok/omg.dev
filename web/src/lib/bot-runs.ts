/**
 * Which bot turns open a "run", and therefore carry the bot's face.
 *
 * A task session's transcript reads as a log: assistant turns are bare markdown
 * on the canvas. A bot chat has to read as talking to somebody, so bot turns get
 * a bubble (spec §4.2) — and a bubble per turn would stamp the avatar down the
 * whole column, which reads as five different speakers rather than one bot
 * saying five things.
 *
 * So: consecutive bot turns with no user turn between them are one run, and only
 * the first bubble in a run carries the avatar. The rest sit against a spacer of
 * the same width, which is what keeps every bubble's left edge on one line.
 *
 * Tool groups do not break a run. A bot that answers, looks something up, and
 * finishes the thought is still mid-sentence as far as the reader is concerned;
 * only the human speaking starts a new run.
 */

type RunMessage = { role?: string; kind?: string };
type RunItem = { type: string; key: string; message?: RunMessage };

/**
 * True for a turn that renders as a bot bubble.
 *
 * Text only. Thinking blocks, images, video and artifacts already own their
 * presentation, and wrapping those in a chat bubble would put a card inside a
 * card.
 */
export function isBotBubbleMessage(message: RunMessage | undefined): boolean {
  if (!message || message.role === "user" || message.role === "system") return false;
  return !message.kind || message.kind === "text";
}

/** Keys of the render items that open a run, i.e. the ones showing the avatar. */
export function botRunAvatarKeys(items: readonly RunItem[]): Set<string> {
  const keys = new Set<string>();
  let runOpen = false;
  for (const item of items) {
    if (item.type !== "msg") continue;
    if (item.message?.role === "user") {
      runOpen = false;
      continue;
    }
    if (!isBotBubbleMessage(item.message)) continue;
    if (!runOpen) keys.add(item.key);
    runOpen = true;
  }
  return keys;
}
