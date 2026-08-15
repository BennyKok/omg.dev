import { describe, expect, test } from "bun:test";
import { hasAncestorPid } from "../src/sessions.ts";

// A codex-aisdk harness runs headless under systemd-run with no tmux session,
// so the pane-based guard in listSessions() can never resolve it — it returned
// null and silently passed the harness's own `codex exec` child through as a
// standalone `agent: codex` row. One conversation, two rows in the session list,
// both opening the same transcript. Ancestry is the guard that actually holds.
describe("hasAncestorPid", () => {
  // 4200 -> 4100 (sdk wrapper) -> 4000 (harness) -> 1 (systemd)
  const tree = new Map([
    [4200, 4100],
    [4100, 4000],
    [4000, 1],
    [7000, 1],
  ]);
  const parentOf = (pid: number) => tree.get(pid) ?? null;
  const harnessPids = new Set([4000]);

  test("catches the engine child spawned directly by the harness", () => {
    expect(hasAncestorPid(4100, harnessPids, 4, parentOf)).toBe(true);
  });

  test("catches it through an SDK wrapper process", () => {
    expect(hasAncestorPid(4200, harnessPids, 4, parentOf)).toBe(true);
  });

  test("leaves a standalone session alone", () => {
    expect(hasAncestorPid(7000, harnessPids, 4, parentOf)).toBe(false);
  });

  test("does not walk past init into shared ancestry", () => {
    // Every managed process descends from pid 1; treating that as a match would
    // hide every codex session instead of just the harness's own child.
    expect(hasAncestorPid(4200, new Set([1]), 8, parentOf)).toBe(false);
  });

  test("stops at maxDepth instead of searching forever", () => {
    expect(hasAncestorPid(4200, harnessPids, 1, parentOf)).toBe(false);
  });

  test("terminates on an unreadable ppid and on a cycle", () => {
    expect(hasAncestorPid(999, harnessPids, 4, () => null)).toBe(false);
    const cycle = new Map([
      [1, 2],
      [2, 1],
    ]);
    expect(hasAncestorPid(1, harnessPids, 4, (p) => cycle.get(p) ?? null)).toBe(false);
  });
});
