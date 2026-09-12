// The transcript row model: the single definition of how a list of transcript
// messages folds into the rows a reader actually sees.
//
// THE FOLD RUNS ON THE SERVER. A connection that declares the `workRows`
// capability (see transcriptMessagesForClient in src/commands/serve.ts and
// framesForSocket in src/live-ws.ts) receives every run of tool_use /
// tool_result / thinking as ONE message of kind `work` carrying its `steps`,
// and receives a display tool call on the artifact it produced, as `tool`.
// A client renders what it is sent; it does not re-derive rows. The rule is
// in one place, the server applies it, and the two clients cannot drift.
//
// The web still imports this module (through web/src/lib/chat-render-items.ts)
// for the mapping from wire messages to render items and for counting rows,
// which is what the server pages history by. Both are built on the same fold,
// which is idempotent: a folded list folds to itself, so a page seam between
// two folded pages joins, and an unfolded list from an older server or an old
// cache still renders as rows.
//
// This lives in `src/` and not in `web/src/lib` because only this direction is
// legal: the web app already imports server modules, while the server bundle
// cannot import from `web/src`.

export type ChatRenderMessage = {
  id?: string | null;
  /** Client-only row identity kept across optimistic, queued, and settled ids. */
  renderKey?: string;
  kind?: string;
  role?: string;
  text?: string;
  ts?: number | null;
  pending?: boolean;
  queued?: boolean;
  /**
   * Kind `work`: the steps of the run, in order. An empty list WITHDRAWS the
   * row: its only step turned out to be a display call whose artifact then
   * arrived, so the step now rides on the artifact and the row has nothing
   * left to say. A client that upserts by id drops it at render time.
   */
  steps?: ChatRenderMessage[];
  /** An artifact: the display tool call that produced it. */
  tool?: ChatRenderMessage;
};

export type ChatRenderItem<T extends ChatRenderMessage> =
  | { type: "msg"; message: T; key: string }
  | { type: "tools"; items: T[]; key: string }
  | { type: "artifact_tool"; tool: T; message: T; key: string };

export const WORK_ROW_KIND = "work";

/** The message kinds that are steps of a run rather than rows of their own. */
export const WORK_STEP_KINDS: ReadonlySet<string> = new Set(["tool_use", "tool_result", "thinking"]);

export function isWorkStep(message: Pick<ChatRenderMessage, "kind">): boolean {
  return WORK_STEP_KINDS.has(message.kind ?? "");
}

export type ArtifactKind = "image" | "video" | "html" | "file";

/**
 * The tools whose call is answered by a visible artifact, and the kind of
 * artifact each one produces. This table is the only place a display tool is
 * named; add a row here to teach every reader about a new one.
 *
 * A verb matches under the `omg_` prefix and the retired `lfg_` prefix, bare
 * or MCP-qualified (`mcp__omg__omg_display_image`), so transcripts recorded
 * before the rename still pair with their artifact.
 */
export const DISPLAY_TOOL_ARTIFACTS: Readonly<Record<string, ArtifactKind>> = {
  display_image: "image",
  display_video: "video",
  publish_artifact: "html",
  display_file: "file",
};

const ARTIFACT_KINDS: ReadonlySet<string> = new Set(Object.values(DISPLAY_TOOL_ARTIFACTS));

export function isArtifactKind(kind: string | undefined): kind is ArtifactKind {
  return !!kind && ARTIFACT_KINDS.has(kind);
}

const DISPLAY_TOOL_NAME = /^(?:.*__)?(?:omg|lfg)_([a-z_]+)$/;

/** The artifact kind a tool name produces, or null for any other tool. */
export function displayToolArtifactKind(name: string): ArtifactKind | null {
  const match = DISPLAY_TOOL_NAME.exec(name);
  return match ? DISPLAY_TOOL_ARTIFACTS[match[1]!] ?? null : null;
}

export function toolName(text?: string): string {
  // tool_use text is "Name" or "Name: <input>" — the first token is the tool.
  return (text || "").split(":")[0].trim().split(/\s+/)[0] || "tool";
}

