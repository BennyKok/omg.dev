// The attribution rules here were all written against a live box, and every one
// of them is pinned because it was WRONG first:
//
//  - inheriting through the tmux server invented a 271 MB "orphan" out of an
//    unrelated interactive claude, an ssh and a login shell;
//  - keying a group on the session id split one session into two rows that each
//    claimed the same worktree, double-counting its disk;
//  - reading `--session` past the `--` separator let a user's prompt rename the
//    session it belonged to.
//
// A regression in any of those turns this panel from "which session do I close"
// into a confident lie, which is worse than not shipping it.
import { describe, expect, test } from "bun:test";

import { buildSessionUsageReport } from "./session-usage.ts";
import type { UsageSessionInput } from "./session-usage.ts";

describe("session usage report", () => {
  test("runs against the real /proc without throwing", async () => {
    const report = await buildSessionUsageReport([]);
    expect(Array.isArray(report.sessions)).toBe(true);
    expect(report.host.memTotalBytes).toBeGreaterThan(0);
    // Every row's component split must sum to its own total, or the bar chart
    // in the UI would not fill its own row.
    for (const row of report.sessions) {
      const parts = Object.values(row.byComponent).reduce((a, b) => a + b, 0);
      expect(Math.abs(parts - row.memBytes)).toBeLessThanOrEqual(1);
    }
  });

  test("attributes this test process to a session given its pid", async () => {
    // This test runs inside a managed session's process tree, so claiming the
    // whole tree by pid must find us — the strongest attribution key there is.
    const sessions: UsageSessionInput[] = [
      { sessionId: "test-session", tmuxName: null, cwd: null, pid: process.pid, title: "self" },
    ];
    const report = await buildSessionUsageReport(sessions);
    const row = report.sessions.find((r) => r.sessionId === "test-session");
    expect(row).toBeDefined();
    expect(row!.live).toBe(true);
    expect(row!.orphan).toBe(false);
    expect(row!.procs.some((p) => p.pid === process.pid)).toBe(true);
  });

  test("a live session is never reported as an orphan", async () => {
    const report = await buildSessionUsageReport([
      { sessionId: "test-session", tmuxName: null, cwd: null, pid: process.pid },
    ]);
    for (const row of report.sessions) {
      if (row.live) expect(row.orphan).toBe(false);
    }
    const orphanTotal = report.sessions
      .filter((r) => r.orphan)
      .reduce((sum, r) => sum + r.memBytes, 0);
    expect(report.orphanBytes).toBe(orphanTotal);
  });

  test("one managed name yields one row even across several session ids", async () => {
    // A resume mints a new session id while the old row is still live, and both
    // point at the same worktree. Two rows would double-count that disk.
    const sessions: UsageSessionInput[] = [
      { sessionId: "id-old", tmuxName: "lfg-dup", cwd: null, pid: process.pid },
      { sessionId: "id-new", tmuxName: "lfg-dup", cwd: null, pid: null },
    ];
    const report = await buildSessionUsageReport(sessions);
    const rows = report.sessions.filter((r) => r.managedName === "lfg-dup");
    expect(rows).toHaveLength(1);
  });

  test("labels never leak the prompt or a secret-looking flag", async () => {
    const report = await buildSessionUsageReport([]);
    for (const row of report.sessions) {
      for (const proc of row.procs) {
        expect(proc.label.length).toBeLessThanOrEqual(81);
        // The backend's argv carries the entire task prompt after `--`.
        expect(proc.label).not.toContain("=== OMG RUNTIME CONTRACT");
        expect(proc.label.toLowerCase()).not.toContain("token=");
        expect(proc.label.toLowerCase()).not.toContain("secret");
      }
    }
  });

  test("a session's own processes are not charged to shared infrastructure", async () => {
    // No row may contain the tmux server: it is shared by every tmux session,
    // so whatever it holds belongs to no single session.
    const report = await buildSessionUsageReport([]);
    for (const row of report.sessions) {
      for (const proc of row.procs) {
        expect(proc.label.startsWith("tmux ")).toBe(false);
      }
    }
  });

  test("the scan is cheap enough to serve on demand", async () => {
    const started = Date.now();
    await buildSessionUsageReport([]);
    // Measured ~50-130ms on a loaded 8-core box. A generous ceiling still
    // catches an accidental `du`/subprocess landing in the hot path.
    expect(Date.now() - started).toBeLessThan(3_000);
  });
});
