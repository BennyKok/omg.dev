import { describe, expect, test } from "bun:test";
import { regenerateSessionTitle, type RegenerateSessionTitleDeps } from "./session-title-regenerate.ts";

const SID = "11111111-2222-3333-4444-555555555555";

function deps(overrides: Partial<RegenerateSessionTitleDeps> = {}): {
  deps: RegenerateSessionTitleDeps;
  written: Array<{ sessionId: string; title: string }>;
} {
  const written: Array<{ sessionId: string; title: string }> = [];
  return {
    written,
    deps: {
      aiAvailable: () => true,
      resolveTranscript: async () => "/tmp/transcript.jsonl",
      firstUserText: async () => "Please fix the mobile session list overflow",
      generate: async () => "Fix Mobile Session Overflow",
      setTitle: async (sessionId, title) => {
        written.push({ sessionId, title });
      },
      ...overrides,
    },
  };
}

describe("regenerateSessionTitle", () => {
  test("titles the session from its first prompt and persists the result", async () => {
    const seen: string[] = [];
    const h = deps({
      generate: async (prompt) => {
        seen.push(prompt);
        return "  Fix Mobile Session Overflow  ";
      },
    });

    const result = await regenerateSessionTitle(SID, h.deps);

    expect(result).toEqual({ ok: true, title: "Fix Mobile Session Overflow" });
    expect(seen).toEqual(["Please fix the mobile session list overflow"]);
    expect(h.written).toEqual([{ sessionId: SID, title: "Fix Mobile Session Overflow" }]);
  });

  test("does not call the model when managed AI is unavailable", async () => {
    let called = false;
    const h = deps({
      aiAvailable: () => false,
      generate: async () => {
        called = true;
        return "Whatever";
      },
    });

    const result = await regenerateSessionTitle(SID, h.deps);

    expect(result).toEqual({ ok: false, status: 503, error: "managed AI is not available" });
    expect(called).toBe(false);
    expect(h.written).toEqual([]);
  });

  test("reports a missing transcript without writing a title", async () => {
    const h = deps({ resolveTranscript: async () => null });
    const result = await regenerateSessionTitle(SID, h.deps);
    expect(result).toEqual({ ok: false, status: 404, error: "session transcript not found" });
    expect(h.written).toEqual([]);
  });

  test("a blank first prompt is not sent to the model", async () => {
    let called = false;
    const h = deps({
      firstUserText: async () => "   ",
      generate: async () => {
        called = true;
        return "Whatever";
      },
    });

    const result = await regenerateSessionTitle(SID, h.deps);

    expect(result).toEqual({ ok: false, status: 422, error: "session has no prompt to title" });
    expect(called).toBe(false);
    expect(h.written).toEqual([]);
  });

  // The generator returns null for every normal failure: no account, timeout,
  // rejected plan, malformed response. None of them may clear the title, and
  // setSessionTitle("") is exactly how the override is deleted.
  test("keeps the existing title when generation fails", async () => {
    const h = deps({ generate: async () => null });
    const result = await regenerateSessionTitle(SID, h.deps);
    expect(result).toEqual({ ok: false, status: 502, error: "could not generate a title" });
    expect(h.written).toEqual([]);
  });

  test("keeps the existing title when generation throws", async () => {
    const h = deps({
      generate: async () => {
        throw new Error("network down");
      },
    });
    const result = await regenerateSessionTitle(SID, h.deps);
    expect(result).toEqual({ ok: false, status: 502, error: "could not generate a title" });
    expect(h.written).toEqual([]);
  });

  test("a transcript lookup that throws is a 404, not an unhandled rejection", async () => {
    const h = deps({
      resolveTranscript: async () => {
        throw new Error("index locked");
      },
    });
    const result = await regenerateSessionTitle(SID, h.deps);
    expect(result).toEqual({ ok: false, status: 404, error: "session transcript not found" });
    expect(h.written).toEqual([]);
  });
});
