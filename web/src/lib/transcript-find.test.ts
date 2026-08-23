// Mapping a transcript search hit onto a virtualized row.
//
// The find bar exists because virtualization keeps only ~45 of ~1282 rows in
// the DOM, so the browser's own Ctrl+F reaches almost none of the transcript.
// The server answers with MESSAGE ids; the virtualizer scrolls to ROW indexes.
// Those two are not the same numbering, and every case where they diverge is
// a way for a hit to silently go nowhere. That is what these pin down.

import { describe, expect, test } from "bun:test";
import { buildChatRenderItems, splitQueuedRenderItems } from "./chat-render-items";
import { messagesForTranscriptView } from "./transcript-view";
import {
  buildFindRowIndex,
  findHitRowIndex,
  findMatchRanges,
  stepFindHit,
  transcriptFindTerms,
} from "./transcript-find";
import { rangesForOffsets } from "./find-highlight";

type Msg = {
  id?: string | null;
  role?: string;
  kind?: string;
  text?: string;
  ts?: number | null;
  pending?: boolean;
  queued?: boolean;
};

function text(id: string, body = "hello"): Msg {
  return { id, role: "assistant", kind: "text", text: body, ts: 1 };
}

function tool(id: string, name = "Bash"): Msg {
  return { id, role: "assistant", kind: "tool_use", text: name, ts: 1 };
}

function result(id: string): Msg {
  return { id, role: "assistant", kind: "tool_result", text: "ok", ts: 1 };
}

function rows(messages: Msg[]) {
  return buildChatRenderItems(messages);
}

describe("hit to row index", () => {
  test("a plain message resolves to its own row", () => {
    const index = buildFindRowIndex(rows([text("a"), text("b"), text("c")]));
    expect(findHitRowIndex(index, { messageId: "b" })).toEqual({ status: "row", index: 1 });
  });

  test("every member of a collapsed tool run resolves to the one pill", () => {
    // This is the case a naive `indexByKey.get(id)` gets wrong: the row's key
    // is only the FIRST member's id, so a hit on any later tool call in the
    // run would look unloaded and the find bar would page the whole transcript
    // chasing a message that is already on screen.
    const items = rows([
      text("intro"),
      tool("t1"),
      result("r1"),
      tool("t2"),
      result("r2"),
      text("answer"),
    ]);
    // One text row, one collapsed tool row, one text row.
    expect(items).toHaveLength(3);
    expect(items[1].type).toBe("tools");

    const index = buildFindRowIndex(items);
    for (const id of ["t1", "r1", "t2", "r2"]) {
      expect(findHitRowIndex(index, { messageId: id })).toEqual({ status: "row", index: 1 });
    }
    expect(findHitRowIndex(index, { messageId: "answer" })).toEqual({ status: "row", index: 2 });
  });

  test("thinking folded into a run resolves to the run's pill", () => {
    const items = rows([
      tool("t1"),
      { id: "think", role: "assistant", kind: "thinking", text: "pondering", ts: 1 },
      tool("t2"),
      text("answer"),
    ]);
    const index = buildFindRowIndex(items);
    expect(findHitRowIndex(index, { messageId: "think" })).toEqual({
      status: "row",
      index: 0,
    });
  });

  test("both halves of an artifact pairing resolve to the paired row", () => {
    const items = rows([
      text("intro"),
      tool("call", "omg_display_image"),
      { id: "art", role: "assistant", kind: "image", text: "a chart", ts: 1 },
    ]);
    expect(items[1].type).toBe("artifact_tool");
    const index = buildFindRowIndex(items);
    // The tool call carries the prompt text, the artifact carries the caption.
    expect(findHitRowIndex(index, { messageId: "call" })).toEqual({ status: "row", index: 1 });
    expect(findHitRowIndex(index, { messageId: "art" })).toEqual({ status: "row", index: 1 });
  });

  test("the focused view's derived id still answers to the server's raw id", () => {
    // messagesForTranscriptView republishes an omg_output tool call as a plain
    // assistant message under `${id}:display`. The server only ever knows the
    // raw id, so without the alias every hit in the focused view is unloaded.
    const raw: Msg[] = [
      { id: "u1", role: "user", kind: "text", text: "do it", ts: 1 },
      {
        id: "o1",
        role: "assistant",
        kind: "tool_use",
        text: 'lfg_output: {"text":"the deploy finished"}',
        ts: 2,
      },
    ];
    const projected = messagesForTranscriptView(raw, "user-lfg-output");
    expect(projected.map((message) => message.id)).toEqual(["u1", "o1:display"]);

    const index = buildFindRowIndex(rows(projected));
    expect(findHitRowIndex(index, { messageId: "o1" })).toEqual({ status: "row", index: 1 });
    expect(findHitRowIndex(index, { messageId: "o1:display" })).toEqual({
      status: "row",
      index: 1,
    });
  });

  test("a hit in a message that has not been paged in reports unloaded", () => {
    // The transcript pages backwards from the tail, so an older hit genuinely
    // has no row. The find bar has to be told this rather than being handed a
    // wrong index or a silent no-op.
    const index = buildFindRowIndex(rows([text("recent-1"), text("recent-2")]));
    expect(findHitRowIndex(index, { messageId: "ancient" })).toEqual({ status: "unloaded" });
  });

  test("the same hit resolves once its page is prepended", () => {
    const loaded = rows([text("recent-1"), text("recent-2")]);
    expect(findHitRowIndex(buildFindRowIndex(loaded), { messageId: "old" })).toEqual({
      status: "unloaded",
    });
    const afterPage = rows([text("old"), text("recent-1"), text("recent-2")]);
    expect(findHitRowIndex(buildFindRowIndex(afterPage), { messageId: "old" })).toEqual({
      status: "row",
      index: 0,
    });
    // And the rows the reader was already looking at moved down by exactly the
    // prepended page, which is what the anchor restore has to absorb.
    expect(findHitRowIndex(buildFindRowIndex(afterPage), { messageId: "recent-1" })).toEqual({
      status: "row",
      index: 1,
    });
  });

  test("a queued turn is pinned outside the virtual list and has no row", () => {
    const { items, queued } = splitQueuedRenderItems(
      rows([
        text("a"),
        { id: "q", role: "user", kind: "text", text: "later", ts: 3, pending: true, queued: true },
      ]),
    );
    expect(queued).toHaveLength(1);
    // buildFindRowIndex is fed the virtualized `items` only, so the pinned
    // queued bubble must not claim a row index that belongs to something else.
    expect(findHitRowIndex(buildFindRowIndex(items), { messageId: "q" })).toEqual({
      status: "unloaded",
    });
  });

  test("a message with no id cannot be jumped to and claims no row", () => {
    const index = buildFindRowIndex(rows([{ role: "assistant", kind: "text", text: "x", ts: 1 }]));
    expect(index.size).toBe(0);
  });

  test("the first row wins when an id appears twice", () => {
    const index = buildFindRowIndex(rows([text("dup"), text("dup")]));
    expect(findHitRowIndex(index, { messageId: "dup" })).toEqual({ status: "row", index: 0 });
  });
});

