import { beforeEach, expect, test } from "bun:test";
import {
  getSubagentGroupChoices,
  isSubagentGroupOpen,
  resetSubagentGroupChoices,
  setSubagentGroupOpen,
  visibleTreeSessions,
} from "./subagent-group-open";

type Node = { session: string; children: Node[] };
const node = (session: string, children: Node[] = []): Node => ({ session, children });

beforeEach(() => resetSubagentGroupChoices());

test("a group is shut by default and open when one of its sessions is on the stage", () => {
  expect(isSubagentGroupOpen("p", ["c"], new Set())).toBe(false);
  expect(isSubagentGroupOpen("p", ["c"], new Set(["c"]))).toBe(true);
});

test("the reader's choice wins over the stage", () => {
  setSubagentGroupOpen("p", false);
  expect(isSubagentGroupOpen("p", ["c"], new Set(["c"]))).toBe(false);
  setSubagentGroupOpen("p", true);
  expect(isSubagentGroupOpen("p", ["c"], new Set())).toBe(true);
});

test("the snapshot keeps its identity when nothing changes", () => {
  setSubagentGroupOpen("p", true);
  const before = getSubagentGroupChoices();
  setSubagentGroupOpen("p", true);
  expect(getSubagentGroupChoices()).toBe(before);
});

test("keyboard order skips the subtree of a shut group and flattens an open one", () => {
  const roots = [node("a", [node("a1", [node("a1x")])]), node("b", [node("b1")]), node("c")];
  const order = visibleTreeSessions(roots, (root) => root.session === "a");
  expect(order).toEqual(["a", "a1", "a1x", "b", "c"]);
});
