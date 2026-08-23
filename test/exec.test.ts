import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import {
  runExecCommand,
  clampExecTimeout,
  DEFAULT_EXEC_TIMEOUT_MS,
  MAX_EXEC_TIMEOUT_MS,
  MAX_EXEC_OUTPUT_BYTES,
} from "../src/exec.ts";

const cwd = mkdtempSync(`${tmpdir()}/omg-exec-`);

describe("clampExecTimeout", () => {
  test("defaults, floors, and ceilings", () => {
    expect(clampExecTimeout(undefined)).toBe(DEFAULT_EXEC_TIMEOUT_MS);
    expect(clampExecTimeout("nonsense")).toBe(DEFAULT_EXEC_TIMEOUT_MS);
    expect(clampExecTimeout(Number.NaN)).toBe(DEFAULT_EXEC_TIMEOUT_MS);
    expect(clampExecTimeout(5)).toBe(1_000);
    expect(clampExecTimeout(10 * 60_000)).toBe(MAX_EXEC_TIMEOUT_MS);
    expect(clampExecTimeout(5_000)).toBe(5_000);
  });
});

describe("runExecCommand", () => {
  test("returns stdout, stderr and the exit code separately", async () => {
    const r = await runExecCommand({ command: "echo out; echo err >&2; exit 3", cwd });

    expect(r.exitCode).toBe(3);
    expect(r.stdout.trim()).toBe("out");
    expect(r.stderr.trim()).toBe("err");
    expect(r.timedOut).toBe(false);
    expect(r.truncated).toBe(false);
  });

  test("runs in the directory it was given", async () => {
    const r = await runExecCommand({ command: "pwd", cwd });
    expect(r.stdout.trim()).toBe(r.cwd);
  });

  // A login shell, so the tools a user expects on their own machine — a PATH
  // set in a profile, mise, nvm — are actually present.
  test("runs through a login shell", async () => {
    const r = await runExecCommand({ command: "shopt -q login_shell && echo login", cwd });
    expect(r.stdout.trim()).toBe("login");
  });

  // The regression this pins is not cosmetic. A relay frame caps at 16 MiB and
  // base64 inflates 4/3, so an unbounded build log closes the box's socket with
  // a 1009 and takes the machine offline.
  test("truncates oversized output and says so", async () => {
    const r = await runExecCommand({
      command: `head -c ${MAX_EXEC_OUTPUT_BYTES * 3} /dev/zero | tr '\\0' 'x'`,
      cwd,
    });

    expect(r.truncated).toBe(true);
    expect(r.stdout.length).toBeLessThan(MAX_EXEC_OUTPUT_BYTES + 512);
    expect(r.stdout).toContain("bytes omitted");
  });

  // Head AND tail: a failing command's cause is usually at the top and its
  // verdict at the bottom, so keeping one end discards the half that mattered.
  test("keeps both ends of truncated output", async () => {
    const r = await runExecCommand({
      command: `echo FIRSTLINE; head -c ${MAX_EXEC_OUTPUT_BYTES * 2} /dev/zero | tr '\\0' 'x'; echo LASTLINE`,
      cwd,
    });

    expect(r.truncated).toBe(true);
    expect(r.stdout).toContain("FIRSTLINE");
    expect(r.stdout).toContain("LASTLINE");
  });

  test("kills a command that overruns and points at delegation", async () => {
    const r = await runExecCommand({ command: "sleep 30", cwd, timeoutMs: 1_000 });

    expect(r.timedOut).toBe(true);
    // null, not 0. A killed command must never look like it succeeded.
    expect(r.exitCode).toBeNull();
    expect(r.stderr).toContain("exceeded");
    expect(r.stderr).toContain("session");
    expect(r.durationMs).toBeLessThan(15_000);
  });

  // SIGKILL rather than SIGTERM: the caller is already past a deadline they
  // are blocked on, so a process that traps TERM must not hold them longer.
  test("kills a command that ignores SIGTERM", async () => {
    const r = await runExecCommand({
      command: "trap '' TERM; sleep 30",
      cwd,
      timeoutMs: 1_000,
    });

    expect(r.timedOut).toBe(true);
    expect(r.durationMs).toBeLessThan(15_000);
  });
});

