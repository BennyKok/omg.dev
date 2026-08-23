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
