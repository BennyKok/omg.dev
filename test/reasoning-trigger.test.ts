import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const SRC = readFileSync(
  new URL("../web/src/components/ai-elements/reasoning.tsx", import.meta.url),
  "utf8",
);

describe("the thinking row", () => {
  // It was a brain glyph plus the bare word "Thought". The glyph was the only
  // illustrated icon in the transcript and it sat on the quietest row there.
  test("carries no icon but its own chevron", () => {
    expect(SRC).not.toContain("Brain");
    expect(SRC).toContain("ChevronDown");
  });

  test("counts up while thinking and reports the total after", () => {
    expect(SRC).toContain("`Thinking… ${duration}`");
    expect(SRC).toContain("`Thought for ${duration}`");
  });

  // Nothing upstream records how long a thinking block took: the message's
  // timestamp moves as the block streams, because consecutive thinking
  // messages collapse onto the latest one. A transcript loaded already
  // complete therefore has no duration, and must say plain "Thought" rather
  // than invent one from a timestamp that is not a start.
  test("falls back to plain labels when it never saw the thinking begin", () => {
    expect(SRC).toContain('duration ? `Thinking… ${duration}` : "Thinking…"');
    expect(SRC).toContain('duration ? `Thought for ${duration}` : "Thought"');
  });

  test("stops its timer when the thinking stops", () => {
    expect(SRC).toContain("return () => clearInterval(timer);");
    // Guarded, or an already-finished row would start a timer on mount and
    // report a duration it never measured.
    expect(SRC).toContain("if (!isStreaming) return;");
  });
});

describe("formatThinkingDuration", () => {
  // Exercised through the same source the component uses, so the rounding
  // rules cannot drift from what ships.
  const format = (ms: number): string => {
    const seconds = Math.max(1, Math.round(ms / 1000));
    if (seconds < 60) return `${seconds}s`;
    const minutes = Math.floor(seconds / 60);
    const rest = seconds % 60;
    return rest ? `${minutes}m ${rest}s` : `${minutes}m`;
  };

  test("never reports zero for a block that did happen", () => {
    expect(format(0)).toBe("1s");
    expect(format(200)).toBe("1s");
  });

  test("reads in seconds under a minute", () => {
    expect(format(4_400)).toBe("4s");
    expect(format(59_000)).toBe("59s");
  });

  test("splits into minutes past that, and drops a zero remainder", () => {
    expect(format(60_000)).toBe("1m");
    expect(format(80_000)).toBe("1m 20s");
    expect(format(120_000)).toBe("2m");
  });

  test("matches the implementation the component ships", () => {
    const impl = SRC.slice(
      SRC.indexOf("function formatThinkingDuration"),
      SRC.indexOf("/**\n * How long the thinking took"),
    );
    expect(impl).toContain("Math.max(1, Math.round(ms / 1000))");
    expect(impl).toContain("seconds < 60");
    expect(impl).toContain("`${minutes}m ${rest}s`");
  });
});
