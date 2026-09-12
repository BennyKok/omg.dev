import { describe, expect, test } from "bun:test";
import {
  buildChatRenderItems,
  countTranscriptRows,
  displayToolArtifactKind,
  foldWorkRows,
  LiveWorkRows,
  toolGroupLabel,
  toolGroupWorkLabel,
  transcriptRowWindowStart,
  type ChatRenderMessage,
} from "./transcript-rows.ts";

// The rule the server folds by, pages by, and both clients render by. There is
// one copy of it, so these tests cover every side.

let seq = 0;
function message(kind: string, text = "", id?: string): ChatRenderMessage {
  seq += 1;
  return { id: id ?? `${kind}-${seq}`, kind, text, ts: seq };
}

function toolRun(count: number, name = "Bash"): ChatRenderMessage[] {
  return Array.from({ length: count }, (_, index) => message("tool_use", `${name}: step ${index}`));
}

const kinds = (messages: ChatRenderMessage[]) => foldWorkRows(messages).map((m) => m.kind);
const steps = (row: ChatRenderMessage | undefined) => (row?.steps ?? []).map((m) => m.id);

describe("the fold", () => {
  test("a run of tool calls is one work row, identified by its first step", () => {
    const run = toolRun(49);
    const folded = foldWorkRows([message("text", "hi"), ...run]);
    expect(folded.map((m) => m.kind)).toEqual(["text", "work"]);
    expect(folded[1]!.id).toBe(run[0]!.id);
    expect(folded[1]!.ts).toBe(run[0]!.ts);
    expect(steps(folded[1])).toEqual(run.map((m) => m.id));
  });

  test("tool_result and thinking are steps of the run they sit in", () => {
    const messages = [
      message("thinking", "plan"),
      ...toolRun(2),
      message("tool_result", "a b c"),
      message("thinking", "consider"),
      ...toolRun(2),
      message("text", "done"),
    ];
    expect(kinds(messages)).toEqual(["work", "text"]);
    expect(foldWorkRows(messages)[0]!.steps).toHaveLength(7);
  });

  test("every thought folds: the one that opens a run, a lone one, and the streaming tail", () => {
    expect(kinds([message("thinking", "first"), ...toolRun(3), message("thinking", "last")])).toEqual(["work"]);
    expect(kinds([message("thinking", "alone"), message("text", "answer")])).toEqual(["work", "text"]);
  });

  test("plain text turns are untouched, by reference", () => {
    const messages = [message("text", "hi"), message("text", "there")];
    const folded = foldWorkRows(messages);
    expect(folded[0]).toBe(messages[0]!);
    expect(folded[1]).toBe(messages[1]!);
  });

  test("a display call rides on its artifact instead of being a step", () => {
    const call = message("tool_use", "omg_display_image: shot.png", "tool-1");
    const image = message("image", "", "artifact-1");
    const folded = foldWorkRows([...toolRun(2), call, image, message("text", "see above")]);
    expect(folded.map((m) => m.kind)).toEqual(["work", "image", "text"]);
    expect(folded[0]!.steps).toHaveLength(2);
    expect(folded[1]!.tool).toBe(call);
    // A run that held only the display call has nothing left and is gone.
    expect(foldWorkRows([call, image]).map((m) => m.kind)).toEqual(["image"]);
  });

  test("the display table is the one place a display tool is named", () => {
    expect(displayToolArtifactKind("omg_display_image")).toBe("image");
    expect(displayToolArtifactKind("mcp__omg__omg_display_video")).toBe("video");
    expect(displayToolArtifactKind("lfg_publish_artifact")).toBe("html");
    expect(displayToolArtifactKind("omg_display_file")).toBe("file");
    expect(displayToolArtifactKind("display_image")).toBeNull();
    expect(displayToolArtifactKind("Bash")).toBeNull();
    // A display call with no artifact after it is an ordinary step.
    const call = message("tool_use", "omg_display_file: notes.pdf");
    expect(kinds([call, message("text", "failed")])).toEqual(["work", "text"]);
    // An artifact of another kind does not take the call.
    expect(kinds([call, message("image", "")])).toEqual(["work", "image"]);
  });

  test("is idempotent, and joins two folded pages at their seam", () => {
    const older = foldWorkRows([message("text", "a"), ...toolRun(3)]);
    const newer = foldWorkRows([...toolRun(2), message("text", "b")]);
    expect(foldWorkRows(older)).toEqual(older);
    const joined = foldWorkRows([...older, ...newer]);
    expect(joined.map((m) => m.kind)).toEqual(["text", "work", "text"]);
    expect(joined[1]!.steps).toHaveLength(5);
    expect(joined[1]!.id).toBe(older[1]!.id);
  });

  test("a withdrawn row renders as nothing", () => {
    const withdrawn = { ...foldWorkRows(toolRun(1))[0]!, steps: [] };
    expect(foldWorkRows([message("text", "a"), withdrawn, message("text", "b")]).map((m) => m.kind)).toEqual([
      "text",
      "text",
    ]);
  });
});

