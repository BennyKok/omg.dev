/**
 * The ring folds logins. The drawer must still be able to name each one.
 */
import { expect, mock, test } from "bun:test";
import { resolve } from "node:path";

mock.module("react", () => ({
  useCallback: (fn: unknown) => fn,
  useEffect: () => {},
  useState: (value: unknown) => [value, () => {}],
}));
mock.module(resolve(import.meta.dir, "../src/omg/provider.tsx"), () => ({ useOmg: () => ({ client: null }) }));

const { detailsForKind, mergeByKind } = await import("../src/omg/usage");
type ProviderUsage = Parameters<typeof detailsForKind>[1][number];

const window = (label: string, pct: number) => ({
  label,
  pct,
  resetsAt: null,
});

const account = (id: string, pct: number, extra: Partial<ProviderUsage> = {}): ProviderUsage => ({
  id,
  kind: "claude",
  label: id,
  available: true,
  windows: [window("5 hr", pct), window("7 day", pct / 2)],
  ...extra,
});

test("two Claude logins stay separate in the drawer and fold in the ring", () => {
  const accounts = [
    account("claude:one", 80, { label: "Claude 1", accountLabel: "Claude 1" }),
    account("claude:two", 20, { label: "Claude 2", accountLabel: "Claude 2" }),
  ];
  const merged = mergeByKind(accounts);
  expect(merged).toHaveLength(1);
  expect(merged[0]?.windows?.[0]?.pct).toBe(50);

  const details = detailsForKind("claude", accounts, merged);
  expect(details.map((row) => row.accountLabel || row.label)).toEqual(["Claude 1", "Claude 2"]);
  expect(details.map((row) => row.windows?.[0]?.pct)).toEqual([80, 20]);
});

test("a family-only summary still fills the drawer", () => {
  const merged = mergeByKind([account("claude:one", 40)]);
  expect(detailsForKind("claude", [], merged)).toEqual(merged);
});

test("a different agent does not inherit Claude's logins", () => {
  const accounts = [account("claude:one", 40)];
  expect(detailsForKind("codex", accounts, mergeByKind(accounts))).toEqual([]);
});