function artifactKindForTool(message: ChatRenderMessage): ArtifactKind | null {
  if (message.kind !== "tool_use") return null;
  return displayToolArtifactKind(toolName(message.text));
}

export function toolGroupLabel(items: ReadonlyArray<ChatRenderMessage>): string {
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

function messageKey(message: ChatRenderMessage, index: number): string {
  return message.renderKey ?? message.id ?? `${message.kind}-${message.ts}-${index}`;
}

// A work row is identified by its FIRST step. That id is stable while the run
// grows, which is what lets the live path re-send the same row with one more
// step and have both clients replace it in place instead of appending.
function workRow<T extends ChatRenderMessage>(steps: T[]): T {
  const first = steps[0]!;
  return {
    id: first.id ?? null,
    role: "assistant",
    kind: WORK_ROW_KIND,
    text: "",
    ts: first.ts ?? null,
    steps,
  } as unknown as T;
}

type FoldedSpan<T extends ChatRenderMessage> = {
  message: T;
  /** Index in the input of the first message this row came from. */
  start: number;
};

// THE RULE. A run is the thoughts and the tool calls together: the agent
// thinks, calls something, thinks about the result, calls again — one stretch
// of work, one row, opening into every step. Split by kind it read "Thought",
// "2 Bash", "Thought", "1 Bash", none of which say anything until opened. A
// lone thought is a run of one; the thought still streaming at the end of a
// live transcript is the newest step of the run it belongs to.
//
// The exception is a tool call whose answer is something to look at. A
// display call immediately followed by the artifact it produced is not a step:
// the artifact is the row, and the call rides on it as `tool`, so the picture
// never drifts away from the pill that made it and the pill never renders on
// its own. A display call with no artifact after it (the call failed, or an
// older transcript never recorded one) is an ordinary step.
//
// Idempotent. A `work` row on the input is a run of its steps, so a folded
// list folds to itself and two folded pages join at their seam.
function foldWorkSpans<T extends ChatRenderMessage>(messages: ReadonlyArray<T>): FoldedSpan<T>[] {
  const out: FoldedSpan<T>[] = [];
  const openRun = (): FoldedSpan<T> | null => {
    const last = out[out.length - 1];
    return last && last.message.kind === WORK_ROW_KIND ? last : null;
  };
  const extend = (run: FoldedSpan<T>, steps: T[]) => {
    run.message = { ...run.message, steps: [...(run.message.steps as T[]), ...steps] };
  };
  for (let index = 0; index < messages.length; index += 1) {
    const message = messages[index]!;
    if (message.kind === WORK_ROW_KIND) {
      const steps = (message.steps ?? []) as T[];
      if (!steps.length) continue; // withdrawn, see ChatRenderMessage.steps
      const run = openRun();
      if (run) extend(run, steps);
      else out.push({ message, start: index });
      continue;
    }
    if (isWorkStep(message)) {
      const run = openRun();
      if (run) extend(run, [message]);
      else out.push({ message: workRow([message]), start: index });
      continue;
    }
    if (isArtifactKind(message.kind) && !message.tool) {
      const run = openRun();
      const steps = run ? (run.message.steps as T[]) : [];
      const call = steps[steps.length - 1];
      if (run && call && artifactKindForTool(call) === message.kind) {
        const rest = steps.slice(0, -1);
        if (rest.length) run.message = { ...run.message, steps: rest };
        else out.pop();
        out.push({ message: { ...message, tool: call }, start: rest.length ? index : run.start });
        continue;
      }
    }
    out.push({ message, start: index });
  }
  return out;
}

/** The wire shape: the same list with every run folded into one `work` row. */
export function foldWorkRows<T extends ChatRenderMessage>(messages: ReadonlyArray<T>): T[] {
  return foldWorkSpans(messages).map((span) => span.message);
}

/**
 * The live half of the fold: one connection's view of a transcript as it
 * grows. Each incoming message yields the wire messages to send for it — the
 * open run re-sent with one more step, a message that closes the run, or an
 * artifact together with the run it took its display call from. A row is
 * always re-sent under the SAME id, so a client replaces it in place.
 *
 * Seed it from the snapshot the connection received, because a trailing run
 * in that snapshot is still open and the next step belongs to it.
 */
export class LiveWorkRows<T extends ChatRenderMessage> {
  private run: T | null = null;

  seed(rows: ReadonlyArray<T>): void {
    const last = rows[rows.length - 1];
    this.run = last?.kind === WORK_ROW_KIND && last.steps?.length ? last : null;
  }

  next(message: T): T[] {
    const before = this.run;
    const folded = foldWorkRows(before ? [before, message] : [message]);
    const last = folded[folded.length - 1];
    this.run = last?.kind === WORK_ROW_KIND ? last : null;
    if (!before) return folded;
    const [first, ...rest] = folded;
    if (first?.kind === WORK_ROW_KIND && first.id === before.id) {
      // Untouched means the message closed the run: only the message goes out.
      return first === before ? rest : [first, ...rest];
    }
    // The run's only step now rides on the artifact: withdraw the row.
    return [{ ...before, steps: [] }, ...folded];
  }
}

/** Wire messages as the rows a reader sees. */
export function buildChatRenderItems<T extends ChatRenderMessage>(messages: T[]): ChatRenderItem<T>[] {
  return foldWorkSpans(messages).map(({ message }, index) => {
    if (message.kind === WORK_ROW_KIND) {
      return { type: "tools", items: message.steps as T[], key: messageKey(message, index) };
    }
    if (message.tool) {
      const tool = message.tool as T;
      return {
        type: "artifact_tool",
        tool,
        message,
        key: message.id ?? tool.id ?? `artifact-tool-${message.ts}-${index}`,
      };
    }
    return { type: "msg", message, key: messageKey(message, index) };
  });
}

/** "4s", "1m 20s", "2m". Never zero for work that did happen. */
export function formatWorkDuration(ms: number): string {
  const seconds = Math.max(1, Math.round(ms / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return rest ? `${minutes}m ${rest}s` : `${minutes}m`;
}

/**
 * The one line a run of work shows: "Working for 4s" while the agent is still
 * in it, "Worked for 12s" once it is done. The counts ("Thought · 2 Bash") are
 * what the row opens INTO, not what it says — see toolGroupLabel.
 *
 * `endTs` is when the next thing happened, which is the honest end of a
 * finished run (a tool's own timestamp is when it was called, not when it
 * returned). Without it, the last step's timestamp stands in.
 */
export function toolGroupWorkLabel(
  items: ReadonlyArray<ChatRenderMessage>,
  options: { live: boolean; now?: number; endTs?: number | null },
): string {
  let start: number | null = null;
  let last: number | null = null;
  for (const message of items) {
    if (typeof message.ts !== "number") continue;
    if (start === null || message.ts < start) start = message.ts;
    if (last === null || message.ts > last) last = message.ts;
  }
  if (options.live) {
    const now = options.now ?? Date.now();
    return start === null ? "Working…" : `Working for ${formatWorkDuration(now - start)}`;
  }
  const end = options.endTs ?? last;
  if (start === null || end === null || end <= start) return "Worked";
  return `Worked for ${formatWorkDuration(end - start)}`;
}

// The number of rows this run of messages renders as. This is the unit a page
// of history has to be measured in: 88 raw tool messages are one row, and one
// row does not fill a viewport.
export function countTranscriptRows(messages: ReadonlyArray<ChatRenderMessage>): number {
  return foldWorkSpans(messages).length;
}

// Index of the first message of the last `rows` rendered rows. Used to bound a
// live transcript by what the reader sees instead of by raw message count.
// Returns 0 when the whole list is inside the window.
//
// The cut is on a row boundary, so the kept suffix renders exactly the rows
// that were counted.
export function transcriptRowWindowStart<T extends ChatRenderMessage>(
  messages: T[],
  rows: number,
): number {
  if (rows <= 0) return messages.length;
  const spans = foldWorkSpans(messages);
  if (spans.length <= rows) return 0;
  return spans[spans.length - rows]!.start;
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
