// Folding several Claude accounts into one fleet reading.
//
// The whole point of the merged ring is to answer "how much have I got left
// across every account" without doing arithmetic in your head. Every case here
// is a way that number could lie, and lying LOW (reading as more headroom than
// you have) is the direction that actually costs you: you start a session
// believing there's room and it dies mid-run.

import { expect, test } from "bun:test";
import {
  matchUsageProvider,
  matchUsageProviders,
  mergeProviderUsage,
  type ProviderUsage,
  type UsageProviderRef,
} from "./usage.ts";

const BASE = { id: "claude:all", kind: "claude", label: "Claude" };

const account = (
  id: string,
  windows: { label: string; pct: number | null; resetsAt?: number | null }[],
  extra: Partial<ProviderUsage> = {},
): ProviderUsage => ({
  id,
  kind: "claude",
  label: id,
  available: true,
  windows: windows.map((w) => ({ label: w.label, pct: w.pct, resetsAt: w.resetsAt ?? null })),
  ...extra,
});

test("two accounts fold to the share of the combined pool that is spent", () => {
  // Both accounts half spent = half of everything you own is spent. Adding the
  // percentages would say 100% — i.e. "you're out" — which is exactly wrong.
  const merged = mergeProviderUsage(
    [account("a", [{ label: "5 hr", pct: 50 }]), account("b", [{ label: "5 hr", pct: 50 }])],
    BASE,
  );
  expect(merged.windows).toEqual([{ label: "5 hr", pct: 50, resetsAt: null }]);
});

test("one exhausted account and one untouched reads as half the fleet", () => {
  const merged = mergeProviderUsage(
    [account("a", [{ label: "5 hr", pct: 100 }]), account("b", [{ label: "5 hr", pct: 0 }])],
    BASE,
  );
  expect(merged.windows?.[0]?.pct).toBe(50);
});

test("windows are matched by label, never by position", () => {
  // The second account reports its windows in the opposite order. Folding by
  // index would average the 5 hr figure against the 7 day one.
  const merged = mergeProviderUsage(
    [
      account("a", [
        { label: "5 hr", pct: 80 },
        { label: "7 day", pct: 20 },
      ]),
      account("b", [
        { label: "7 day", pct: 40 },
        { label: "5 hr", pct: 20 },
      ]),
    ],
    BASE,
  );
  const byLabel = Object.fromEntries((merged.windows ?? []).map((w) => [w.label, w.pct]));
  expect(byLabel).toEqual({ "5 hr": 50, "7 day": 30 });
});

test("an unreadable account is left out of the average, not counted as free", () => {
  // A signed-out account has no windows. Treating it as 0% would report 40%
  // used when the only account that can actually run anything is at 80%.
  const merged = mergeProviderUsage(
    [
      account("a", [{ label: "5 hr", pct: 80 }]),
      { ...account("b", []), available: false, note: "Sign-in expired — reconnect" },
    ],
    BASE,
  );
  expect(merged.windows?.[0]?.pct).toBe(80);
  expect(merged.available).toBe(true);
  // ...and the total says it isn't speaking for everything.
  expect(merged.note).toBe("1 of 2 accounts reporting");
});

test("a window no account could measure stays null rather than becoming 0", () => {
  const merged = mergeProviderUsage(
    [
      account("a", [
        { label: "5 hr", pct: 60 },
        { label: "7 day", pct: null },
      ]),
      account("b", [
        { label: "5 hr", pct: 40 },
        { label: "7 day", pct: null },
      ]),
    ],
    BASE,
  );
  const byLabel = Object.fromEntries((merged.windows ?? []).map((w) => [w.label, w.pct]));
  expect(byLabel).toEqual({ "5 hr": 50, "7 day": null });
});

test("a window only one account reports averages over that one account", () => {
  const merged = mergeProviderUsage(
    [
      account("a", [
        { label: "5 hr", pct: 60 },
        { label: "7 day", pct: 90 },
      ]),
      account("b", [{ label: "5 hr", pct: 20 }]),
    ],
    BASE,
  );
  const byLabel = Object.fromEntries((merged.windows ?? []).map((w) => [w.label, w.pct]));
  expect(byLabel).toEqual({ "5 hr": 40, "7 day": 90 });
});

test("the fleet resets when its soonest window resets", () => {
  // Averaging two clock times would name a moment when nothing happens.
  const merged = mergeProviderUsage(
    [
      account("a", [{ label: "5 hr", pct: 10, resetsAt: 3_000 }]),
      account("b", [{ label: "5 hr", pct: 10, resetsAt: 1_000 }]),
    ],
    BASE,
  );
  expect(merged.windows?.[0]?.resetsAt).toBe(1_000);
});

test("an over-100 reading is clamped per account before folding", () => {
  // Claude's utilization is passed through raw, so 120 is possible. Unclamped
  // it would drag the pair to 60% when one account is simply maxed.
  const merged = mergeProviderUsage(
    [account("a", [{ label: "5 hr", pct: 120 }]), account("b", [{ label: "5 hr", pct: 0 }])],
    BASE,
  );
  expect(merged.windows?.[0]?.pct).toBe(50);
});

test("no account reporting yields an unavailable total carrying the reason", () => {
  const merged = mergeProviderUsage(
    [
      { ...account("a", []), available: false, note: "Not signed in on this box" },
      { ...account("b", []), available: false, note: "Sign-in expired — reconnect" },
    ],
    BASE,
  );
  expect(merged.available).toBe(false);
  expect(merged.note).toBe("Not signed in on this box");
  expect(merged.windows).toBeUndefined();
});

test("accounts still in flight don't count as reporting", () => {
  const merged = mergeProviderUsage([null, account("b", [{ label: "5 hr", pct: 30 }])], BASE);
  expect(merged.windows?.[0]?.pct).toBe(30);
  expect(merged.note).toBe("1 of 2 accounts reporting");
});

test("a complete fold carries no caveat note", () => {
  const merged = mergeProviderUsage(
    [account("a", [{ label: "5 hr", pct: 10 }]), account("b", [{ label: "5 hr", pct: 30 }])],
    BASE,
  );
  expect(merged.note).toBeUndefined();
  expect(merged.id).toBe("claude:all");
  expect(merged.accountId).toBeUndefined();
});

const REFS: UsageProviderRef[] = [
  { id: "claude:a", kind: "claude", label: "Claude 1", accountId: "a" },
  { id: "claude:b", kind: "claude", label: "Claude 2", accountId: "b" },
  { id: "codex", kind: "codex", label: "Codex" },
];

test("a pinned composer account matches only its own usage source", () => {
  expect(matchUsageProviders(REFS, "aisdk", "b", true).map((ref) => ref.id)).toEqual([
    "claude:b",
  ]);
});

test("a combined composer account matches every source in its provider family", () => {
  expect(matchUsageProviders(REFS, "aisdk", null, true).map((ref) => ref.id)).toEqual([
    "claude:a",
    "claude:b",
  ]);
});

test("the historical single-source matcher still returns the first family source", () => {
  expect(matchUsageProvider(REFS, "aisdk", null)?.id).toBe("claude:a");
});
