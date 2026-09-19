/**
 * The forest builder, checked on the two things a large fleet makes expensive:
 * roots must stay unique, and building them must stay linear in the roster.
 */
import { expect, test } from "bun:test";
import { buildSessionTree, flattenNodes } from "../src/omg/session-tree";

const session = (fields: Record<string, unknown>) => fields as never;

test("a session reported twice under one id produces one root", () => {
  // The machine can list the same session from two sources in one payload.
  // Both collapse onto one node, and the roster must show it once.
  const roots = buildSessionTree([
    session({ sessionId: "a", title: "One" }),
    session({ sessionId: "a", title: "One again" }),
    session({ sessionId: "b", title: "Two" }),
  ]);
  expect(roots.map((node) => node.session.title)).toEqual(["One again", "Two"]);
});

test("children stay under their parent and out of the roots", () => {
  const roots = buildSessionTree([
    session({ sessionId: "parent", title: "Parent" }),
    session({ sessionId: "child", parentSessionId: "parent", title: "Child" }),
  ]);
  expect(roots).toHaveLength(1);
  expect(flattenNodes(roots).map((s) => s.title)).toEqual(["Parent", "Child"]);
});

test("input order is preserved", () => {
  const roots = buildSessionTree([
    session({ sessionId: "c", title: "C" }),
    session({ sessionId: "a", title: "A" }),
    session({ sessionId: "b", title: "B" }),
  ]);
  expect(roots.map((node) => node.session.title)).toEqual(["C", "A", "B"]);
});

/**
 * This ran on every live status frame. At O(n^2) a fleet of a few thousand
 * rows took seconds; the guard is deliberately loose so it fails on a return
 * to quadratic and not on a slow machine.
 */
test("building a large roster stays linear", () => {
  const big = Array.from({ length: 4000 }, (_, i) => session({ sessionId: `s${i}`, title: `S${i}` }));
  const started = performance.now();
  expect(buildSessionTree(big)).toHaveLength(4000);
  expect(performance.now() - started).toBeLessThan(500);
});
