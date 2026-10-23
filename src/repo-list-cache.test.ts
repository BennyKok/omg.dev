// The project list is shared, not rebuilt per request. These pin the parts
// that keep it correct: concurrent callers share one build, a write (a new
// fingerprint or an invalidate) is seen at once, and the age bound holds.
import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRepoListCache, repoListFingerprint } from "./repo-list.ts";

function harness() {
  let builds = 0;
  let fingerprint = "a";
  let clock = 1_000;
  const gates: Array<() => void> = [];
  const cache = createRepoListCache({
    build: () => {
      const n = ++builds;
      return new Promise<number>((resolve) => gates.push(() => resolve(n)));
    },
    fingerprint: async () => fingerprint,
    maxAgeMs: 15_000,
    now: () => clock,
  });
  return {
    cache,
    builds: () => builds,
    release: async () => { gates.shift()?.(); await Bun.sleep(0); },
    setFingerprint: (next: string) => { fingerprint = next; },
    advance: (ms: number) => { clock += ms; },
  };
}

describe("createRepoListCache", () => {
  test("six callers at once share one build", async () => {
    const h = harness();
    const calls = Array.from({ length: 6 }, () => h.cache.get());
    await Bun.sleep(0);
    expect(h.builds()).toBe(1);
    await h.release();
    expect(await Promise.all(calls)).toEqual([1, 1, 1, 1, 1, 1]);
    expect(await h.cache.get()).toBe(1);
    expect(h.builds()).toBe(1);
  });

  test("a changed fingerprint rebuilds at once", async () => {
    const h = harness();
    const first = h.cache.get();
    await Bun.sleep(0);
    await h.release();
    await first;
    h.setFingerprint("b");
    const second = h.cache.get();
    await Bun.sleep(0);
    await h.release();
    expect(await second).toBe(2);
  });

  test("an entry older than the age bound rebuilds", async () => {
    const h = harness();
    const first = h.cache.get();
    await Bun.sleep(0);
    await h.release();
    await first;
    h.advance(15_001);
    const second = h.cache.get();
    await Bun.sleep(0);
    await h.release();
    expect(await second).toBe(2);
  });

  test("a build that started before invalidate does not refill the cache", async () => {
    const h = harness();
    const stale = h.cache.get();
    await Bun.sleep(0);
    h.cache.invalidate();
    await h.release();
    expect(await stale).toBe(1);
    const fresh = h.cache.get();
    await Bun.sleep(0);
    expect(h.builds()).toBe(2);
    await h.release();
    expect(await fresh).toBe(2);
  });
});

describe("repoListFingerprint", () => {
  test("changes when a project folder is added or a pin file is written", async () => {
    const root = mkdtempSync(join(tmpdir(), "lfg-repo-fp-"));
    try {
      const repos = join(root, "repos");
      const pins = join(root, "custom-repos.json");
      mkdirSync(repos);
      const before = await repoListFingerprint([repos, pins]);
      expect(before.endsWith("|-")).toBe(true);
      await Bun.sleep(5);
      mkdirSync(join(repos, "new-project"));
      const afterFolder = await repoListFingerprint([repos, pins]);
      expect(afterFolder).not.toBe(before);
      writeFileSync(pins, "[]");
      expect(await repoListFingerprint([repos, pins])).not.toBe(afterFolder);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
