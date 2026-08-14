import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PATHS } from "./config.ts";
import { addManaged, resetManagedRegistryForTests } from "./managed.ts";
import { resetResumeCacheConnectionForTests } from "./resume-cache.ts";
import {
  cwdForTranscript,
  loadJcodeCombinedMessages,
  normalizeLineMessages,
  resetJcodeTranscriptSyncForTests,
  resolveTranscript,
  setJcodeSessionsDirForTests,
  syncJcodeTranscriptIndex,
} from "./sessions.ts";
import {
  indexedMessagePage,
  resetTranscriptIndexConnectionForTests,
  sessionIndexKey,
} from "./transcript-index.ts";

const originalData = PATHS.data;
const SESSION_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const NATIVE_ID = "session_cricket_1786634287477_1a02a1b0e078fca7";
const CWD = "/tmp/jcode-project";

let root = "";
let sessionsDir = "";

function journalLine(messages: unknown[], extraMeta: Record<string, unknown> = {}): string {
  return JSON.stringify({
    meta: {
      working_dir: CWD,
      updated_at: "2026-08-13T15:18:07.741Z",
      model: "claude-opus-5",
      ...extraMeta,
    },
    append_messages: messages,
  });
}

function writeJcodeSession(opts: {
  id?: string;
  cwd?: string;
  createdAt?: string;
  lastPid?: number;
  lines?: string[];
}): { id: string; journal: string } {
  const id = opts.id ?? NATIVE_ID;
  const journal = join(sessionsDir, `${id}.journal.jsonl`);
  writeFileSync(
    join(sessionsDir, `${id}.json`),
    JSON.stringify({
      id,
      working_dir: opts.cwd ?? CWD,
      created_at: opts.createdAt ?? "2026-08-13T15:18:07.477Z",
      last_pid: opts.lastPid ?? 773668,
      model: "claude-opus-5",
    }),
  );
  writeFileSync(
    journal,
    (opts.lines ?? [
      journalLine([
        {
          id: "message_1",
          role: "user",
          timestamp: "2026-08-13T15:18:07.741Z",
          content: [{ type: "text", text: "Fix the drawer morph" }],
        },
      ]),
    ]).join("\n") + "\n",
  );
  return { id, journal };
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "lfg-jcode-transcript-"));
  sessionsDir = join(root, "jcode-sessions");
  mkdirSync(sessionsDir, { recursive: true });
  PATHS.data = join(root, "data");
  mkdirSync(PATHS.data, { recursive: true });
  setJcodeSessionsDirForTests(sessionsDir);
  resetManagedRegistryForTests();
  resetResumeCacheConnectionForTests();
  resetTranscriptIndexConnectionForTests();
  resetJcodeTranscriptSyncForTests();
});

afterEach(() => {
  setJcodeSessionsDirForTests(null);
  resetManagedRegistryForTests();
  resetResumeCacheConnectionForTests();
  resetTranscriptIndexConnectionForTests();
  resetJcodeTranscriptSyncForTests();
  PATHS.data = originalData;
  rmSync(root, { recursive: true, force: true });
});