describe("stepping through hits", () => {
  test("wraps at both ends", () => {
    expect(stepFindHit(3, 2, 1)).toBe(0);
    expect(stepFindHit(3, 0, -1)).toBe(2);
    expect(stepFindHit(3, 1, 1)).toBe(2);
  });

  test("an empty hit list never produces an index to read", () => {
    expect(stepFindHit(0, 0, 1)).toBe(0);
    expect(stepFindHit(0, 0, -1)).toBe(0);
  });
});

describe("terms match what the server matched", () => {
  test("splits on whitespace, strips quotes and caps at twelve terms", () => {
    expect(transcriptFindTerms('  "deploy"  pipeline ')).toEqual(["deploy", "pipeline"]);
    expect(transcriptFindTerms(Array.from({ length: 20 }, (_, i) => `t${i}`).join(" "))).toHaveLength(12);
    expect(transcriptFindTerms("   ")).toEqual([]);
  });
});

describe("match ranges for the highlight", () => {
  test("finds every occurrence, case-insensitively", () => {
    expect(findMatchRanges("Deploy the deploy", ["deploy"])).toEqual([
      [0, 6],
      [11, 17],
    ]);
  });

  test("merges overlapping terms so the highlight never doubles up", () => {
    expect(findMatchRanges("debugging", ["debug", "bug"])).toEqual([[0, 5]]);
  });

  test("returns nothing for an empty query or empty text", () => {
    expect(findMatchRanges("anything", [])).toEqual([]);
    expect(findMatchRanges("", ["x"])).toEqual([]);
  });

  test("does not treat LIKE wildcards as operators, matching the server", () => {
    expect(findMatchRanges("cpu hit 100% during", ["100%"])).toEqual([[8, 12]]);
    expect(findMatchRanges("cpu was fine", ["%"])).toEqual([]);
  });
});

describe("flat offsets map back to the right text nodes", () => {
  // A markdown row is many text nodes. Concatenating them first is what lets a
  // term match across an inline boundary, and this is the step that turns a
  // flat offset back into a (node, offset) pair. No browser needed.
  type FakeRange = { start?: [unknown, number]; end?: [unknown, number] };
  const factory = () => {
    const range: FakeRange = {};
    return {
      setStart: (node: unknown, offset: number) => {
        range.start = [node, offset];
      },
      setEnd: (node: unknown, offset: number) => {
        range.end = [node, offset];
      },
      captured: range,
    } as unknown as Range & { captured: FakeRange };
  };

  const segments = [
    { node: "n0", start: 0, end: 4 }, // "the "
    { node: "n1", start: 4, end: 10 }, // "deploy"
    { node: "n2", start: 10, end: 17 }, // " failed"
  ] as unknown as Array<{ node: Node; start: number; end: number }>;

  test("a range inside one node stays in that node", () => {
    const made: Array<Range & { captured: FakeRange }> = [];
    const ranges = rangesForOffsets(segments, [[4, 10]], () => {
      const r = factory();
      made.push(r);
      return r;
    });
    expect(ranges).toHaveLength(1);
    expect(made[0].captured).toEqual({ start: ["n1", 0], end: ["n1", 6] });
  });

  test("a range spanning an inline boundary gets different start and end nodes", () => {
    // "deploy failed" as one match, split across <code>deploy</code> and text.
    const made: Array<Range & { captured: FakeRange }> = [];
    rangesForOffsets(segments, [[4, 17]], () => {
      const r = factory();
      made.push(r);
      return r;
    });
    expect(made[0].captured).toEqual({ start: ["n1", 0], end: ["n2", 7] });
  });

  test("an offset past the end of the text produces no range rather than throwing", () => {
    expect(rangesForOffsets(segments, [[40, 44]], factory)).toHaveLength(0);
  });
});