// Regressions found by an independent verifier against a running server.
// Both were denial-of-service class, not cosmetic.
describe("runExecCommand under hostile output", () => {
  // THE BUG: the first version buffered whole streams and clipped afterwards,
  // which caps the RESPONSE but not the READ. `yes | cat` drove the server
  // from 220 MB to 2.5 GB of RSS in ten seconds, and the timeout could not
  // save it because the buffering await never resolved.
  //
  // Deliberately NOT asserted by measuring heapUsed. That is process-wide, so
  // in a full-suite run it moves with every other test's garbage and the
  // assertion fails for reasons unrelated to this code — which it did.
  //
  // What actually regressed is observable without it: a buffering
  // implementation cannot return promptly OR keep the response at the cap
  // while `truncated` proves the stream produced vastly more. Three seconds of
  // `yes` is hundreds of megabytes; if that is ever accumulated again, this
  // test stops finishing rather than merely failing an inequality.
  test("returns promptly and bounded against an infinite stream", async () => {
    const started = performance.now();

    const r = await runExecCommand({ command: "yes STREAM | cat", cwd, timeoutMs: 3_000 });

    expect(r.timedOut).toBe(true);
    expect(performance.now() - started).toBeLessThan(20_000);
    expect(r.stdout.length).toBeLessThan(MAX_EXEC_OUTPUT_BYTES + 512);
    expect(r.truncated).toBe(true);
  }, 30_000);

  // THE OTHER BUG: killing the shell orphaned everything it started. Both
  // halves of a pipeline stayed alive after the timeout, burning a core.
  test("kills the whole process group, not just the shell", async () => {
    const marker = `EXECMARK${Date.now()}`;
    const r = await runExecCommand({
      command: `exec -a ${marker} yes X | cat > /dev/null`,
      cwd,
      timeoutMs: 1_000,
    });

    expect(r.timedOut).toBe(true);
    await Bun.sleep(500);
    const survivors = Bun.spawnSync(["pgrep", "-f", marker])
      .stdout.toString().trim().split("\n").filter(Boolean).length;
    // Only meaningful where the group could actually be signalled.
    if (r.killedGroup) expect(survivors).toBe(0);
    Bun.spawnSync(["pkill", "-9", "-f", marker]);
  }, 30_000);

  test("a command that exits normally is never reported as an orphan risk", async () => {
    expect((await runExecCommand({ command: "echo ok", cwd })).killedGroup).toBe(true);
  });
});

// Both found by an independent verifier probing the running endpoint, after
// the first round of fixes had already landed.
describe("runExecCommand truncation seams and kill scope", () => {
  // A byte-offset cut lands mid-codepoint on any multibyte output, and
  // decoding the halves separately rendered each severed sequence as U+FFFD.
  test("does not corrupt multibyte output at the truncation seams", async () => {
    const r = await runExecCommand({
      command: `yes '€' | tr -d '\\n'`,
      cwd,
      timeoutMs: 2_000,
    });

    expect(r.truncated).toBe(true);
    expect(r.stdout).toContain("bytes omitted");
    // No replacement characters anywhere — not at the head cut, not at the
    // tail cut, not from the rolling-window slice that produced the tail.
    expect(r.stdout).not.toContain("�");
    // And the payload really is the multibyte character, not stripped ASCII.
    expect(r.stdout).toContain("€");
  }, 30_000);

  test("survives a 4-byte codepoint at the seams too", async () => {
    const r = await runExecCommand({
      command: `yes '🙂' | tr -d '\\n'`,
      cwd,
      timeoutMs: 2_000,
    });

    expect(r.truncated).toBe(true);
    expect(r.stdout).not.toContain("�");
    expect(r.stdout).toContain("🙂");
  }, 30_000);

  // nohup and disown do NOT create a session, so they stay in the group and
  // die with it. This pins the half of the boundary that actually holds.
  test("nohup and disown do not escape the process group", async () => {
    const marker = `NOHUPMARK${Date.now()}`;
    const r = await runExecCommand({
      command: `nohup bash -c "exec -a ${marker} sleep 30" >/dev/null 2>&1 & disown; sleep 30`,
      cwd,
      timeoutMs: 1_000,
    });

    expect(r.timedOut).toBe(true);
    await Bun.sleep(500);
    if (r.killedGroup) {
      const survivors = Bun.spawnSync(["pgrep", "-f", marker])
        .stdout.toString().trim().split("\n").filter(Boolean).length;
      expect(survivors).toBe(0);
    }
    Bun.spawnSync(["pkill", "-9", "-f", marker]);
  }, 30_000);
});