describe("normalizeLineMessages jcode journal", () => {
  test("maps user text, assistant text, thinking, tools, and results", () => {
    const line = journalLine([
      {
        id: "message_user",
        role: "user",
        timestamp: "2026-08-13T15:18:07.741Z",
        content: [{ type: "text", text: "User: Fix the drawer morph" }],
      },
      {
        id: "message_asst",
        role: "assistant",
        timestamp: "2026-08-13T15:18:10.938Z",
        content: [
          { type: "reasoning_trace", text: "Look at the morph first." },
          { type: "text", text: "I will inspect the drawer." },
          { type: "tool_use", id: "toolu_1", name: "bash", input: { command: "ls" } },
        ],
      },
      {
        id: "message_tool",
        role: "user",
        timestamp: "2026-08-13T15:18:11.152Z",
        content: [{ type: "tool_result", tool_use_id: "toolu_1", content: "index.tsx\n" }],
      },
    ]);

    expect(normalizeLineMessages(line)).toEqual([
      {
        id: "message_user",
        role: "user",
        kind: "text",
        text: "Fix the drawer morph",
        ts: Date.parse("2026-08-13T15:18:07.741Z"),
      },
      {
        id: "message_asst",
        role: "assistant",
        kind: "thinking",
        text: "Look at the morph first.",
        ts: Date.parse("2026-08-13T15:18:10.938Z"),
      },
      {
        id: "message_asst#1",
        role: "assistant",
        kind: "text",
        text: "I will inspect the drawer.",
        ts: Date.parse("2026-08-13T15:18:10.938Z"),
      },
      {
        id: "message_asst#2",
        role: "assistant",
        kind: "tool_use",
        text: 'bash: {\n  "command": "ls"\n}',
        ts: Date.parse("2026-08-13T15:18:10.938Z"),
      },
      {
        id: "message_tool",
        role: "user",
        kind: "tool_result",
        text: "index.tsx\n",
        ts: Date.parse("2026-08-13T15:18:11.152Z"),
      },
    ]);
  });

  test("ignores unrelated JSONL shapes", () => {
    expect(normalizeLineMessages(JSON.stringify({ type: "user", content: "hi" }))).toEqual([
      { id: null, role: "user", kind: "text", text: "hi", ts: null },
    ]);
    expect(normalizeLineMessages(JSON.stringify({ meta: { title: "x" } }))).toEqual([]);
  });
});

