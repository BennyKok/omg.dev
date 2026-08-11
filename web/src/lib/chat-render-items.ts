export type ChatRenderMessage = {
  id?: string | null;
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
  for (const message of items) {
    if (message.kind === "tool_use") {
      const name = toolName(message.text);
      counts.set(name, (counts.get(name) ?? 0) + 1);
    } else {
      results += 1;
    }
  }
  const parts = [...counts].map(([name, count]) => `${count} ${name}`);
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
  return message.id ?? `${message.kind}-${message.ts}-${index}`;
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
    if (isTool) {
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
