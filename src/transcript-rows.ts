// The transcript row model: the single definition of how a list of transcript
// messages folds into the rows a reader actually sees.
//
// This lives in `src/` and not in `web/src/lib` because both sides need it and
// only this direction is legal: the web app already imports server modules
// (see web/src/lib/conversation-ui.ts and web/src/lib/bot-session.ts), while
// the server bundle cannot import from `web/src`. `web/src/lib/chat-render-
// items.ts` re-exports everything here, so client imports are unchanged.
//
// The server needs the rule because pagination used to count RAW MESSAGES
// while the UI renders COLLAPSED ROWS. A run of tool_use / tool_result /
// thinking is one row, so a page of 80 raw messages could render as three rows
// and leave the viewport empty on a tool-heavy session. A second copy of the
// rule on the server would let the two drift, so there is exactly one.

export type ChatRenderMessage = {
  id?: string | null;
  /** Client-only row identity kept across optimistic, queued, and settled ids. */
  renderKey?: string;
  kind?: string;
  text?: string;
  ts?: number | null;
  pending?: boolean;
  queued?: boolean;
};

export type ChatRenderItem<T extends ChatRenderMessage> =
  | { type: "msg"; message: T; key: string }
  | { type: "tools"; items: T[]; key: string }
  | { type: "artifact_tool"; tool: T; message: T; key: string };

export function toolName(text?: string): string {
  // tool_use text is "Name" or "Name: <input>" — the first token is the tool.
  return (text || "").split(":")[0].trim().split(/\s+/)[0] || "tool";
}

export function toolGroupLabel(items: ChatRenderMessage[]): string {
  const counts = new Map<string, number>();
  let results = 0;
  let thoughts = 0;
  for (const message of items) {
    if (message.kind === "tool_use") {
      const name = toolName(message.text);
      counts.set(name, (counts.get(name) ?? 0) + 1);
    } else if (message.kind === "thinking") {
      thoughts += 1;
    } else {
      results += 1;
    }
  }
  // Thinking leads: it is what the agent did before reaching for the tools,
  // and it reads as a sentence that way — "Thought · 3 Bash · 1 Read".
  const parts = thoughts ? [thoughts === 1 ? "Thought" : `${thoughts} thoughts`] : [];
  parts.push(...[...counts].map(([name, count]) => `${count} ${name}`));
  if (results) parts.push(`${results} result${results === 1 ? "" : "s"}`);
  return parts.join(" · ") || `${items.length} step${items.length === 1 ? "" : "s"}`;
}

function artifactKindForTool(message: ChatRenderMessage): "image" | "video" | "html" | null {
  if (message.kind !== "tool_use") return null;
  const name = toolName(message.text);
  // The tools are registered as omg_*; the lfg_* spellings are kept so
  // transcripts recorded before the rename still pair with their artifact.
  if (matchesTool(name, "display_image")) return "image";
  if (matchesTool(name, "display_video")) return "video";
  if (matchesTool(name, "publish_artifact")) return "html";
  return null;
}

function matchesTool(name: string, verb: string): boolean {
  for (const prefix of ["omg_", "lfg_"]) {
    const full = `${prefix}${verb}`;
    if (name === full || name.endsWith(`__${full}`)) return true;
  }
  return false;
}

function messageKey(message: ChatRenderMessage, index: number): string {
  return message.renderKey ?? message.id ?? `${message.kind}-${message.ts}-${index}`;
}