describe("resolveTranscript jcode", () => {
  test("resolves a managed session by remembered native id into the session index", async () => {
    const { journal } = writeJcodeSession({});
    addManaged({
      tmuxName: "lfg-jcode",
      cwd: CWD,
      createdAt: Date.parse("2026-08-13T15:18:07.000Z"),
      agent: "jcode",
      sessionId: SESSION_ID,
      nativeSessionId: NATIVE_ID,
      launchState: "running",
    });

    expect(await resolveTranscript(SESSION_ID)).toBe(sessionIndexKey(SESSION_ID));
    expect(await cwdForTranscript(journal)).toBe(CWD);
    expect(await cwdForTranscript(sessionIndexKey(SESSION_ID))).toBe(CWD);
  });

  test("resolves by cwd + createdAt when native id is not stored yet", async () => {
    writeJcodeSession({
      createdAt: "2026-08-13T15:18:07.477Z",
    });
    addManaged({
      tmuxName: "lfg-jcode",
      cwd: CWD,
      createdAt: Date.parse("2026-08-13T15:18:07.310Z"),
      agent: "jcode",
      sessionId: SESSION_ID,
      launchState: "running",
    });

    expect(await resolveTranscript(SESSION_ID)).toBe(sessionIndexKey(SESSION_ID));
  });

  test("does not bind an older same-cwd journal from before launch", async () => {
    writeJcodeSession({
      id: "session_vole_1786628016667_13b5632a0e91b7ec",
      createdAt: "2026-08-13T13:33:36.667Z",
    });
    addManaged({
      tmuxName: "lfg-jcode",
      cwd: CWD,
      createdAt: Date.parse("2026-08-13T15:18:07.000Z"),
      agent: "jcode",
      sessionId: SESSION_ID,
      launchState: "running",
    });

    expect(await resolveTranscript(SESSION_ID)).toBeNull();
  });

  test("returns null for a jcode session with no journal yet", async () => {
    addManaged({
      tmuxName: "lfg-jcode",
      cwd: CWD,
      createdAt: Date.now(),
      agent: "jcode",
      sessionId: SESSION_ID,
      launchState: "launching",
    });

    expect(await resolveTranscript(SESSION_ID)).toBeNull();
  });

  test("indexes the journal so the messages page can return chat history", async () => {
    writeJcodeSession({
      lines: [
        journalLine([
          {
            id: "message_1",
            role: "user",
            timestamp: "2026-08-13T15:18:07.741Z",
            content: [{ type: "text", text: "Fix the drawer morph" }],
          },
        ]),
        journalLine([
          {
            id: "message_2",
            role: "assistant",
            timestamp: "2026-08-13T15:18:10.938Z",
            content: [{ type: "text", text: "I will inspect the drawer." }],
          },
        ]),
      ],
    });
    addManaged({
      tmuxName: "lfg-jcode",
      cwd: CWD,
      createdAt: Date.parse("2026-08-13T15:18:07.000Z"),
      agent: "jcode",
      sessionId: SESSION_ID,
      nativeSessionId: NATIVE_ID,
      launchState: "running",
    });

    const path = await resolveTranscript(SESSION_ID);
    expect(path).toBe(sessionIndexKey(SESSION_ID));
    if (!path) throw new Error("expected jcode transcript path");
    const page = await indexedMessagePage(path, SESSION_ID, { limit: 20 });
    expect(page.total).toBe(2);
    expect(page.messages.map((m) => ({ role: m.role, text: m.text }))).toEqual([
      { role: "user", text: "Fix the drawer morph" },
      { role: "assistant", text: "I will inspect the drawer." },
    ]);
  });

  test("recovers full history when the journal was rewritten but session.json still has turns", async () => {
    // Reproduce the production failure: jcode rewrites journal.jsonl down to a
    // few recent lines while session_<id>.json still holds the full chat.
    const id = NATIVE_ID;
    writeFileSync(
      join(sessionsDir, `${id}.json`),
      JSON.stringify({
        id,
        working_dir: CWD,
        created_at: "2026-08-13T15:18:07.477Z",
        updated_at: "2026-08-13T15:20:00.000Z",
        last_pid: 773668,
        model: "claude-opus-5",
        messages: [
          {
            id: "message_sys",
            role: "user",
            display_role: "system",
            timestamp: "2026-08-13T15:18:07.480Z",
            content: [{ type: "text", text: "<system-reminder>\n# Session Context\n</system-reminder>" }],
          },
          {
            id: "message_user_1",
            role: "user",
            timestamp: "2026-08-13T15:18:07.741Z",
            content: [{ type: "text", text: "User: Fix the drawer morph" }],
          },
          {
            id: "message_asst_1",
            role: "assistant",
            timestamp: "2026-08-13T15:18:10.938Z",
            content: [{ type: "text", text: "I will inspect the drawer." }],
          },
          {
            id: "message_user_2",
            role: "user",
            timestamp: "2026-08-13T15:19:00.000Z",
            content: [{ type: "text", text: "Also fix the tint." }],
          },
          {
            id: "message_asst_2",
            role: "assistant",
            timestamp: "2026-08-13T15:19:05.000Z",
            content: [{ type: "text", text: "Tint is next." }],
          },
        ],
      }),
    );
    // Truncated journal: only a post-rewrite user turn, none of the history above.
    writeFileSync(
      join(sessionsDir, `${id}.journal.jsonl`),
      journalLine([
        {
          id: "message_user_3",
          role: "user",
          timestamp: "2026-08-13T15:20:00.000Z",
          content: [{ type: "text", text: "hi" }],
        },
      ]) + "\n",
    );
    addManaged({
      tmuxName: "lfg-jcode",
      cwd: CWD,
      createdAt: Date.parse("2026-08-13T15:18:07.000Z"),
      agent: "jcode",
      sessionId: SESSION_ID,
      nativeSessionId: id,
      launchState: "running",
    });

    const combined = await loadJcodeCombinedMessages(id);
    expect(combined.map((m) => m.text)).toEqual([
      "Fix the drawer morph",
      "I will inspect the drawer.",
      "Also fix the tint.",
      "Tint is next.",
      "hi",
    ]);

    const path = await resolveTranscript(SESSION_ID);
    expect(path).toBe(sessionIndexKey(SESSION_ID));
    if (!path) throw new Error("expected jcode transcript path");
    const page = await indexedMessagePage(path, SESSION_ID, { limit: 50 });
    expect(page.total).toBe(5);
    expect(page.messages.map((m) => ({ role: m.role, text: m.text }))).toEqual([
      { role: "user", text: "Fix the drawer morph" },
      { role: "assistant", text: "I will inspect the drawer." },
      { role: "user", text: "Also fix the tint." },
      { role: "assistant", text: "Tint is next." },
      { role: "user", text: "hi" },
    ]);

    // Second resolve is a stamp no-op and keeps the same history.
    expect(await syncJcodeTranscriptIndex(SESSION_ID, id)).toBe(path);
    expect((await indexedMessagePage(path, SESSION_ID, { limit: 50 })).total).toBe(5);
  });
});
