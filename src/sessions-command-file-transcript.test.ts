import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PATHS } from "./config.ts";
import { addManaged, resetManagedRegistryForTests } from "./managed.ts";
import { resetResumeCacheConnectionForTests } from "./resume-cache.ts";
import {
  managedLaunchRow,
  resetJcodeTranscriptSyncForTests,
  resolveTranscript,
  setJcodeSessionsDirForTests,
} from "./sessions.ts";
import {
  indexedRecentMessages,
  resetTranscriptIndexConnectionForTests,
  sessionIndexKey,
} from "./transcript-index.ts";

const originalData = PATHS.data;
const SESSION_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const NATIVE_ID = "session_cricket_1786634287477_1a02a1b0e078fca7";
const CWD = "/tmp/jcode-project";

let root = "";
let sessionsDir = "";

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "lfg-cmdfile-transcript-"));
  sessionsDir = join(root, "jcode-sessions");
  mkdirSync(sessionsDir, { recursive: true });
  PATHS.data = join(root, "data");
  mkdirSync(PATHS.data, { recursive: true });
  setJcodeSessionsDirForTests(sessionsDir);
  resetManagedRegistryForTests();
  resetResumeCacheConnectionForTests();
  resetJcodeTranscriptSyncForTests();
  resetTranscriptIndexConnectionForTests();
});

afterEach(() => {
  setJcodeSessionsDirForTests(null);
  resetManagedRegistryForTests();
  resetResumeCacheConnectionForTests();
  resetJcodeTranscriptSyncForTests();
  resetTranscriptIndexConnectionForTests();
  PATHS.data = originalData;
  rmSync(root, { recursive: true, force: true });
});

function writeJcodeJournal(id = NATIVE_ID): string {
  const journal = join(sessionsDir, `${id}.journal.jsonl`);
  writeFileSync(
    join(sessionsDir, `${id}.json`),
    JSON.stringify({
      id,
      working_dir: CWD,
      created_at: "2026-08-13T15:18:07.477Z",
      last_pid: 773668,
    }),
  );
  writeFileSync(journal, `${JSON.stringify({
    meta: { working_dir: CWD },
    append_messages: [{ id: "m1", role: "user", content: [{ type: "text", text: "hi" }] }],
  })}\n`);
  return journal;
}

describe("resolveTranscript command-file vs legacy tmux", () => {
  test("only command-file launch rows advertise the direct transcript index", () => {
    const base = {
      cwd: CWD,
      createdAt: Date.now(),
      agent: "cursor" as const,
      sessionId: SESSION_ID,
      launchState: "running" as const,
    };
    const tmux = {
      hasSession: () => true,
      panePid: () => process.pid,
      targetForPid: () => "lfg-cursor:0.0",
    };

    const legacy = managedLaunchRow(
      { ...base, tmuxName: "lfg-cursor", runtime: "tmux" },
      {},
      {},
      tmux,
    );
    const structured = managedLaunchRow(
      { ...base, tmuxName: "lfg-cursor-sdk", runtime: "command-file" },
      {},
      {},
      tmux,
    );

    expect(legacy?.transcriptPath).toBeNull();
    expect(structured?.transcriptPath).toBe(sessionIndexKey(SESSION_ID));
  });

  test("command-file grok/cursor/copilot/jcode use the direct transcript index", async () => {
    for (const agent of ["grok", "cursor", "copilot", "jcode"] as const) {
      resetManagedRegistryForTests();
      addManaged({
        tmuxName: `lfg-${agent}`,
        cwd: CWD,
        createdAt: Date.now(),
        agent,
        runtime: "command-file",
        sessionId: SESSION_ID,
        nativeSessionId: "native-does-not-matter",
        launchState: "running",
      });
      expect(await resolveTranscript(SESSION_ID)).toBe(sessionIndexKey(SESSION_ID));
    }
  });

  test("legacy tmux jcode still resolves through the combined transcript index", async () => {
    writeJcodeJournal();
    addManaged({
      tmuxName: "lfg-jcode",
      cwd: CWD,
      createdAt: Date.parse("2026-08-13T15:18:07.000Z"),
      agent: "jcode",
      sessionId: SESSION_ID,
      nativeSessionId: NATIVE_ID,
      launchState: "running",
    });
    const transcriptPath = await resolveTranscript(SESSION_ID);
    expect(transcriptPath).toBe(sessionIndexKey(SESSION_ID));
    expect(await indexedRecentMessages(transcriptPath!, SESSION_ID, 10)).toEqual([
      expect.objectContaining({ role: "user", kind: "text", text: "hi" }),
    ]);
  });

  test("legacy tmux jcode with runtime=tmux still uses the combined transcript index", async () => {
    writeJcodeJournal();
    addManaged({
      tmuxName: "lfg-jcode-tmux",
      cwd: CWD,
      createdAt: Date.parse("2026-08-13T15:18:07.000Z"),
      agent: "jcode",
      runtime: "tmux",
      sessionId: SESSION_ID,
      nativeSessionId: NATIVE_ID,
      launchState: "running",
    });
    const transcriptPath = await resolveTranscript(SESSION_ID);
    expect(transcriptPath).toBe(sessionIndexKey(SESSION_ID));
    expect(await indexedRecentMessages(transcriptPath!, SESSION_ID, 10)).toEqual([
      expect.objectContaining({ role: "user", kind: "text", text: "hi" }),
    ]);
  });

  test("command-file jcode does not bind a same-cwd native journal", async () => {
    writeJcodeJournal();
    addManaged({
      tmuxName: "lfg-jcode-sdk",
      cwd: CWD,
      createdAt: Date.parse("2026-08-13T15:18:07.000Z"),
      agent: "jcode",
      runtime: "command-file",
      sessionId: SESSION_ID,
      nativeSessionId: NATIVE_ID,
      launchState: "running",
    });
    expect(await resolveTranscript(SESSION_ID)).toBe(sessionIndexKey(SESSION_ID));
  });
});
