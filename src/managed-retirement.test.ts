// Retirement moves dead old rows out of the live managed registry so the
// session list scan stops walking them, and keeps them in an archive that the
// by-id lookups (transcript, resume, feeds, worktree sweeper) still read.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PATHS } from "./config.ts";
import {
  addManaged,
  findManagedById,
  listArchivedManaged,
  listManaged,
  listManagedWithArchive,
  MANAGED_RETIRE_AFTER_MS,
  patchManaged,
  resetManagedRegistryForTests,
  retireDeadManaged,
  type ManagedRetirementProbes,
  type ManagedSession,
} from "./managed.ts";
import { cwdForTranscript } from "./sessions.ts";
import { resetTranscriptIndexConnectionForTests } from "./transcript-index.ts";

const originalData = PATHS.data;
let root = "";

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "lfg-managed-retire-"));
  PATHS.data = join(root, "data");
  mkdirSync(PATHS.data, { recursive: true });
  resetManagedRegistryForTests();
  resetTranscriptIndexConnectionForTests();
});

afterEach(() => {
  resetManagedRegistryForTests();
  resetTranscriptIndexConnectionForTests();
  PATHS.data = originalData;
  rmSync(root, { recursive: true, force: true });
});

const NOW = 1_800_000_000_000;
const OLD = NOW - MANAGED_RETIRE_AFTER_MS - 60_000;
let seq = 0;

function row(overrides: Partial<ManagedSession> = {}): ManagedSession {
  seq++;
  const hex = seq.toString(16).padStart(12, "0");
  return {
    tmuxName: `lfg-${seq}`,
    cwd: `/work/wt-${seq}`,
    createdAt: OLD,
    agent: "codex",
    runtime: "tmux",
    sessionId: `aaaaaaaa-aaaa-4aaa-8aaa-${hex}`,
    nativeSessionId: `bbbbbbbb-bbbb-4bbb-8bbb-${hex}`,
    launchState: "running",
    ...overrides,
  };
}

const allDead: ManagedRetirementProbes = {
  hasTmuxSession: () => false,
  hasHarnessEntry: () => false,
  hasIndexedMessages: () => false,
};

function retire(probes: Partial<ManagedRetirementProbes> = {}) {
  return retireDeadManaged({ now: NOW, probes: { ...allDead, ...probes } });
}

