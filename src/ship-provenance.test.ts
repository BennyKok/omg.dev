import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { classifyShipProvenance, collectShipProvenance } from "./ship-provenance.ts";

describe("classifyShipProvenance", () => {
  test("uncommitted work outranks everything else", () => {
    // The worst case for tracing: there is no sha a reader can check out.
    expect(classifyShipProvenance({ readable: true, reachable: true, dirty: 3, ahead: 2, commits: 2 })).toBe(
      "uncommitted",
    );
    expect(classifyShipProvenance({ readable: true, reachable: true, dirty: 1, ahead: 0, commits: 1 })).toBe(
      "uncommitted",
    );
  });

  test("committed but not on main reads as unlanded", () => {
    expect(classifyShipProvenance({ readable: true, reachable: true, dirty: 0, ahead: 4, commits: 4 })).toBe(
      "unlanded",
    );
  });

  test("squash-merged work reads as landed, not clean", () => {
    // A squash merge leaves none of the branch's shas in main, so `commits`
    // is the only thing separating real landed work from a session that
    // wrote no code at all.
    expect(
      classifyShipProvenance({ readable: true, reachable: true, dirty: 0, ahead: 0, commits: 3 }),
    ).toBe("landed");
  });

  test("committed and reached main reads as landed", () => {
    expect(classifyShipProvenance({ readable: true, reachable: true, dirty: 0, ahead: 0, commits: 2 })).toBe(
      "landed",
    );
  });

  test("a clean worktree with no commits is 'clean', not 'landed'", () => {
    // An ops or research session is an honest ship, but it must not wear the
    // same badge as work that actually landed a commit.
    expect(classifyShipProvenance({ readable: true, reachable: true, dirty: 0, ahead: 0, commits: 0 })).toBe(
      "clean",
    );
  });

  test("a dirty worktree still reads uncommitted when the remote is unreachable", () => {
    // An offline or remote-less checkout must not launder dirty work into
    // "unknown" — that is the exact case this record exists to surface.
    expect(
      classifyShipProvenance({ readable: true, reachable: false, dirty: 2, ahead: 0, commits: 0 }),
    ).toBe("uncommitted");
    expect(
      classifyShipProvenance({ readable: true, reachable: false, dirty: 0, ahead: 0, commits: 0 }),
    ).toBe("unknown");
  });

  test("an unreadable checkout is unknown regardless of the other facts", () => {
    expect(classifyShipProvenance({ readable: false, reachable: true, dirty: 0, ahead: 0, commits: 0 })).toBe(
      "unknown",
    );
  });
});

describe("collectShipProvenance", () => {
  const dirs: string[] = [];

  function repo(): string {
    const dir = mkdtempSync(join(tmpdir(), "ship-prov-"));
    dirs.push(dir);
    const run = (args: string[]) => Bun.spawnSync({ cmd: ["git", "-C", dir, ...args] });
    run(["init", "--quiet", "-b", "main"]);
    run(["config", "user.email", "t@example.com"]);
    run(["config", "user.name", "T"]);
    writeFileSync(join(dir, "seed.txt"), "seed\n");
    run(["add", "."]);
    run(["commit", "--quiet", "-m", "seed"]);
    return dir;
  }

  afterAll(() => {
    for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
  });

  test("reports uncommitted files with the branch and head for tracing", () => {
    const dir = repo();
    writeFileSync(join(dir, "wip.txt"), "unsaved\n");
    const got = collectShipProvenance({ cwd: dir, worktreeBranch: "main" });
    expect(got?.state).toBe("uncommitted");
    expect(got?.dirty).toBe(1);
    expect(got?.branch).toBe("main");
    expect(got?.head).toMatch(/^[0-9a-f]{7,}$/);
  });

  test("a clean checkout with no origin/main is still recorded, not dropped", () => {
    // No remote at all: `git cherry` fails, so the reading is honest about
    // not knowing rather than silently claiming the work landed.
    const got = collectShipProvenance({ cwd: repo(), worktreeBranch: "main" });
    expect(got?.state).toBe("unknown");
    expect(got?.dirty).toBe(0);
  });

  test("work that landed still reads as landed after main moves on", () => {
    // Regression: counting the session's commits as `origin/main..HEAD` goes
    // empty the moment the work lands and main advances, which reported a
    // session that shipped real commits as having written no code at all.
    const origin = mkdtempSync(join(tmpdir(), "ship-prov-origin-"));
    const work = mkdtempSync(join(tmpdir(), "ship-prov-work-"));
    dirs.push(origin, work);
    const g = (dir: string, args: string[]) =>
      Bun.spawnSync({ cmd: ["git", "-C", dir, ...args], stdout: "pipe", stderr: "pipe" });

    g(origin, ["init", "--quiet", "--bare", "-b", "main"]);
    g(work, ["clone", "--quiet", origin, "."]);
    g(work, ["config", "user.email", "t@example.com"]);
    g(work, ["config", "user.name", "T"]);
    writeFileSync(join(work, "seed.txt"), "seed\n");
    g(work, ["add", "."]);
    g(work, ["commit", "--quiet", "-m", "seed"]);
    g(work, ["push", "--quiet", "origin", "main"]);

    // Session branch, cut from main, with real work on it.
    g(work, ["checkout", "--quiet", "-b", "session_x", "origin/main"]);
    writeFileSync(join(work, "feature.txt"), "feature\n");
    g(work, ["add", "."]);
    g(work, ["commit", "--quiet", "-m", "feature"]);

    // It lands, and then main moves on past it.
    g(work, ["push", "--quiet", "origin", "session_x:main"]);
    g(work, ["fetch", "--quiet", "origin", "main"]);
    const later = mkdtempSync(join(tmpdir(), "ship-prov-later-"));
    dirs.push(later);
    g(later, ["clone", "--quiet", origin, "."]);
    g(later, ["config", "user.email", "t@example.com"]);
    g(later, ["config", "user.name", "T"]);
    writeFileSync(join(later, "unrelated.txt"), "other\n");
    g(later, ["add", "."]);
    g(later, ["commit", "--quiet", "-m", "unrelated"]);
    g(later, ["push", "--quiet", "origin", "main"]);

    const got = collectShipProvenance({ cwd: work, worktreeBranch: "session_x" });
    expect(got?.state).toBe("landed");
    expect(got?.ahead).toBe(0);
    // The session's own commit is still counted, not swallowed by main.
    expect(got?.commits).toBe(1);
  });

  test("returns nothing outside a git checkout, so plain chats carry no badge", () => {
    const dir = mkdtempSync(join(tmpdir(), "ship-prov-plain-"));
    dirs.push(dir);
    expect(collectShipProvenance({ cwd: dir, worktreeBranch: undefined })).toBeUndefined();
  });

  test("returns nothing for a session with no worktree or a deleted one", () => {
    expect(collectShipProvenance(undefined)).toBeUndefined();
    expect(
      collectShipProvenance({ cwd: "/nonexistent/worktree-gone", worktreeBranch: "x" }),
    ).toBeUndefined();
  });
});