describe("the live fold", () => {
  test("re-sends the open run under the same id as it grows, then the message that closes it", () => {
    const live = new LiveWorkRows<ChatRenderMessage>();
    const run = toolRun(3);
    const first = live.next(run[0]!);
    expect(first.map((m) => m.kind)).toEqual(["work"]);
    const second = live.next(run[1]!);
    expect(second).toHaveLength(1);
    expect(second[0]!.id).toBe(first[0]!.id);
    expect(steps(second[0])).toEqual([run[0]!.id, run[1]!.id]);
    const thought = message("thinking", "hmm");
    expect(steps(live.next(thought)[0])).toEqual([run[0]!.id, run[1]!.id, thought.id]);
    const text = message("text", "done");
    expect(live.next(text)).toEqual([text]);
    // The next run is a new row.
    expect(live.next(run[2]!)[0]!.id).toBe(run[2]!.id);
  });

  test("continues the run a snapshot ended with", () => {
    const live = new LiveWorkRows<ChatRenderMessage>();
    const snapshot = foldWorkRows([message("text", "a"), ...toolRun(2)]);
    live.seed(snapshot);
    const out = live.next(message("tool_use", "Read: x"));
    expect(out).toHaveLength(1);
    expect(out[0]!.id).toBe(snapshot[1]!.id);
    expect(out[0]!.steps).toHaveLength(3);
  });

  test("an artifact takes the display call back out of the run", () => {
    const live = new LiveWorkRows<ChatRenderMessage>();
    const bash = message("tool_use", "Bash: ls");
    const call = message("tool_use", "omg_display_image: shot.png");
    const image = message("image", "", "artifact-1");
    live.next(bash);
    expect(steps(live.next(call)[0])).toEqual([bash.id, call.id]);
    const out = live.next(image);
    expect(out.map((m) => m.kind)).toEqual(["work", "image"]);
    expect(steps(out[0])).toEqual([bash.id]);
    expect(out[1]!.tool).toBe(call);
  });

  test("withdraws a run that held only the display call", () => {
    const live = new LiveWorkRows<ChatRenderMessage>();
    const call = message("tool_use", "omg_display_file: a.pdf");
    const file = message("file", "", "artifact-2");
    const row = live.next(call)[0]!;
    const out = live.next(file);
    expect(out.map((m) => m.kind)).toEqual(["work", "file"]);
    expect(out[0]!.id).toBe(row.id);
    expect(out[0]!.steps).toEqual([]);
    expect(out[1]!.tool).toBe(call);
    // The run is closed: the next step opens a fresh row.
    expect(live.next(message("tool_use", "Bash: ls"))[0]!.steps).toHaveLength(1);
  });
});

describe("the rows a reader sees", () => {
  test("a work row is a tool group and an artifact with its call is one row", () => {
    const messages = [
      message("text", "start"),
      ...toolRun(4),
      message("tool_use", "omg_display_image: shot.png", "tool-x"),
      message("image", "", "artifact-x"),
      message("text", "end"),
    ];
    const items = buildChatRenderItems(foldWorkRows(messages));
    expect(items.map((item) => item.type)).toEqual(["msg", "tools", "artifact_tool", "msg"]);
    expect(items[1]!.type === "tools" && items[1]!.items).toHaveLength(4);
    expect(items[2]!.type === "artifact_tool" && items[2]!.tool.id).toBe("tool-x");
    // The raw list renders the same rows, so an unfolded page is not a regression.
    expect(buildChatRenderItems(messages).map((item) => item.type)).toEqual(items.map((item) => item.type));
  });

  test("the reported case: 88 tool-heavy messages render as one row", () => {
    const messages: ChatRenderMessage[] = [message("thinking", "opening")];
    for (let index = 0; index < 49; index += 1) {
      messages.push(message("tool_use", "Bash: run"));
      if (index < 37) messages.push(message("thinking", `t${index}`));
    }
    messages.push(message("thinking", "still streaming"));
    expect(messages).toHaveLength(88);
    const items = buildChatRenderItems(messages);
    expect(items.map((item) => item.type)).toEqual(["tools"]);
    expect(toolGroupLabel((items[0] as { items: ChatRenderMessage[] }).items)).toBe("39 thoughts · 49 Bash");
    expect(countTranscriptRows(messages)).toBe(1);
  });

  test("a run says how long it took, and counts up while it is live", () => {
    const run = [
      { ...message("thinking", "plan"), ts: 10_000 },
      { ...message("tool_use", "Bash: ls"), ts: 11_000 },
      { ...message("tool_result", "ok"), ts: 13_500 },
    ];
    expect(toolGroupWorkLabel(run, { live: false })).toBe("Worked for 4s");
    expect(toolGroupWorkLabel(run, { live: false, endTs: 22_000 })).toBe("Worked for 12s");
    expect(toolGroupWorkLabel(run, { live: true, now: 14_200 })).toBe("Working for 4s");
    expect(toolGroupWorkLabel(run, { live: true, now: 95_000 })).toBe("Working for 1m 25s");
    const untimed: ChatRenderMessage[] = [{ kind: "tool_use", text: "Bash: ls" }];
    expect(toolGroupWorkLabel(untimed, { live: false })).toBe("Worked");
    expect(toolGroupWorkLabel(untimed, { live: true })).toBe("Working…");
  });
});

describe("the row window", () => {
  test("keeps the whole list when it is inside the window", () => {
    expect(transcriptRowWindowStart([...toolRun(200), message("text", "done")], 10)).toBe(0);
  });

  test("cuts on a row boundary, never inside a run, folded or not", () => {
    const raw = [message("text", "one"), message("text", "two"), ...toolRun(5), message("text", "three")];
    const start = transcriptRowWindowStart(raw, 2);
    expect(start).toBe(2);
    expect(countTranscriptRows(raw.slice(start))).toBe(2);
    const folded = foldWorkRows(raw);
    expect(transcriptRowWindowStart(folded, 2)).toBe(2);
    expect(countTranscriptRows(folded.slice(2))).toBe(2);
  });

  test("a kept suffix renders exactly the rows asked for", () => {
    const messages: ChatRenderMessage[] = [];
    for (let index = 0; index < 30; index += 1) {
      messages.push(message("text", `turn ${index}`));
      messages.push(...toolRun(6));
    }
    const start = transcriptRowWindowStart(messages, 12);
    expect(countTranscriptRows(messages.slice(start))).toBe(12);
  });
});
