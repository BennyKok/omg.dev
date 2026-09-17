import { beforeEach, describe, expect, test } from "bun:test";
import {
  clearTranscriptCache,
  prefetchTranscripts,
  readTranscriptCache,
  TRANSCRIPT_PAGE,
  transcriptCacheKey,
  updateTranscriptCacheMessages,
  writeTranscriptCache,
} from "../mobile/src/omg/transcript-cache";

type Msg = { id: string; text?: string };

const msg = (id: string): Msg => ({ id, text: id });
const page = (n: number, prefix = "m"): Msg[] =>
  Array.from({ length: n }, (_, i) => msg(`${prefix}${i}`));
const ids = (messages: { id?: unknown }[]) => messages.map((m) => m.id);

/** The sweep is deliberately off the critical path; give it room to run. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 700));

beforeEach(() => clearTranscriptCache());

describe("native transcript cache", () => {
  test("a re-opened session reads back the page it left", () => {
    const key = transcriptCacheKey("mac", "s1");
    writeTranscriptCache(key, page(3), TRANSCRIPT_PAGE);
    expect(ids(readTranscriptCache(key)?.messages ?? [])).toEqual(["m0", "m1", "m2"]);
  });

  test("a session never opened has nothing to paint", () => {
    expect(readTranscriptCache(transcriptCacheKey("mac", "cold"))).toBeNull();
  });

  test("the same session id on two machines does not collide", () => {
    writeTranscriptCache(transcriptCacheKey("mac", "s1"), [msg("mac-only")], TRANSCRIPT_PAGE);
    expect(readTranscriptCache(transcriptCacheKey("pi", "s1"))).toBeNull();
    expect(ids(readTranscriptCache(transcriptCacheKey("mac", "s1"))?.messages ?? [])).toEqual([
      "mac-only",
    ]);
  });

  test("an optimistic row is not cached, so a re-open never repaints 'Sending…'", () => {
    const key = transcriptCacheKey("mac", "s1");
    writeTranscriptCache(key, [msg("real-1"), msg("local-7")], TRANSCRIPT_PAGE);
    expect(ids(readTranscriptCache(key)?.messages ?? [])).toEqual(["real-1"]);
  });

  test("only one page is kept, so 'load more' still sees each page grow", () => {
    const key = transcriptCacheKey("mac", "s1");
    writeTranscriptCache(key, page(TRANSCRIPT_PAGE * 3), TRANSCRIPT_PAGE);
    const cached = readTranscriptCache(key)?.messages ?? [];
    expect(cached.length).toBe(TRANSCRIPT_PAGE);
    // The TAIL, not the head: a transcript opens at its newest message.
    expect(cached[cached.length - 1]?.id).toBe(`m${TRANSCRIPT_PAGE * 3 - 1}`);
  });

  test("a live message keeps the cached page current", () => {
    const key = transcriptCacheKey("mac", "s1");
    writeTranscriptCache(key, [msg("a")], TRANSCRIPT_PAGE);
    updateTranscriptCacheMessages(key, [msg("a"), msg("b")], TRANSCRIPT_PAGE);
    expect(ids(readTranscriptCache(key)?.messages ?? [])).toEqual(["a", "b"]);
  });

  test("a live message does not invent an entry for a session never loaded", () => {
    const key = transcriptCacheKey("mac", "never");
    updateTranscriptCacheMessages(key, [msg("a")], TRANSCRIPT_PAGE);
    expect(readTranscriptCache(key)).toBeNull();
  });

  test("the cache is bounded, and reading a session keeps it alive", () => {
    for (let i = 0; i < 24; i += 1) {
      writeTranscriptCache(transcriptCacheKey("mac", `s${i}`), [msg(`m${i}`)], TRANSCRIPT_PAGE);
    }
    // Touch the oldest so it is no longer the least recently used.
    expect(readTranscriptCache(transcriptCacheKey("mac", "s0"))).not.toBeNull();
    writeTranscriptCache(transcriptCacheKey("mac", "s24"), [msg("new")], TRANSCRIPT_PAGE);
    expect(readTranscriptCache(transcriptCacheKey("mac", "s0"))).not.toBeNull();
    expect(readTranscriptCache(transcriptCacheKey("mac", "s1"))).toBeNull();
  });

  test("the sweep warms the top of the list, and stops at eight", async () => {
    const asked: string[] = [];
    const keys = Array.from({ length: 12 }, (_, i) => transcriptCacheKey("mac", `s${i}`));
    prefetchTranscripts(
      keys,
      async (key) => {
        asked.push(key);
        return [msg(key)];
      },
      TRANSCRIPT_PAGE,
    );
    await settle();
    expect(asked.length).toBe(8);
    expect(readTranscriptCache(keys[0])).not.toBeNull();
    expect(readTranscriptCache(keys[8])).toBeNull();
  });

  test("the sweep never clobbers the page the reader's own open wrote", async () => {
    const key = transcriptCacheKey("mac", "s1");
    writeTranscriptCache(key, [msg("opened-by-hand")], TRANSCRIPT_PAGE);
    prefetchTranscripts([key], async () => [msg("prefetched")], TRANSCRIPT_PAGE);
    await settle();
    expect(ids(readTranscriptCache(key)?.messages ?? [])).toEqual(["opened-by-hand"]);
  });

  test("a session is attempted at most once, however often the list re-renders", async () => {
    const key = transcriptCacheKey("mac", "s1");
    let calls = 0;
    const load = async () => {
      calls += 1;
      throw new Error("offline");
    };
    prefetchTranscripts([key], load, TRANSCRIPT_PAGE);
    await settle();
    prefetchTranscripts([key], load, TRANSCRIPT_PAGE);
    await settle();
    expect(calls).toBe(1);
  });

  test("a failed warm leaves no entry, so the screen fetches normally", async () => {
    const key = transcriptCacheKey("mac", "s1");
    prefetchTranscripts(
      [key],
      async () => {
        throw new Error("offline");
      },
      TRANSCRIPT_PAGE,
    );
    await settle();
    expect(readTranscriptCache(key)).toBeNull();
  });
});
