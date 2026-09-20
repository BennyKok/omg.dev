import type { Entry, TranscriptItem } from "./transcript";

type ToolPair = Extract<TranscriptItem, { type: "tools" }>["pairs"][number];
const isCall = (message?: Entry) => message?.kind === "tool_use";
const isResult = (message?: Entry) => message?.kind === "tool_result";
const isThought = (message?: Entry) => message?.kind === "thinking";
const STAMP_GAP_MS = 15 * 60_000;

/** A pause long enough to earn a stamp between groups. Messages uses about an hour; this is a working chat. */

/**
 * A RUN ARRIVES FOLDED. The machine sends every stretch of thoughts and tool
 * calls as one message of kind `work` carrying its `steps` — the `workRows`
 * capability, declared on the socket URL in transport.ts and on the page
 * fetch in app/session/[id].tsx. The rule is src/transcript-rows.ts in the
 * lfg repository, and it runs there: this screen no longer decides what a run
 * is. A `work` row is a run, two adjacent ones are one run (a page seam), and
 * a row with no steps was withdrawn and draws nothing.
 *
 * A raw tool call or thought — from a machine whose server predates the
 * capability — lands on its own readable row rather than being folded here,
 * so there is one copy of the rule and it is not this one.
 *
 * `busy` marks the run at the end of the transcript as live: its label counts
 * up until the agent moves on.
 */
export function buildTranscriptItems(
  messages: Entry[],
  options: { busy?: boolean } = {},
): TranscriptItem[] {
  const items: TranscriptItem[] = [];
  let index = 0;
  let lastStampTs: number | null = null;

  /** One stamp per pause: the first row, then any row more than STAMP_GAP_MS after the last stamp. */
  const stamp = (ts: number | null | undefined, key: string) => {
    if (!ts) return;
    if (lastStampTs !== null && ts - lastStampTs < STAMP_GAP_MS) return;
    lastStampTs = ts;
    items.push({ type: "stamp", key: `stamp-${key}`, ts });
  };

  const pushMessage = (message: Entry, at: number) => {
    const key = entryKey(message, at);
    stamp(message.ts, key);
    items.push({
      type: "message",
      key,
      message,
      nextTs: messages[at + 1]?.ts ?? null,
    });
  };

  while (index < messages.length) {
    const message = messages[index];
    // Claude's steering marker carries no words a person wrote. It used to be
    // an "Interrupted" line; now it is not a row at all.
    if (isInterruptedTurn(message)) {
      index += 1;
      continue;
    }
    if (message.kind !== "work") {
      pushMessage(message, index);
      index += 1;
      continue;
    }
    let end = index;
    const run: Entry[] = [];
    while (end < messages.length && messages[end].kind === "work") {
      run.push(...(messages[end].steps ?? []));
      end += 1;
    }
    if (run.length) {
      const tools = run.filter((entry) => !isThought(entry));
      const key = `tools-${entryKey(message, index)}`;
      stamp(message.ts, key);
      items.push({
        type: "tools",
        key,
        pairs: buildToolPairs(tools, index),
        entries: run,
        nextTs: messages[end]?.ts ?? null,
        live: !!options.busy && end === messages.length,
      });
    }
    index = end;
  }

  return items;
}

/** See the file header: adjacency only, and only when the call stands alone. */
function buildToolPairs(run: Entry[], offset: number): ToolPair[] {
  const pairs: ToolPair[] = [];
  for (let i = 0; i < run.length; i += 1) {
    const message = run[i];
    const key = entryKey(message, offset + i);
    if (!isCall(message)) {
      pairs.push({ key, call: null, result: message });
      continue;
    }
    const solitary = !isCall(run[i - 1]) && !isCall(run[i + 1]);
    if (solitary && isResult(run[i + 1])) {
      pairs.push({ key, call: message, result: run[i + 1] });
      i += 1;
      continue;
    }
    pairs.push({ key, call: message, result: null });
  }
  return pairs;
}

/** Ids are nullable on the wire, so position is the fallback that keeps keys unique. */
export function entryKey(message: Entry, index: number): string {
  return message.localKey ?? message.id ?? `${message.kind ?? message.role ?? "msg"}-${index}`;
}

export function isInterruptedTurn(message: Entry): boolean {
  if (message.role !== "user") return false;
  return /^\[Request interrupted by user(?: for tool use)?\]$/i.test((message.text ?? "").trim());
}

/** Reuse settled rows; only the open work run and synthetic tail can change. */
export function appendTranscriptDraft(
  settled: TranscriptItem[], messages: Entry[], text: string, thought: string, busy: boolean,
): TranscriptItem[] {
  if (!text && !thought) return settled;
  const items = settled.slice();
  const last = items.at(-1);
  let start = messages.length;
  while (start > 0 && messages[start - 1].kind === "work") start--;
  const merges = start < messages.length && last?.type === "tools"
    && last.key === `tools-${entryKey(messages[start], start)}`;
  if (last?.type === "tools" && last.live) {
    items[items.length - 1] = { ...last, live: false };
  }
  if (thought) {
    const step: Entry = { id: "__thinking_step__", role: "assistant", kind: "thinking", text: thought };
    if (merges && last?.type === "tools") {
      items[items.length - 1] = { ...last, entries: [...last.entries, step], live: busy && !text };
    } else {
      const key = start < messages.length ? `tools-${entryKey(messages[start], start)}` : "tools-__thinking__";
      // An empty work row first becomes visible when its draft arrives.
      const ts = messages[start]?.ts;
      const lastStamp = items.findLast((item) => item.type === "stamp");
      if (ts && (!lastStamp || ts - lastStamp.ts >= STAMP_GAP_MS)) {
        items.push({ type: "stamp", key: `stamp-${key}`, ts });
      }
      items.push({ type: "tools", key,
        pairs: [], entries: [step], nextTs: null, live: busy && !text });
    }
  }
  if (text) items.push({ type: "message", key: "__streaming__", nextTs: null,
    message: { id: "__streaming__", role: "assistant", text, streaming: true } });
  return items;
}

export const INITIAL_TRANSCRIPT_ITEMS = 12;

/** Keep the opening anchor fixed as new replies arrive. Expansion is local. */
export class TranscriptWindow {
  private anchor: string | null = null;
  view(items: TranscriptItem[], expanded: boolean) {
    let start = items.findIndex((item) => item.key === this.anchor);
    if (start < 0 && items.length) {
      start = Math.max(0, items.length - INITIAL_TRANSCRIPT_ITEMS);
      this.anchor = items[start].key;
    }
    start = expanded ? 0 : Math.max(0, start);
    return { items: start ? items.slice(start) : items, hasEarlier: start > 0 };
  }
}
