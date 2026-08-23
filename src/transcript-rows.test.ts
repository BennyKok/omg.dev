import { describe, expect, test } from "bun:test";
import {
  buildChatRenderItems,
  chatRenderItemMessageCount,
  countTranscriptRows,
  toolGroupLabel,
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

  test("the thought that opens a run and the streaming tail stay their own rows", () => {
    const opening = [message("thinking", "first"), ...toolRun(3), message("thinking", "last")];
    // Opening thought, the tool run, and the still-streaming tail thought.
    expect(countTranscriptRows(opening)).toBe(3);
  });

  test("plain text turns are one row each", () => {
    const messages = [message("text", "hi"), message("text", "there"), message("text", "again")];
    expect(countTranscriptRows(messages)).toBe(3);
  });

  test("the reported case: 88 tool-heavy messages render as three rows", () => {
    const messages: ChatRenderMessage[] = [message("thinking", "opening")];
    for (let index = 0; index < 49; index += 1) {
      messages.push(message("tool_use", "Bash: run"));
      if (index < 37) messages.push(message("thinking", `t${index}`));
    }
    messages.push(message("thinking", "still streaming"));
    expect(messages).toHaveLength(88);
    const items = buildChatRenderItems(messages);
    expect(items.map((item) => item.type)).toEqual(["msg", "tools", "msg"]);
    expect(toolGroupLabel((items[1] as { items: ChatRenderMessage[] }).items)).toBe(
      "37 thoughts · 49 Bash",
    );
    expect(countTranscriptRows(messages)).toBe(3);
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
