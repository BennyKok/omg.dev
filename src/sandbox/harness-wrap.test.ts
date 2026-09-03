// The spawn path wraps the harness command in bwrap when the session's role
// asks for it. Uses the harness capture seam (LFG_TEST_HARNESS_CAPTURE) so no
// real provider process starts.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bwrapAvailable } from "./bwrap.ts";
import { spawnManagedAisdkSession } from "../tmux.ts";

let tmp: string;
let capture: string;
const originalCapture = process.env.LFG_TEST_HARNESS_CAPTURE;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "omg-hwrap-"));
  capture = join(tmp, "capture.json");
  process.env.LFG_TEST_HARNESS_CAPTURE = capture;
});

afterEach(() => {
  if (originalCapture === undefined) delete process.env.LFG_TEST_HARNESS_CAPTURE;
  else process.env.LFG_TEST_HARNESS_CAPTURE = originalCapture;
  rmSync(tmp, { recursive: true, force: true });
});

function captured(): { cmd: string[]; env: Record<string, string> } {
  return JSON.parse(readFileSync(capture, "utf8")) as { cmd: string[]; env: Record<string, string> };
}

describe("harness sandbox wrapping", () => {
  test("no sandbox: the command is the raw harness argv", () => {
    const res = spawnManagedAisdkSession({ name: "n1", cwd: tmp, model: "opus", sessionId: "s1" });
    expect(res.ok).toBe(true);
    const { cmd } = captured();
    expect(cmd[0]).toBe(process.execPath);
    expect(cmd.some((a) => a.endsWith("/bwrap") || a === "bwrap")).toBe(false);
  });

  const run = bwrapAvailable() ? test : test.skip;
  run("sandbox bwrap: the harness is wrapped and the worktree is bound", () => {
    const res = spawnManagedAisdkSession({ name: "n2", cwd: tmp, model: "opus", sessionId: "s2", sandbox: "bwrap" });
    expect(res.ok).toBe(true);
    const { cmd } = captured();
    expect(cmd[0]!.endsWith("/bwrap") || cmd[0] === "bwrap").toBe(true);
    const s = cmd.join(" ");
    expect(s).toContain(`--bind ${tmp} ${tmp}`);
    expect(s).toContain(`--chdir ${tmp}`);
    // The real harness argv still follows the bwrap `--` separator.
    const sep = cmd.indexOf("--");
    expect(sep).toBeGreaterThan(0);
    expect(cmd[sep + 1]).toBe(process.execPath);
  });

  test("egress proxy url becomes HTTP(S)_PROXY with loopback in NO_PROXY", () => {
    const url = "http://s3:tok@127.0.0.1:41000";
    const res = spawnManagedAisdkSession({ name: "n3", cwd: tmp, model: "opus", sessionId: "s3", egressProxyUrl: url });
    expect(res.ok).toBe(true);
    const { env } = captured();
    expect(env.HTTP_PROXY).toBe(url);
    expect(env.HTTPS_PROXY).toBe(url);
    expect(env.NO_PROXY).toContain("127.0.0.1");
  });

  test("no egress: no proxy env", () => {
    const res = spawnManagedAisdkSession({ name: "n4", cwd: tmp, model: "opus", sessionId: "s4" });
    expect(res.ok).toBe(true);
    const { env } = captured();
    expect(env.HTTP_PROXY ?? null).toBeNull();
  });
});
