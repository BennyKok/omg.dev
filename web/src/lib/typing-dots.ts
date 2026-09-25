import type { ChatRenderItem, ChatRenderMessage } from "./chat-render-items";

/**
 * Whether the plain "working" dots show under the transcript.
 *
 * A live turn has one working indicator, not two. When the tail is a run of
 * tools, that row is live: it pulses and counts "Working for 25s", so dots
 * under it said the same thing again. The phone drops them in that case too
 * (mobile/src/omg/transcript.tsx). Reasoning at the tail replaces the dots for
 * the same reason.
 *
 * A bot chat is different. Its indicator is the bot itself, the only place the
 * creature appears in the stream, so it stays while the bot works.
 */
export function showsTypingIndicator(
  busy: boolean,
  tailItem: ChatRenderItem<ChatRenderMessage> | undefined,
  hasBot: boolean,
): boolean {
  if (!busy) return false;
  if (tailItem?.type === "msg" && tailItem.message.kind === "thinking") return false;
  if (tailItem?.type === "tools" && !hasBot) return false;
  return true;
}
