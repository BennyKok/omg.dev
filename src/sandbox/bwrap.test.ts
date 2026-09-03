import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bwrapArgv, bwrapAvailable, bwrapBinary, sandboxCommand } from "./bwrap.ts";

describe("bwrapArgv", () => {
  const plan = {
    worktree: "/home/u/lfg-worktrees/proj",
    omgRoot: "/home/u/lfg-worktrees/omg",
    dataDir: "/home/u/lfg-worktrees/omg/data",
    runtime: "/home/u/.bun/bin/bun",
    home: "/home/u",
  };

  test("binds the worktree rw and chdirs into it", () => {
    const argv = bwrapArgv(["bun", "x"], plan, "/usr/bin/bwrap");
    const s = argv.join(" ");
    expect(s).toContain("--bind /home/u/lfg-worktrees/proj /home/u/lfg-worktrees/proj");
    expect(s).toContain("--chdir /home/u/lfg-worktrees/proj");
    expect(argv.slice(-3)).toEqual(["--", "bun", "x"]);
  });

  test("empties home and masks the omg data dir even though the code tree is exposed", () => {
    const argv = bwrapArgv(["bun"], plan, "/usr/bin/bwrap");
    const s = argv.join(" ");
    expect(s).toContain("--tmpfs /home/u");
    expect(s).toContain("--ro-bind /home/u/lfg-worktrees/omg /home/u/lfg-worktrees/omg");
    // The data-dir tmpfs must come AFTER the omg ro-bind so it hides the secrets.
    const roIdx = argv.indexOf("/home/u/lfg-worktrees/omg");
    const maskIdx = argv.indexOf("/home/u/lfg-worktrees/omg/data");
    expect(roIdx).toBeGreaterThan(-1);
    expect(maskIdx).toBeGreaterThan(roIdx);
    expect(argv[maskIdx - 1]).toBe("--tmpfs");
  });

  test("keeps the network (no --unshare-net) but isolates the other namespaces", () => {
    const argv = bwrapArgv(["bun"], plan, "/usr/bin/bwrap");
    expect(argv).toContain("--unshare-user");
    expect(argv).toContain("--unshare-pid");
    expect(argv).not.toContain("--unshare-net");
    expect(argv).not.toContain("--unshare-all");
  });
});

describe("sandboxCommand", () => {
  test("none is a passthrough", () => {
    const out = sandboxCommand(["bun"], "none", { worktree: "/w", omgRoot: "/o", dataDir: "/o/data" });
    expect(out).toEqual({ command: ["bun"], sandboxed: false });
  });

  test("bwrap unavailable falls back with a reason, not an error", () => {
    const out = sandboxCommand(["bun"], "bwrap", { worktree: "/w", omgRoot: "/o", dataDir: "/o/data" }, null);
    expect(out.sandboxed).toBe(false);
    expect(out.reason).toContain("not available");
    expect(out.command).toEqual(["bun"]);
  });
});

// A real sandbox on this box, when bubblewrap is present. Proves the mechanism,
// not just the argv: a command inside the sandbox reads its worktree, cannot
// read a sibling secret, and has an empty home.
describe("bwrap isolation (live)", () => {
  const bin = bwrapBinary();
  const run = bwrapAvailable(bin) ? test : test.skip;
  let tmp: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "omg-sbx-"));
    mkdirSync(join(tmp, "work"), { recursive: true });
    mkdirSync(join(tmp, "omg", "data"), { recursive: true });
    writeFileSync(join(tmp, "work", "inside.txt"), "project file");
    writeFileSync(join(tmp, "secret.txt"), "TOP SECRET");
    writeFileSync(join(tmp, "omg", "code.txt"), "omg code");
    writeFileSync(join(tmp, "omg", "data", "session-secret"), "BOX SECRET KEY");
  });

  afterEach(() => rmSync(tmp, { recursive: true, force: true }));

  run("worktree writable, sibling hidden, omg code exposed, omg data masked", async () => {
    const worktree = join(tmp, "work");
    const omgRoot = join(tmp, "omg");
    const dataDir = join(omgRoot, "data");
    const script = `
      const fs = require("node:fs");
      const read = (p) => { try { return fs.readFileSync(p, "utf8"); } catch { return null; } };
      const out = {
        inside: read("inside.txt"),
        sibling: read(${JSON.stringify(join(tmp, "secret.txt"))}),
        omgCode: read(${JSON.stringify(join(omgRoot, "code.txt"))}),
        boxSecret: read(${JSON.stringify(join(dataDir, "session-secret"))}),
        wroteWorktree: (() => { try { fs.writeFileSync("out.txt", "ok"); return true; } catch { return false; } })(),
      };
      console.log(JSON.stringify(out));
    `;
    const { command, sandboxed } = sandboxCommand([process.execPath, "-e", script], "bwrap", {
      worktree,
      omgRoot,
      dataDir,
    }, bin);
    expect(sandboxed).toBe(true);

    const proc = Bun.spawn({ cmd: command, stdout: "pipe", stderr: "pipe" });
    const [stdout, stderr] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ]);
    await proc.exited;
    const line = stdout.trim().split("\n").pop() ?? "";
    let parsed: { inside: string | null; sibling: string | null; omgCode: string | null; boxSecret: string | null; wroteWorktree: boolean };
    try {
      parsed = JSON.parse(line);
    } catch {
      throw new Error(`sandbox run produced no JSON. stdout=${stdout} stderr=${stderr}`);
    }
    // The worktree is fully usable.
    expect(parsed.inside).toBe("project file");
    expect(parsed.wroteWorktree).toBe(true);
    // A sibling path outside the worktree is not there.
    expect(parsed.sibling).toBeNull();
    // The omg code tree is readable so the harness can run,
    expect(parsed.omgCode).toBe("omg code");
    // but the omg data dir inside it is masked: the box secret is unreadable.
    expect(parsed.boxSecret).toBeNull();
  });
});
