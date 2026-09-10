import { describe, expect, test } from "bun:test";
import {
  buildChatRenderItems,
  chatRenderItemMessageCount,
  countTranscriptRows,
  toolGroupLabel,
  toolGroupWorkLabel,
  transcriptRowWindowStart,
  type ChatRenderMessage,
} from "./transcript-rows.ts";

// The rule the server pages by and the client renders by. There is one copy of
// it, so these tests cover both sides.

function message(kind: string, text = "", id?: string): ChatRenderMessage {
  return { id: id ?? `${kind}-${text}-${Math.random()}`, kind, text, ts: 1 };
}

function toolRun(count: number, name = "Bash"): ChatRenderMessage[] {
  return Array.from({ length: count }, (_, index) => message("tool_use", `${name}: step ${index}`));
}

describe("the transcript row rule", () => {
  test("a run of tool calls is one row", () => {
    expect(countTranscriptRows(toolRun(49))).toBe(1);
  });

  test("tool_result folds into the run that produced it", () => {
    const messages = [message("tool_use", "Bash: ls"), message("tool_result", "a b c")];
    expect(countTranscriptRows(messages)).toBe(1);
  });

  test("thinking between tool calls folds into the same row", () => {
    const messages = [
      ...toolRun(2),
      message("thinking", "consider"),
      ...toolRun(2),
      message("text", "done"),
    ];
    expect(countTranscriptRows(messages)).toBe(2);
  });

  test("the thought that opens a run folds into it; the streaming tail stays its own row", () => {
    const opening = [message("thinking", "first"), ...toolRun(3), message("thinking", "last")];
    const items = buildChatRenderItems(opening);
    expect(items.map((item) => item.type)).toEqual(["tools", "msg"]);
    expect(items[0]!.type === "tools" && items[0]!.items[0]!.text).toBe("first");
    expect(items[0]!.type === "tools" && items[0]!.items.length).toBe(1 + toolRun(3).length);
  });

  test("a thought with no run after it is its own row", () => {
    const items = buildChatRenderItems([
      message("thinking", "alone"),
      message("text", "the answer"),
    ]);
    expect(items.map((item) => item.type)).toEqual(["msg", "msg"]);
  });

  test("plain text turns are one row each", () => {
    const messages = [message("text", "hi"), message("text", "there"), message("text", "again")];
    expect(countTranscriptRows(messages)).toBe(3);
  });

  test("the reported case: 88 tool-heavy messages render as two rows", () => {
    const messages: ChatRenderMessage[] = [message("thinking", "opening")];
    for (let index = 0; index < 49; index += 1) {
      messages.push(message("tool_use", "Bash: run"));
      if (index < 37) messages.push(message("thinking", `t${index}`));
    }
    messages.push(message("thinking", "still streaming"));
    expect(messages).toHaveLength(88);
    const items = buildChatRenderItems(messages);
    expect(items.map((item) => item.type)).toEqual(["tools", "msg"]);
    expect(toolGroupLabel((items[0] as { items: ChatRenderMessage[] }).items)).toBe(
      "38 thoughts · 49 Bash",
    );
    expect(countTranscriptRows(messages)).toBe(2);
  });

  test("a run says how long it took, and counts up while it is live", () => {
    const run = [
      { ...message("thinking", "plan"), ts: 10_000 },
      { ...message("tool_use", "Bash: ls"), ts: 11_000 },
      { ...message("tool_result", "ok"), ts: 13_500 },
    ];
    expect(toolGroupWorkLabel(run, { live: false })).toBe("Worked for 4s");
    // The next message marks the real end of a finished run.
    expect(toolGroupWorkLabel(run, { live: false, endTs: 22_000 })).toBe("Worked for 12s");
    expect(toolGroupWorkLabel(run, { live: true, now: 14_200 })).toBe("Working for 4s");
    expect(toolGroupWorkLabel(run, { live: true, now: 95_000 })).toBe("Working for 1m 25s");
    // No timestamps at all: say the state, not a number.
    const untimed: ChatRenderMessage[] = [{ kind: "tool_use", text: "Bash: ls" }];
    expect(toolGroupWorkLabel(untimed, { live: false })).toBe("Worked");
    expect(toolGroupWorkLabel(untimed, { live: true })).toBe("Working…");
  });

  test("an artifact pairs with its display tool as a single row", () => {
    const messages = [
      message("tool_use", "omg_display_image: shot.png", "tool-1"),
      message("image", "", "artifact-1"),
    ];
    const items = buildChatRenderItems(messages);
    expect(items).toHaveLength(1);
    expect(items[0]!.type).toBe("artifact_tool");
    expect(countTranscriptRows(messages)).toBe(1);
  });

  test("every message belongs to exactly one row", () => {
    const messages = [
      message("text", "start"),
      ...toolRun(4),
      message("thinking", "mid"),
      ...toolRun(2),
      message("tool_use", "omg_display_image: shot.png", "tool-x"),
      message("image", "", "artifact-x"),
      message("text", "end"),
    ];
    const counted = buildChatRenderItems(messages).reduce(
      (sum, item) => sum + chatRenderItemMessageCount(item),
      0,
    );
    expect(counted).toBe(messages.length);
  });
});

describe("the row window", () => {
  test("keeps the whole list when it is inside the window", () => {
    const messages = [...toolRun(200), message("text", "done")];
    expect(transcriptRowWindowStart(messages, 10)).toBe(0);
  });

  test("cuts on a row boundary, never inside a folded run", () => {
    const messages = [
      message("text", "one"),
      message("text", "two"),
      ...toolRun(5),
      message("text", "three"),
    ];
    // Last two rows are the tool run and the closing text.
    const start = transcriptRowWindowStart(messages, 2);
    expect(start).toBe(2);
    expect(countTranscriptRows(messages.slice(start))).toBe(2);
  });

  test("a kept suffix never renders fewer rows than asked for", () => {
    const messages: ChatRenderMessage[] = [];
    for (let index = 0; index < 30; index += 1) {
      messages.push(message("text", `turn ${index}`));
      messages.push(...toolRun(6));
    }
    const start = transcriptRowWindowStart(messages, 12);
    expect(countTranscriptRows(messages.slice(start))).toBeGreaterThanOrEqual(12);
  });
});
