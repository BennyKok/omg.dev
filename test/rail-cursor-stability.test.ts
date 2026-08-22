import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const APP = readFileSync(new URL("../web/src/App.tsx", import.meta.url), "utf8");

/**
 * `railOrderedSessions` is built fresh on every render — it spreads three other
 * arrays — so a `useMemo` keyed on it never hit. `orderedSids` therefore got a
 * new identity every render, and the effect that keeps the keyboard cursor on a
 * live session ran every render to call `setCursor`.
 *
 * It settled only because React bails out when a state value is unchanged, so
 * it never showed up as a hang. That is the dangerous shape: one returned
 * object away from a real "Maximum update depth exceeded", and invisible until
 * it is one. An audit of this file flagged it while looking for exactly that.
 *
 * The fix is to key the memo on the joined ids, which change when the order
 * changes and not before.
 */
function railStageBody(): string {
  const start = APP.indexOf("function RailStage({");
  expect(start).toBeGreaterThan(-1);
  const end = APP.indexOf("\nfunction SessionGroups(", start);
  return APP.slice(start, end > start ? end : undefined);
}

describe("the rail's keyboard cursor does not churn", () => {
  test("orderedSids is memoized on the id string, not the array", () => {
    const body = railStageBody();
    expect(body).toContain("const orderedSidsKey = railOrderedSessions");
    expect(body).toContain("[orderedSidsKey],");
    // The exact regression: a memo over the freshly-built array.
    expect(body).not.toContain("}, [railOrderedSessions]);");
  });

  test("the cursor effect keys on the memoized value", () => {
    const body = railStageBody();
    expect(body).toMatch(/setCursor\(\(c\) =>[\s\S]{0,120}\}, \[orderedSids\]\);/);
  });

  // Same array, same key — that is the whole point of keying on the ids.
  test("the key is stable across renders that do not reorder", () => {
    const key = (sessions: { sessionId?: string | null }[]) =>
      sessions
        .map((session) => session.sessionId)
        .filter((id): id is string => !!id)
        .join(",");
    const a = [{ sessionId: "one" }, { sessionId: null }, { sessionId: "two" }];
    const b = [{ sessionId: "one" }, { sessionId: null }, { sessionId: "two" }];
    expect(key(a)).toBe(key(b));
    expect(key(a)).toBe("one,two");
    // ...and changes the moment the order does.
    expect(key([{ sessionId: "two" }, { sessionId: "one" }])).not.toBe(key(a));
  });

  test("an empty rail produces no phantom entry", () => {
    // "".split(",") is [""], which would put an empty id in the cursor list.
    expect(railStageBody()).toContain('orderedSidsKey ? orderedSidsKey.split(",") : []');
  });
});
