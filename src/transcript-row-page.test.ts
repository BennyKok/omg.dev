import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PATHS } from "./config.ts";
import type { SessionMsg } from "./sessions.ts";
import {
  indexedMessagePage,
  indexedMessageRowPage,
  indexSessionMessagesDirect,
  resetTranscriptIndexConnectionForTests,
  sessionIndexKey,
} from "./transcript-index.ts";
import { countTranscriptRows } from "./transcript-rows.ts";

const SESSION = "33333333-3333-4333-8333-333333333333";

// A turn that spends most of its messages inside one folded row: a thought,
// then a long run of tool calls with thinking between them. This is the shape
// that made a page of 80 raw messages render as three rows.
function toolHeavyTurn(turn: number): SessionMsg[] {
  const messages: SessionMsg[] = [
    { id: `u-${turn}`, role: "user", kind: "text", text: `ask ${turn}`, ts: turn * 1000 },
    { id: `open-${turn}`, role: "assistant", kind: "thinking", text: `plan ${turn}`, ts: turn * 1000 + 1 },
  ];
  for (let step = 0; step < 20; step += 1) {
    messages.push({
      id: `tool-${turn}-${step}`,
      role: "assistant",
      kind: "tool_use",
      text: `Bash: step ${step}`,
      ts: turn * 1000 + 2 + step * 2,
    });
    messages.push({
      id: `think-${turn}-${step}`,
      role: "assistant",
      kind: "thinking",
      text: `mid ${step}`,
      ts: turn * 1000 + 3 + step * 2,
    });
  }
  messages.push({
    id: `a-${turn}`,
    role: "assistant",
    kind: "text",
    text: `answer ${turn}`,
    ts: turn * 1000 + 900,
  });
  return messages;
}

const countRows = (messages: SessionMsg[]) => countTranscriptRows(messages);

describe("row-aware transcript pagination", () => {
  const originalData = PATHS.data;
  let root: string;
  let indexPath: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "lfg-row-page-"));
    PATHS.data = join(root, "data");
    resetTranscriptIndexConnectionForTests();
    indexPath = sessionIndexKey(SESSION);
    const all: SessionMsg[] = [];
    for (let turn = 0; turn < 12; turn += 1) all.push(...toolHeavyTurn(turn));
    indexSessionMessagesDirect(SESSION, all);
  });

  afterEach(() => {
    resetTranscriptIndexConnectionForTests();
    PATHS.data = originalData;
    rmSync(root, { recursive: true, force: true });
  });

  test("a raw-message page of 80 messages still renders only a few rows", async () => {
    const page = await indexedMessagePage(indexPath, SESSION, { limit: 80 });
    expect(page.messages).toHaveLength(80);
    // This is the bug: a full page of messages, an almost empty viewport.
    expect(countRows(page.messages)).toBeLessThan(10);
  });

  test("a row page of the same transcript yields at least the requested rows", async () => {
    const page = await indexedMessageRowPage(indexPath, SESSION, {
      rows: 24,
      chunk: 80,
      countRows,
    });
    expect(countRows(page.messages)).toBeGreaterThanOrEqual(24);
    expect(page.messages.length).toBeGreaterThan(80);
    expect(page.total).toBe(12 * 43);
    // The page is still the newest end of the transcript.
    expect(page.messages[page.messages.length - 1]!.id).toBe("a-11");
  });

  test("paging backward keeps yielding rows and finally reports the start", async () => {
    let before: number | null = null;
    let seen = 0;
    let pages = 0;
    for (;;) {
      const page: Awaited<ReturnType<typeof indexedMessageRowPage>> = await indexedMessageRowPage(
        indexPath,
        SESSION,
        { before, rows: 24, chunk: 80, countRows },
      );
      seen += page.messages.length;
      pages += 1;
      if (page.nextBefore == null) break;
      expect(countRows(page.messages)).toBeGreaterThanOrEqual(24);
      before = page.nextBefore;
      expect(pages).toBeLessThan(20);
    }
    expect(seen).toBe(12 * 43);
  });

  test("the last page returns what is left instead of spinning", async () => {
    const page = await indexedMessageRowPage(indexPath, SESSION, {
      before: 5,
      rows: 40,
      chunk: 80,
      countRows,
    });
    expect(page.nextBefore).toBeNull();
    expect(page.messages).toHaveLength(5);
  });

  test("the message ceiling stops a page that would swallow the transcript", async () => {
    const page = await indexedMessageRowPage(indexPath, SESSION, {
      rows: 500,
      chunk: 80,
      maxMessages: 160,
      countRows,
    });
    expect(page.messages.length).toBeGreaterThanOrEqual(160);
    expect(page.messages.length).toBeLessThan(320);
  });

  test("an empty transcript is an empty page", async () => {
    const page = await indexedMessageRowPage(sessionIndexKey("no-such-session"), "no-such-session", {
      rows: 24,
      chunk: 80,
      countRows,
    });
    expect(page.messages).toEqual([]);
    expect(page.nextBefore).toBeNull();
    expect(page.total).toBe(0);
  });
});
