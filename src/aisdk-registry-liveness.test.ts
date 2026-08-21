// isPidAlive decides whether a session can be resumed. POSIX kill() reads 0 and
// negative pids as PROCESS GROUPS rather than processes, so kill(0, 0) signals
// the caller's own group and succeeds. A dead or unrecorded harness is recorded
// as pid 0, so an unguarded implementation answers "alive" for exactly the
// sessions that are dead — which made them permanently unresumable: the resume
// endpoint saw a live match, queued the prompt into a command file nobody was
// tailing, and never cold-started a replacement.
import { describe, expect, test } from "bun:test";
import { isPidAlive } from "./aisdk-registry.ts";

describe("isPidAlive", () => {
  test("pid 0 is not alive (kill(0,0) targets the caller's process group)", () => {
    expect(isPidAlive(0)).toBe(false);
  });

  test("negative pids are not alive (they address process groups)", () => {
    expect(isPidAlive(-1)).toBe(false);
    expect(isPidAlive(-4242)).toBe(false);
  });

  test("non-integers are not alive", () => {
    expect(isPidAlive(1.5)).toBe(false);
    expect(isPidAlive(NaN)).toBe(false);
  });

  test("this process is alive", () => {
    expect(isPidAlive(process.pid)).toBe(true);
  });

  test("a pid that cannot exist is not alive", () => {
    expect(isPidAlive(0x7fffffff)).toBe(false);
  });
});
