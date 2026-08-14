import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ensureChatTranscriptCaughtUp } from "./chat-ingest.ts";

describe("chat transcript ingest", () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "lfg-chat-ingest-"));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  // A transcript can vanish under a live tailer: the worktree sweeper reclaims
  // a directory, or an agent rotates its own session file. This runs on the
  // live-socket poll path, and an uncaught ENOENT there took down the whole
  // serve process, killing every running session with it.
  test("a missing transcript reads as unchanged instead of throwing", async () => {
    const missing = join(root, "session_gone.journal.jsonl");

    const result = await ensureChatTranscriptCaughtUp(missing, "sid-gone", "test");

    expect(result.unchanged).toBe(true);
    expect(result.indexed).toBe(0);
    expect(result.lines).toBe(0);
    expect(result.size).toBe(0);
  });

  test("a transcript deleted after a successful read still does not throw", async () => {
    const path = join(root, "session_vanishing.journal.jsonl");
    writeFileSync(path, "");

    await ensureChatTranscriptCaughtUp(path, "sid-vanishing", "test-warm");
    rmSync(path, { force: true });

    const after = await ensureChatTranscriptCaughtUp(path, "sid-vanishing", "test-gone");
    expect(after.unchanged).toBe(true);
    // Never the -1 sentinel: callers treat `size` as a byte count.
    expect(after.size).toBeGreaterThanOrEqual(0);
  });
});
