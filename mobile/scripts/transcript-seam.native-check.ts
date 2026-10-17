import { expect, test } from "bun:test";
import { appendTranscriptDraft, buildTranscriptItems } from "../src/omg/transcript-items";
import type { Entry } from "../src/omg/transcript";

/**
 * OLDER ROWS ARRIVING MUST NOT TAKE AWAY A ROW THE READER CAN SEE.
 *
 * iOS anchors the reading position to the first row whose top is on screen.
 * At the top of a loaded page that row is the page's first stamp, or a run of
 * tool calls the page seam cut in half. See `shown` in transcript-items.ts.
 */

const MIN = 60_000;
const T = Date.UTC(2026, 9, 16, 14, 0);
const text = (id: string, at: number, role = "assistant"): Entry =>
  ({ id, role, kind: "text", text: id, ts: T + at * MIN }) as Entry;
const work = (id: string, at: number): Entry =>
  ({ id, role: "assistant", kind: "work", text: "", ts: T + at * MIN,
    steps: [{ id: `${id}-step`, role: "assistant", kind: "tool_use", text: "Bash: {}", ts: T + at * MIN }] }) as Entry;

const keys = (items: ReturnType<typeof buildTranscriptItems>) => items.map((item) => item.key);

function drawn(messages: Entry[]) {
  const shown = new Set<string>();
  for (const key of keys(buildTranscriptItems(messages, { shown }))) shown.add(key);
  return shown;
}

test("without memory, a page landing within 15 minutes removes the page's first stamp", () => {
  const page = [text("m10", 10), text("m11", 11)];
  const older = [text("m5", 5), text("m6", 6)];
  expect(keys(buildTranscriptItems(page))).toContain("stamp-m10");
  expect(keys(buildTranscriptItems([...older, ...page]))).not.toContain("stamp-m10");
});

test("with memory, every row the page drew is still there after the older page lands", () => {
  const page = [text("m10", 10), text("m11", 11)];
  const shown = drawn(page);
  const after = keys(buildTranscriptItems([text("m5", 5), text("m6", 6), ...page], { shown }));
  for (const key of shown) expect(after).toContain(key);
  // The new first row gets its own stamp; the kept one stays above m10.
  expect(after).toEqual(["stamp-m5", "m5", "m6", "stamp-m10", "m10", "m11"]);
});

test("a run cut by the page seam keeps the key it was drawn with", () => {
  const page = [work("w20", 20), text("m21", 21)];
  const shown = drawn(page);
  expect(shown.has("tools-w20")).toBe(true);
  const after = buildTranscriptItems([text("m18", 18), work("w19", 19), ...page], { shown });
  const runs = after.filter((item) => item.type === "tools");
  expect(runs).toHaveLength(1);
  expect(runs[0].key).toBe("tools-w20");
  expect(runs[0].type === "tools" && runs[0].entries.map((e) => e.id)).toEqual(["w19-step", "w20-step"]);
});

test("a thinking draft still joins the last run when that run kept a newer key", () => {
  // The live tail: a run drawn as tools-w31. A page seam then puts w30 in
  // front of it, so the joined run is keyed tools-w31, not tools-w30.
  const shown = drawn([text("m29", 29), work("w31", 31)]);
  const tail = [text("m29", 29), work("w30", 30), work("w31", 31)];
  const items = buildTranscriptItems(tail, { shown, busy: true });
  expect(items.at(-1)?.key).toBe("tools-w31");
  const withDraft = appendTranscriptDraft(items, tail, "", "thinking about it", true);
  expect(withDraft.filter((item) => item.type === "tools")).toHaveLength(1);
  expect(withDraft.at(-1)?.key).toBe("tools-w31");
});
