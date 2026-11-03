// Idle forks give back their FUSE daemon (~60 MB each) and keep their work.
// On 2026-11-03, 195 idle mounts held 11.5 GB on a 22 GB box with no swap.
// Uses real fuse-overlayfs mounts under a throwaway root; skipped where the
// box has no FUSE tools.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ensureSnapforkMounted,
  forksInUse,
  isMounted,
  overlayBinary,
  snapforkSupport,
  unmountIdleForks,
  unmountSnapfork,
} from "./snapfork.ts";

const supported = snapforkSupport().supported && overlayBinary() !== null;
const scope = process.env.LFG_SNAPFORK_SCOPE;
let root = "";

function makeFork(name: string): string {
  const base = join(root, ".snapfork", "bases", "repo", name);
  mkdirSync(base, { recursive: true });
  writeFileSync(join(base, "from-base.txt"), "base\n");
  const layer = join(root, ".snapfork", "layers", name);
  mkdirSync(join(layer, "upper"), { recursive: true });
  writeFileSync(join(layer, "meta.json"), JSON.stringify({ base, baseSha: "x", repo: root }));
  return join(root, name);
}

beforeAll(() => {
  process.env.LFG_SNAPFORK_SCOPE = "0";
  root = mkdtempSync(join(tmpdir(), "lfg-snapfork-idle-"));
});

afterAll(async () => {
  for (const name of ["a", "b", "c"]) await unmountSnapfork(name, root).catch(() => false);
  if (scope === undefined) delete process.env.LFG_SNAPFORK_SCOPE;
  else process.env.LFG_SNAPFORK_SCOPE = scope;
  rmSync(root, { recursive: true, force: true });
});

describe.skipIf(!supported)("unmountIdleForks", () => {
  test("unmounts only after idle on passes idleMs apart, and keeps the work", async () => {
    const mnt = makeFork("a");
    expect(await ensureSnapforkMounted("a", root)).toBe(true);
    writeFileSync(join(mnt, "work.txt"), "mine\n");
    const none = new Set<string>();

    expect(await unmountIdleForks(root, { idleMs: 1000, now: 10_000, inUse: none })).toEqual([]);
    expect(await unmountIdleForks(root, { idleMs: 1000, now: 10_500, inUse: none })).toEqual([]);
    expect(isMounted(mnt)).toBe(true);
    expect(await unmountIdleForks(root, { idleMs: 1000, now: 11_000, inUse: none })).toEqual(["a"]);
    expect(isMounted(mnt)).toBe(false);
    expect(existsSync(join(mnt, "work.txt"))).toBe(false);

    expect(await ensureSnapforkMounted("a", root)).toBe(true);
    expect(readFileSync(join(mnt, "work.txt"), "utf8")).toBe("mine\n");
    expect(readFileSync(join(mnt, "from-base.txt"), "utf8")).toBe("base\n");
  });

  test("never unmounts a live session's fork or one a process uses", async () => {
    makeFork("b");
    makeFork("c");
    expect(await ensureSnapforkMounted("b", root)).toBe(true);
    expect(await ensureSnapforkMounted("c", root)).toBe(true);
    const opts = { idleMs: 1000, keep: new Set(["b"]), inUse: new Set(["c"]) };
    await unmountIdleForks(root, { ...opts, now: 20_000 });
    const out = await unmountIdleForks(root, { ...opts, now: 99_000 });
    expect(out).not.toContain("b");
    expect(out).not.toContain("c");
    expect(isMounted(join(root, "b"))).toBe(true);
    expect(isMounted(join(root, "c"))).toBe(true);
  });

  test("forksInUse sees a process working inside a fork", async () => {
    const mnt = join(root, "c");
    const proc = Bun.spawn({ cmd: ["sleep", "30"], cwd: mnt, stdout: "ignore", stderr: "ignore" });
    try {
      await Bun.sleep(100);
      expect(forksInUse(root).has("c")).toBe(true);
      // The busy mount is refused, not lazily detached under the process.
      expect(await unmountSnapfork("c", root)).toBe(false);
      expect(isMounted(mnt)).toBe(true);
    } finally {
      proc.kill();
      await proc.exited;
    }
  });
});