// Display/publish tools already have a purpose-built visual result. Pair the
// synthetic artifact message with its immediately preceding LFG tool call so
// the generic tool pill does not render separately from (or drift away from)
// the image/video/dashboard it produced. Standalone artifacts remain ordinary
// messages, which is important for old transcripts and live artifact updates.
export function buildChatRenderItems<T extends ChatRenderMessage>(messages: T[]): ChatRenderItem<T>[] {
  const items: ChatRenderItem<T>[] = [];
  messages.forEach((message, index) => {
    const isTool = message.kind === "tool_use" || message.kind === "tool_result";
    // Thinking that lands in the middle of a run of tool calls belongs to that
    // run. Left on its own it broke the run into one pill per call, and a turn
    // that used six tools rendered as twelve alternating rows — "Thought", "2
    // Bash", "Thought", "1 Bash" — none of which say anything until opened.
    //
    // Two thoughts are deliberately NOT folded, because both are the only
    // thing on screen when they happen:
    //   - the one that opens a run, before any tool has been called. There is
    //     no group for it to join yet, and it is the whole answer to "what is
    //     it doing" until the first tool appears.
    //   - the last message in the transcript, which is the one still
    //     streaming. Folding it would trade a live view of the reasoning for
    //     a pill you have to open.
    const isFoldableThought =
      message.kind === "thinking" &&
      index < messages.length - 1 &&
      items[items.length - 1]?.type === "tools";
    if (isTool || isFoldableThought) {
      const last = items[items.length - 1];
      if (last?.type === "tools") {
        last.items.push(message);
        return;
      }
      items.push({ type: "tools", items: [message], key: messageKey(message, index) });
      return;
    }

    if (message.kind === "image" || message.kind === "video" || message.kind === "html") {
      const last = items[items.length - 1];
      if (last?.type === "tools") {
        const tool = last.items[last.items.length - 1];
        if (artifactKindForTool(tool) === message.kind) {
          last.items.pop();
          if (!last.items.length) items.pop();
          items.push({
            type: "artifact_tool",
            tool,
            message,
            key: message.id ?? tool.id ?? `artifact-tool-${message.ts}-${index}`,
          });
          return;
        }
      }
    }

    items.push({ type: "msg", message, key: messageKey(message, index) });
  });
  return items;
}

// How many messages one rendered row consumed. Every message belongs to
// exactly one row, so these sum to the length of the input.
export function chatRenderItemMessageCount<T extends ChatRenderMessage>(item: ChatRenderItem<T>): number {
  if (item.type === "tools") return item.items.length;
  // An artifact row holds the display tool call and the artifact it produced.
  if (item.type === "artifact_tool") return 2;
  return 1;
}

// The number of rows this run of messages renders as. This is the unit a page
// of history has to be measured in: 88 raw tool messages are three rows, and
// three rows do not fill a viewport.
export function countTranscriptRows(messages: ReadonlyArray<ChatRenderMessage>): number {
  return buildChatRenderItems([...messages]).length;
}

// Index of the first message of the last `rows` rendered rows. Used to bound a
// live transcript by what the reader sees instead of by raw message count.
// Returns 0 when the whole list is inside the window.
//
// The cut is always on a row boundary, so the kept suffix re-groups the same
// way, except that a thought which opened a folded run can become its own row
// once the run above it is gone. That only ever adds a row, so the window
// stays a lower bound.
export function transcriptRowWindowStart<T extends ChatRenderMessage>(
  messages: T[],
  rows: number,
): number {
  if (rows <= 0) return messages.length;
  const items = buildChatRenderItems(messages);
  if (items.length <= rows) return 0;
  let kept = 0;
  for (let index = items.length - rows; index < items.length; index += 1) {
    kept += chatRenderItemMessageCount(items[index]!);
  }
  return Math.max(0, messages.length - kept);
}

// A queued turn is ordered by when it was *written*, but the agent has not read
// it yet: the turn it waits behind keeps streaming thinking, tools and text
// after it. Left in timestamp order it scrolls up into the middle of output it
// never influenced and reads as already answered. Split it out so the view can
// pin it below the live turn until the real transcript row replaces it.
export function splitQueuedRenderItems<T extends ChatRenderMessage>(
  items: ChatRenderItem<T>[],
): { items: ChatRenderItem<T>[]; queued: ChatRenderItem<T>[] } {
  const isQueued = (item: ChatRenderItem<T>) =>
    item.type === "msg" && !!item.message.queued && !!item.message.pending;
  const queued = items.filter(isQueued);
  if (!queued.length) return { items, queued };
  return { items: items.filter((item) => !isQueued(item)), queued };
}
