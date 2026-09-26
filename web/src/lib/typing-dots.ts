import type { ChatRenderItem, ChatRenderMessage } from "./chat-render-items";
import { settledParagraphs } from "./paragraph-stream";

/**
 * Whether the plain "working" dots show under the transcript.
 *
 * A live turn has one working indicator, not two. When the tail is a run of
 * tools, that row is live: it pulses and counts "Working for 25s", so dots
 * under it said the same thing again. A live reply at the tail is the same
 * case: it draws its own dots until its first paragraph arrives. The phone drops them in that case too
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
  // A live reply at the tail owns the typing state. It shows whole paragraphs
  // (lib/paragraph-stream), and until the first one completes its own bubble
  // draws the dots; a second row of dots under it said the same thing twice.
  if (tailItem?.type === "msg" && isLiveReply(tailItem.message)) return false;
  if (tailItem?.type === "tools" && !hasBot) return false;
  return true;
}

/** A reply still being written: the live draft row, not a settled message. */
function isLiveReply(message: ChatRenderMessage): boolean {
  return (
    message.role === "assistant" &&
    message.kind === "text" &&
    typeof message.id === "string" &&
    message.id.startsWith("draft-")
  );
}

/**
 * Rows to render while a turn is live, with one exception to "render what the
 * server sent": a live reply that has not finished a paragraph yet, right
 * after a run of work, is left out.
 *
 * Why: some agents (DeepSeek through OpenCode) open a reply draft on almost
 * every step. The empty draft then sat at the tail, drew its own dots, and
 * took the "live" row away from the work before it, which froze at "Worked
 * for 11m" while the agent was still going. A new user's first task read as
 * stuck and they left. Without the empty draft, the work row is the tail: it
 * stays live and says what the agent is doing. The draft appears as soon as
 * it has a paragraph to show.
 */
export function rowsWhileLive<T extends ChatRenderMessage>(
  busy: boolean,
  items: ChatRenderItem<T>[],
): ChatRenderItem<T>[] {
  if (!busy || items.length < 2) return items;
  const tail = items[items.length - 1];
  const before = items[items.length - 2];
  if (tail?.type !== "msg" || before?.type !== "tools") return items;
  if (!isLiveReply(tail.message)) return items;
  if (settledParagraphs(tail.message.text ?? "").trim()) return items;
  return items.slice(0, -1);
}
