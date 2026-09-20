import { describe, expect, test } from "bun:test";
import { appendTranscriptDraft, buildTranscriptItems, TranscriptWindow, INITIAL_TRANSCRIPT_ITEMS } from "../mobile/src/omg/transcript-items";
import type { Entry } from "../mobile/src/omg/transcript";

const reply = (id: string): Entry => ({ id, role: "assistant", text: `Reply ${id}`, ts: 1_000 });
const work = (id: string): Entry => ({ id, role: "assistant", kind: "work", ts: 2_000, text: "", steps: [
  { id: `${id}-call`, role: "assistant", kind: "tool_use", text: "Read: {}" },
  { id: `${id}-result`, role: "assistant", kind: "tool_result", text: "done" },
] });
const interrupted: Entry = { id: "interrupt", role: "user", text: "[Request interrupted by user]" };

describe("incremental transcript drafts", () => {
  for (const messages of [[], [reply("a")], [work("w")], [reply("a"), work("w"), work("w2")],
    [work("w"), interrupted], [work("w"), interrupted, { ...work("empty"), steps: [] }],
    [{ ...work("empty"), steps: [] }]]) {
    for (const busy of [true, false]) for (const text of ["", "hello"]) for (const thought of ["", "thinking"]) {
      test(`matches full grouping: ${messages.map(m => m.id)} busy=${busy} text=${!!text} thought=${!!thought}`, () => {
        const entries = [...messages];
        if (thought) entries.push({ id: "__thinking__", role: "assistant", kind: "work", text: "", steps: [
          { id: "__thinking_step__", role: "assistant", kind: "thinking", text: thought },
        ] });
        if (text) entries.push({ id: "__streaming__", role: "assistant", text, streaming: true });
        expect(appendTranscriptDraft(buildTranscriptItems(messages, { busy }), messages, text, thought, busy))
          .toEqual(buildTranscriptItems(entries, { busy }));
      });
    }
  }
  test("tokens keep completed rows and tool pairs by identity", () => {
    const messages = [...Array.from({ length: 1000 }, (_, i) => reply(String(i))), work("tail")];
    const settled = buildTranscriptItems(messages, { busy: true });
    const first = appendTranscriptDraft(settled, messages, "", "one", true);
    const next = appendTranscriptDraft(settled, messages, "", "two", true);
    for (let i = 0; i < settled.length - 1; i++) expect(next[i]).toBe(first[i]);
    const tail = next.at(-1)!;
    expect(tail.type).toBe("tools");
    if (tail.type === "tools" && settled.at(-1)?.type === "tools")
      expect(tail.pairs).toBe((settled.at(-1) as typeof tail).pairs);
  });
});

test("opening renders only the recent window; growth does not discard its first row", () => {
  const window = new TranscriptWindow();
  const messages = Array.from({ length: 40 }, (_, i) => reply(String(i)));
  const items = buildTranscriptItems(messages);
  expect(window.view([], false).items).toEqual([]);
  const first = window.view(items, false);
  expect(first.items).toHaveLength(INITIAL_TRANSCRIPT_ITEMS);
  expect(first.hasEarlier).toBe(true);
  const next = window.view(buildTranscriptItems([...messages, reply("new")]), false);
  expect(next.items[0].key).toBe(first.items[0].key);
  expect(next.items.at(-1)?.key).toBe("new");
  const expanded = window.view(items, true);
  expect(expanded.items).toBe(items);
  expect(expanded.hasEarlier).toBe(false);
});

test("a refreshed page that no longer contains the opening anchor stays bounded", () => {
  const window = new TranscriptWindow();
  window.view(buildTranscriptItems(Array.from({ length: 40 }, (_, i) => reply(String(i)))), false);
  const refreshed = window.view(buildTranscriptItems(Array.from({ length: 40 }, (_, i) => reply(String(i + 100)))), false);
  expect(refreshed.items.length).toBe(INITIAL_TRANSCRIPT_ITEMS);
  expect(refreshed.items.at(-1)?.key).toBe("139");
});
