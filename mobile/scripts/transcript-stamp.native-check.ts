import { expect, test } from "bun:test";
import { buildTranscriptItems } from "../src/omg/transcript-items";
import type { Entry } from "../src/omg/transcript";

/**
 * THE OPENING ROW MUST NOT GAIN A TIME WHEN IT SETTLES.
 *
 * `/session/new` mounts the real chat screen and shows the typed prompt as its
 * first row before the machine has minted a session. That optimistic row used
 * to be built with no `ts`, and `stamp()` below skips any row without one, so
 * the pending conversation drew no time at all. The settled row then arrived
 * carrying a `ts`, a stamp appeared above it, and the whole transcript shifted
 * down by a line at the exact moment the reader was looking at it.
 *
 * Benny reported this as the pending screen "not fully matching the layout".
 * The fix is one field on the optimistic entry; this is the check that keeps
 * it, because nothing about the type system requires `ts` to be set.
 */

const user = (text: string, ts?: number): Entry =>
  ({ id: `m-${text}-${ts ?? "none"}`, role: "user", text, ...(ts ? { ts } : {}) }) as Entry;

test("a row with no time draws no stamp, which is why the optimistic row needs one", () => {
  const items = buildTranscriptItems([user("Instant opening check")]);
  expect(items.filter((item) => item.type === "stamp")).toHaveLength(0);
});

test("the optimistic opener carries a time, so the first row is stamped at once", () => {
  const now = Date.UTC(2026, 8, 21, 18, 39);
  const items = buildTranscriptItems([user("Instant opening check", now)]);
  const stamps = items.filter((item) => item.type === "stamp");
  expect(stamps).toHaveLength(1);
  expect((stamps[0] as { ts: number }).ts).toBe(now);
});

test("the settled row does not add a second stamp above the same message", () => {
  // What actually happens on the wire: the local row is replaced by the box's
  // own copy, whose `ts` is within a second or two. One stamp, before and
  // after, so nothing moves.
  const local = Date.UTC(2026, 8, 21, 18, 39);
  const settled = local + 1200;
  const before = buildTranscriptItems([user("Instant opening check", local)]);
  const after = buildTranscriptItems([
    user("Instant opening check", settled),
    { id: "a1", role: "assistant", text: "Your new conversation is ready.", ts: settled + 500 } as Entry,
  ]);
  const count = (items: ReturnType<typeof buildTranscriptItems>) =>
    items.filter((item) => item.type === "stamp").length;
  expect(count(before)).toBe(1);
  expect(count(after)).toBe(1);
});
