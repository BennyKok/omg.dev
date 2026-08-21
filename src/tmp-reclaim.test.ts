import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  agentTmpEnv,
  defaultDiskTmpDir,
  diskTmpDirIfNeeded,
  ensureDiskBackedTmpdir,
  isProtectedTmpName,
  isRamBackedFs,
  pathIsOpen,
  RAMFS_MAGIC,
  shouldSweepTmpEntry,
  stopTmpSweepForTests,
  sweepTmpRoot,
  TMPFS_MAGIC,
} from "./tmp-reclaim.ts";

describe("tmp reclaim", () => {
  afterEach(() => {
    stopTmpSweepForTests();
    delete process.env.LFG_TMPDIR;
  });

  test("tmpfs and ramfs magic numbers are ram-backed", () => {
    expect(isRamBackedFs(TMPFS_MAGIC)).toBe(true);
    expect(isRamBackedFs(RAMFS_MAGIC)).toBe(true);
    expect(isRamBackedFs(0xef53)).toBe(false);
  });

  test("LFG_TMPDIR wins over the default cache path", () => {
    const env = { LFG_TMPDIR: "/var/tmp/lfg-agents" };
    expect(diskTmpDirIfNeeded(env, "/home/dev")).toBe("/var/tmp/lfg-agents");
    expect(agentTmpEnv(env, "/home/dev")).toEqual({
      TMPDIR: "/var/tmp/lfg-agents",
      TMP: "/var/tmp/lfg-agents",
      TEMP: "/var/tmp/lfg-agents",
    });
  });

  test("without LFG_TMPDIR the default is $HOME/.cache/lfg/tmp", () => {
    expect(defaultDiskTmpDir("/home/dev")).toBe("/home/dev/.cache/lfg/tmp");
  });

  test("ensureDiskBackedTmpdir applies LFG_TMPDIR onto the given env", () => {
    const root = mkdtempSync(join(tmpdir(), "lfg-tmpdir-"));
    try {
      const dest = join(root, "cache");
      const env: NodeJS.ProcessEnv = { LFG_TMPDIR: dest };
      expect(ensureDiskBackedTmpdir(env, root)).toBe(dest);
      expect(env.TMPDIR).toBe(dest);
      expect(env.TMP).toBe(dest);
      expect(env.TEMP).toBe(dest);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("protects live runtime names and unix sockets", () => {
    expect(isProtectedTmpName("lfg-uploads")).toBe(true);
    expect(isProtectedTmpName("claude-1001")).toBe(true);
    expect(isProtectedTmpName("cursor-agent-logs-1001")).toBe(true);
    expect(isProtectedTmpName("tmux-1001")).toBe(true);
    expect(isProtectedTmpName("ssh-XXXX")).toBe(true);
    expect(isProtectedTmpName("systemd-private-abc")).toBe(true);
    expect(isProtectedTmpName(".X11-unix")).toBe(true);
    expect(isProtectedTmpName("main-check")).toBe(false);
    expect(isProtectedTmpName("prune-abc")).toBe(false);
    expect(isProtectedTmpName("bunx-1001-wrangler@1")).toBe(false);
  });

  test("sweep keeps open, young, protected, and other-uid entries", () => {
    const minAgeMs = 60_000;
    expect(
      shouldSweepTmpEntry({
        name: "prune-old",
        ageMs: 120_000,
        minAgeMs,
        open: false,
        uidOwned: true,
      }),
    ).toBe(true);
    expect(
      shouldSweepTmpEntry({
        name: "prune-old",
        ageMs: 120_000,
        minAgeMs,
        open: true,
        uidOwned: true,
      }),
    ).toBe(false);
    expect(
      shouldSweepTmpEntry({
        name: "prune-old",
        ageMs: 10,
        minAgeMs,
        open: false,
        uidOwned: true,
      }),
    ).toBe(false);
    expect(
      shouldSweepTmpEntry({
        name: "lfg-uploads",
        ageMs: 120_000,
        minAgeMs,
        open: false,
        uidOwned: true,
      }),
    ).toBe(false);
    expect(
      shouldSweepTmpEntry({
        name: "prune-old",
        ageMs: 120_000,
        minAgeMs,
        open: false,
        uidOwned: false,
      }),
    ).toBe(false);
  });

  test("pathIsOpen matches the directory and its children", () => {
    expect(pathIsOpen("/tmp/main-check", ["/tmp/main-check/node_modules"])).toBe(true);
    expect(pathIsOpen("/tmp/main-check", ["/tmp/other"])).toBe(false);
  });

  test("sweepTmpRoot deletes old unused leftovers and keeps the rest", () => {
    const root = mkdtempSync(join(tmpdir(), "lfg-tmpsweep-"));
    try {
      const oldJunk = join(root, "main-check");
      const young = join(root, "fresh-install");
      const protectedDir = join(root, "lfg-uploads");
      const openDir = join(root, "omg-doctor-live");
      mkdirSync(oldJunk);
      mkdirSync(young);
      mkdirSync(protectedDir);
      mkdirSync(openDir);
      writeFileSync(join(oldJunk, "x"), "stale");
      const now = Date.now();
      const twoHoursAgo = now / 1000 - 3 * 60 * 60;
      utimesSync(oldJunk, twoHoursAgo, twoHoursAgo);
      utimesSync(join(oldJunk, "x"), twoHoursAgo, twoHoursAgo);
      utimesSync(protectedDir, twoHoursAgo, twoHoursAgo);
      utimesSync(openDir, twoHoursAgo, twoHoursAgo);

      const result = sweepTmpRoot(root, {
        now,
        minAgeMs: 2 * 60 * 60_000,
        openPaths: [join(openDir, "fd")],
        uid: typeof process.getuid === "function" ? process.getuid() : -1,
      });

      expect(result.removed).toEqual(["main-check"]);
      expect(result.failed).toEqual([]);
      expect(existsSync(oldJunk)).toBe(false);
      expect(existsSync(young)).toBe(true);
      expect(existsSync(protectedDir)).toBe(true);
      expect(existsSync(openDir)).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
