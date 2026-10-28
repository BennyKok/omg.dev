// Snapshot forks (src/snapfork.ts) end to end, against real git and a real
// fuse-overlayfs mount. Like the sweep probes, everything runs in a subprocess
// pinned to a throwaway LFG_WORKTREE_ROOT, so it never touches real worktrees.
// Skips when fuse-overlayfs or /dev/fuse is unavailable.
import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const REPO = resolve(import.meta.dir, "..");

function findOverlay(): string | null {
  if (process.env.LFG_FUSE_OVERLAYFS && existsSync(process.env.LFG_FUSE_OVERLAYFS)) {
    return process.env.LFG_FUSE_OVERLAYFS;
  }
  for (const dir of (process.env.PATH ?? "").split(":")) {
    if (dir && existsSync(join(dir, "fuse-overlayfs"))) return join(dir, "fuse-overlayfs");
  }
  return null;
}

const overlay = findOverlay();
const canRun = !!overlay && existsSync("/dev/fuse");

describe.skipIf(!canRun)("snapshot fork session worktrees", () => {
  test("fork from an older shared base, edit, capture and remove", () => {
    const root = mkdtempSync(join(tmpdir(), "lfg-snapfork-"));
    const worktreeRoot = join(root, "worktrees");
    const origin = join(root, "origin");
    const script = join(root, "probe.mjs");
    writeFileSync(
      script,
      `
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
const out = {};
const origin = process.env.PROBE_ORIGIN;
const root = process.env.LFG_WORKTREE_ROOT;
const git = (cwd, ...args) => {
  const r = Bun.spawnSync(["git", "-C", cwd, ...args], { stdout: "pipe", stderr: "pipe" });
  return { ok: r.exitCode === 0, out: r.stdout.toString().trim(), err: r.stderr.toString() };
};
mkdirSync(origin, { recursive: true });
git(origin, "init", "-q", "-b", "main");
git(origin, "config", "user.email", "probe@example.com");
git(origin, "config", "user.name", "probe");
writeFileSync(origin + "/a.txt", "one\\n");
writeFileSync(origin + "/gone.txt", "bye\\n");
writeFileSync(origin + "/.gitignore", "dist/\\n");
git(origin, "add", "-A"); git(origin, "commit", "-qm", "c1");
const c1 = git(origin, "rev-parse", "HEAD").out;

const wt = await import(process.env.PROBE_SRC + "/worktree.ts");
const sf = await import(process.env.PROBE_SRC + "/snapfork.ts");

// 1. No base yet: a normal worktree, and a base builds for next time.
const first = await wt.prepareSessionWorktree(origin, "s1");
out.firstOk = first.ok;
out.firstIsFork = sf.isSnapfork("s1", root);
const base = await sf.buildBase(origin, c1, root);
out.baseBuilt = !!base;

// 2. main moves on. The next session reuses the older base.
writeFileSync(origin + "/a.txt", "two\\n");
writeFileSync(origin + "/b.txt", "new\\n");
git(origin, "rm", "-q", "gone.txt");
git(origin, "add", "-A"); git(origin, "commit", "-qm", "c2");
const c2 = git(origin, "rev-parse", "HEAD").out;

const second = await wt.prepareSessionWorktree(origin, "s2");
const s2 = root + "/s2";
out.secondOk = second.ok;
out.secondIsFork = sf.isSnapfork("s2", root);
out.mounted = sf.isMounted(s2);
out.branch = git(s2, "branch", "--show-current").out;
out.headIsMain = git(s2, "rev-parse", "HEAD").out === c2;
out.status = git(s2, "status", "--porcelain").out;
out.aTxt = readFileSync(s2 + "/a.txt", "utf8");
out.goneExists = existsSync(s2 + "/gone.txt");
out.gitdirIsOwn = git(s2, "rev-parse", "--git-dir").out.endsWith("/worktrees/s2");

// 3. Work in the fork. The shared base never changes.
writeFileSync(s2 + "/work.txt", "agent work\\n");
mkdirSync(s2 + "/dist", { recursive: true });
writeFileSync(s2 + "/dist/out.js", "built\\n");
out.baseClean = git(base.path, "status", "--porcelain").out === "";
out.baseHasWork = existsSync(base.path + "/work.txt");

// 4. Remount after the daemon is gone (a reboot).
Bun.spawnSync(["fusermount3", "-u", s2]);
out.unmountedSeesFiles = existsSync(s2 + "/a.txt");
const again = await wt.prepareSessionWorktree(origin, "s2");
out.remountOk = again.ok && sf.isMounted(s2) && existsSync(s2 + "/work.txt");

// 4b. A daemon that dies leaves a dead mount; it is repaired on next use.
const daemon = Bun.spawnSync(["pgrep", "-d", " ", "-f", "upperdir=" + root + "/.snapfork/layers/s2/upper"], { stdout: "pipe" }).stdout.toString().trim().split(" ")[0];
if (daemon) process.kill(Number(daemon), "SIGKILL");
await Bun.sleep(200);
let dead = false; try { readdirSync(s2); } catch { dead = true; }
out.deadDetected = dead;
const healed = await wt.prepareSessionWorktree(origin, "s2");
out.healedOk = healed.ok && existsSync(s2 + "/work.txt");

// 5. Removal captures the work, then drops the layer and the registration.
const removal = await wt.removeSessionWorktree(origin, "s2", root);
out.removalOk = removal.ok;
out.captureHasWork = removal.ok && git(origin, "show", removal.capture.commit + ":work.txt").ok;
out.captureSkipsIgnored = removal.ok && !git(origin, "show", removal.capture.commit + ":dist/out.js").ok;
out.dirGone = !existsSync(s2);
out.layerGone = !existsSync(root + "/.snapfork/layers/s2");
out.stillRegistered = git(origin, "worktree", "list").out.includes("/s2");

await wt.removeSessionWorktree(origin, "s1", root);
console.log("PROBE" + JSON.stringify(out));
`,
    );
    try {
      const r = Bun.spawnSync(["bun", script], {
        cwd: REPO,
        env: {
          ...process.env,
          LFG_WORKTREE_ROOT: worktreeRoot,
          LFG_SNAPFORK: "1",
          LFG_SNAPFORK_INSTALL: "0",
          LFG_FUSE_OVERLAYFS: overlay!,
          LFG_WORKTREE_SWEEP_MS: "0",
          PROBE_ORIGIN: origin,
          PROBE_SRC: join(REPO, "src"),
        },
        stdout: "pipe",
        stderr: "pipe",
      });
      const text = r.stdout.toString();
      const line = text.split("\n").find((l) => l.startsWith("PROBE"));
      if (!line) throw new Error(`probe failed:\n${text}\n${r.stderr.toString()}`);
      const out = JSON.parse(line.slice("PROBE".length));

      expect(out.firstOk).toBe(true);
      expect(out.firstIsFork).toBe(false);
      expect(out.baseBuilt).toBe(true);

      expect(out.secondOk).toBe(true);
      expect(out.secondIsFork).toBe(true);
      expect(out.mounted).toBe(true);
      expect(out.branch).toBe("session_s2");
      expect(out.headIsMain).toBe(true);
      expect(out.status).toBe("");
      expect(out.aTxt).toBe("two\n");
      expect(out.goneExists).toBe(false);
      expect(out.gitdirIsOwn).toBe(true);

      expect(out.baseClean).toBe(true);
      expect(out.baseHasWork).toBe(false);

      expect(out.unmountedSeesFiles).toBe(false);
      expect(out.remountOk).toBe(true);
      expect(out.deadDetected).toBe(true);
      expect(out.healedOk).toBe(true);

      expect(out.removalOk).toBe(true);
      expect(out.captureHasWork).toBe(true);
      expect(out.captureSkipsIgnored).toBe(true);
      expect(out.dirGone).toBe(true);
      expect(out.layerGone).toBe(true);
      expect(out.stillRegistered).toBe(false);
    } finally {
      Bun.spawnSync(["fusermount3", "-u", join(worktreeRoot, "s2")]);
      rmSync(root, { recursive: true, force: true });
    }
  }, 60_000);
});
