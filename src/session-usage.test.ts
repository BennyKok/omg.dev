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
import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { buildSessionUsageReport, findSessionDevServerPids } from "./session-usage.ts";
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
        expect(proc.label).not.toContain("RUNTIME CONTRACT");
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

  describe("findSessionDevServerPids", () => {
    // This is the identification half of the archive-time dev-server reaper
    // (src/commands/serve.ts reapSessionDevServers). Killing the wrong process
    // is much worse than leaving one running, so what matters here is not just
    // "a dev server is found" but that it is found ONLY under the managed name
    // it actually carries — see AGENT_BROWSER_SESSION inheritance in the
    // module doc above.
    const units: string[] = [];
    const tmpDirs: string[] = [];
    let counter = 0;

    afterEach(() => {
      // `bun run dev` forks `sleep 30` as its own child, so killing only the
      // pid Bun.spawn returned orphans the sleep — it survives under init,
      // outside the scope, exactly the kind of leftover process this whole
      // feature exists to stop. Stopping the named unit takes the entire
      // cgroup with it (same technique src/aisdk-registry.ts's
      // terminateHarnessProcess uses for a real session's agent slice).
      for (const unit of units) {
        try {
          // `systemctl stop <name>` with no extension defaults to `<name>.service`
          // — a unit that never existed — and silently no-ops. Scopes need the
          // suffix spelled out, or this "cleanup" cleans up nothing.
          Bun.spawnSync(["systemctl", "--user", "stop", `${unit}.scope`]);
        } catch {}
      }
      units.length = 0;
      for (const dir of tmpDirs) {
        try {
          rmSync(dir, { recursive: true, force: true });
        } catch {}
      }
      tmpDirs.length = 0;
    });

    // A real `bun run dev` against a package.json whose "dev" script just
    // sleeps — long-lived (unlike a bare `bun run dev` with no package.json,
    // which exits before a /proc scan can ever see it) and its argv is the
    // actual shape classify() matches (DEVSERVER_VERBS "dev" + a "bun" base),
    // not a synthetic stand-in for it.
    //
    // Wrapped in `systemd-run --user --scope` so it lands in its own cgroup
    // scope instead of inheriting this test *runner's* cgroup. This suite
    // itself commonly runs inside a contained agent session
    // (lfg-agent-<name>.service), and directAttribution checks cgroup before
    // environ (see the module's priority-order doc) — without this, every
    // spawned child would be attributed to the RUNNER's own session by cgroup
    // regardless of the AGENT_BROWSER_SESSION we set below, which is exactly
    // the mismatch these tests exist to catch. A named --unit (rather than an
    // autogenerated run-*.scope) is what lets afterEach reliably find and
    // stop it again.
    function spawnFakeDevServer(managedName: string | undefined) {
      const dir = mkdtempSync(join(tmpdir(), "lfg-devserver-test-"));
      tmpDirs.push(dir);
      writeFileSync(
        join(dir, "package.json"),
        JSON.stringify({ name: "fake-devserver", scripts: { dev: "sleep 30" } }),
      );
      const env: Record<string, string> = { ...(process.env as Record<string, string>) };
      if (managedName) env.AGENT_BROWSER_SESSION = managedName;
      else delete env.AGENT_BROWSER_SESSION;
      delete env.LFG_SESSION_ID;
      const unit = `lfg-devserver-test-${process.pid}-${++counter}`;
      units.push(unit);
      const proc = Bun.spawn(
        ["systemd-run", "--user", "--scope", "--quiet", `--unit=${unit}`, "--", "bun", "run", "dev"],
        { cwd: dir, env, stdin: "ignore", stdout: "ignore", stderr: "ignore" },
      );
      return proc;
    }

    // systemd-run's scope activation is async (dbus round-trip), so the
    // process may not be running — or fully exec'd into its final argv —
    // the instant Bun.spawn returns. Poll instead of a fixed sleep.
    async function waitForHit(managedName: string, pid: number, timeoutMs = 5_000): Promise<boolean> {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        const hits = await findSessionDevServerPids(managedName);
        if (hits.some((h) => h.pid === pid)) return true;
        await Bun.sleep(100);
      }
      return false;
    }

    test("finds a dev server carrying this session's AGENT_BROWSER_SESSION", async () => {
      const managedName = `lfg-test-devserver-${process.pid}`;
      const proc = spawnFakeDevServer(managedName);
      expect(await waitForHit(managedName, proc.pid)).toBe(true);
    });

    test("does not attribute a dev server carrying a DIFFERENT session's name", async () => {
      const ours = `lfg-test-devserver-a-${process.pid}`;
      const theirs = `lfg-test-devserver-b-${process.pid}`;
      const proc = spawnFakeDevServer(theirs);
      // Prove the process is actually up and attributable at all — under its
      // OWN name — before trusting a miss under `ours` as a real negative
      // and not just "the process wasn't running yet".
      expect(await waitForHit(theirs, proc.pid)).toBe(true);
      const hits = await findSessionDevServerPids(ours);
      expect(hits.some((h) => h.pid === proc.pid)).toBe(false);
    });

    test("does not attribute a dev server with no lfg session env at all", async () => {
      // Stands in for "Benny started this by hand in the worktree" — no
      // AGENT_BROWSER_SESSION, no LFG_SESSION_ID, so no signal ties it to any
      // session and it must never be a hit for one.
      const managedName = `lfg-test-devserver-${process.pid}`;
      const proc = spawnFakeDevServer(undefined);
      // No managed name to poll a positive hit for here, so confirm the
      // process is actually up (not just "never got scanned") by waiting for
      // its pid to become signalable before trusting the negative.
      const deadline = Date.now() + 5_000;
      let alive = false;
      while (Date.now() < deadline) {
        try {
          process.kill(proc.pid, 0);
          alive = true;
          break;
        } catch {
          await Bun.sleep(100);
        }
      }
      expect(alive).toBe(true);
      const hits = await findSessionDevServerPids(managedName);
      expect(hits.some((h) => h.pid === proc.pid)).toBe(false);
    });
  });
});