describe("managed registry retirement", () => {
  test("moves a dead old row to the archive, where by-id lookups still find it", () => {
    const dead = row({ title: "Old work", project: "app" });
    const live = row({ createdAt: NOW - 60_000 });
    addManaged(dead);
    addManaged(live);

    const retired = retire();

    expect(retired.map((r) => r.tmuxName)).toEqual([dead.tmuxName]);
    expect(listManaged().map((r) => r.tmuxName)).toEqual([live.tmuxName]);
    // A fresh serve process reads the same split from disk.
    resetManagedRegistryForTests();
    expect(listManaged().map((r) => r.tmuxName)).toEqual([live.tmuxName]);
    expect(findManagedById(dead.sessionId)).toMatchObject({ tmuxName: dead.tmuxName, title: "Old work" });
    expect(findManagedById(dead.nativeSessionId)?.tmuxName).toBe(dead.tmuxName);
    expect(listManagedWithArchive().map((r) => r.tmuxName).sort()).toEqual(
      [dead.tmuxName, live.tmuxName].sort(),
    );
    const line = JSON.parse(
      readFileSync(join(PATHS.data, "managed-sessions.archive.jsonl"), "utf8").trim(),
    ) as { archivedAt: number; session: ManagedSession };
    expect(line.archivedAt).toBe(NOW);
    expect(line.session.sessionId).toBe(dead.sessionId);
  });

  test("a second pass archives nothing twice", () => {
    addManaged(row());
    expect(retire()).toHaveLength(1);
    expect(retire()).toHaveLength(0);
    expect(listArchivedManaged()).toHaveLength(1);
  });

  test("keeps every row a person can still see or that something still owns", () => {
    const kept = {
      young: row({ createdAt: NOW - 60_000 }),
      recentlyRecovered: row({ interruptedAt: NOW - 60_000 }),
      livePane: row(),
      harnessEntry: row({ agent: "aisdk", runtime: "command-file" }),
      indexedMessages: row({ agent: "aisdk", runtime: "command-file" }),
      hydrating: row({ hydrating: true, launchState: "launching" }),
      startFailed: row({ launchState: "failed", launchFailedAt: OLD }),
      commandFileLaunching: row({ agent: "opencode", runtime: "command-file", launchState: "launching" }),
      bot: row({ botId: "bot-1" }),
      persistent: row({ persistent: true }),
      pendingMove: row({ pendingProjectMove: { cwd: "/work/x", project: "x", requestedAt: OLD } }),
    };
    const retirable = {
      deadTmux: row(),
      staleTmuxLaunch: row({ agent: "claude", launchState: "launching" }),
      recoveryFailure: row({ agent: "aisdk", runtime: "command-file", launchState: "failed" }),
    };
    for (const r of [...Object.values(kept), ...Object.values(retirable)]) addManaged(r);

    const retired = retire({
      hasTmuxSession: (name) => name === kept.livePane.tmuxName,
      hasHarnessEntry: (r) => r.tmuxName === kept.harnessEntry.tmuxName,
      hasIndexedMessages: (id) => id === kept.indexedMessages.sessionId,
    });

    expect(retired.map((r) => r.tmuxName).sort()).toEqual(
      Object.values(retirable).map((r) => r.tmuxName).sort(),
    );
    expect(listManaged().map((r) => r.tmuxName).sort()).toEqual(
      Object.values(kept).map((r) => r.tmuxName).sort(),
    );
  });

  test("a kept child keeps its dead parents, so the session tree stays whole", () => {
    const grandparent = row();
    const parent = row({ parentSessionId: grandparent.sessionId });
    const child = row({ parentNativeSessionId: parent.nativeSessionId, createdAt: NOW - 60_000 });
    const loner = row();
    for (const r of [grandparent, parent, child, loner]) addManaged(r);

    expect(retire().map((r) => r.tmuxName)).toEqual([loner.tmuxName]);
    expect(listManaged().map((r) => r.tmuxName).sort()).toEqual(
      [grandparent.tmuxName, parent.tmuxName, child.tmuxName].sort(),
    );
  });

  test("a row that changes while it is probed stays live", () => {
    const resumed = row();
    addManaged(resumed);

    const retired = retire({
      hasTmuxSession: (name) => {
        // A resume or relaunch lands between the probe and the write.
        if (name === resumed.tmuxName) patchManaged(name, { interruptedAt: NOW });
        return false;
      },
    });

    expect(retired).toHaveLength(0);
    expect(listManaged().map((r) => r.tmuxName)).toEqual([resumed.tmuxName]);
    expect(listArchivedManaged()).toHaveLength(0);
  });

  test("a live row for the same session wins over its archived copy", () => {
    const old = row();
    addManaged(old);
    retire();
    const resumed = { ...old, tmuxName: "lfg-resumed", cwd: "/work/resumed", createdAt: NOW };
    addManaged(resumed);

    expect(findManagedById(old.sessionId)?.tmuxName).toBe("lfg-resumed");
    expect(listManagedWithArchive().map((r) => r.tmuxName).sort()).toEqual(
      ["lfg-resumed", old.tmuxName].sort(),
    );
  });

  test("a torn final archive line does not hide the rows before it", () => {
    const dead = row();
    addManaged(dead);
    retire();
    appendFileSync(join(PATHS.data, "managed-sessions.archive.jsonl"), '{"archivedAt":1,"sess');

    expect(findManagedById(dead.sessionId)?.tmuxName).toBe(dead.tmuxName);
  });

  test("the transcript cwd lookup still reads a retired row", async () => {
    const dead = row({ agent: "aisdk", runtime: "command-file", cwd: "/work/retired-chat" });
    addManaged(dead);
    retire();

    expect(listManaged()).toHaveLength(0);
    expect(await cwdForTranscript(`lfg://session/${dead.sessionId}`)).toBe("/work/retired-chat");
  });
});
