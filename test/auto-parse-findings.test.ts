import { describe, expect, test } from "bun:test";
import { parseFindings, rankAndCap } from "../src/auto/runner.ts";

// The contract this pins: `null` = unparseable, `[]` = deliberate silence.
// Those two look identical from outside the runner, so conflating them is how a
// broken agent hides as a healthy quiet one.

describe("parseFindings — current array contract", () => {
  test("an empty findings array is silence, not a parse failure", () => {
    expect(parseFindings('{"findings": []}')).toEqual([]);
  });

  test("multiple findings all survive", () => {
    const out = parseFindings(
      '{"findings": [{"title": "a"}, {"title": "b"}, {"title": "c"}]}',
    );
    expect(out).toHaveLength(3);
    expect((out as any[])[1].title).toBe("b");
  });

  test("a bare top-level array is accepted", () => {
    const out = parseFindings('[{"title": "a"}, {"title": "b"}]');
    expect(out).toHaveLength(2);
  });

  test("null findings is silence", () => {
    expect(parseFindings('{"findings": null}')).toEqual([]);
  });

  test("non-object entries are dropped rather than filed as junk", () => {
    const out = parseFindings('{"findings": [{"title": "a"}, "nonsense", null, 7]}');
    expect(out).toHaveLength(1);
  });
});

describe("parseFindings — legacy single-finding contract still works", () => {
  // The 26 stored agent prompts were written against `{"finding": ...}` and are
  // NOT migrated by this change. If these break, those agents silently stop
  // reporting and nothing surfaces the fact.
  test('{"finding": null} is silence', () => {
    expect(parseFindings('{"finding": null}')).toEqual([]);
  });

  test('{"finding": {...}} yields exactly one', () => {
    const out = parseFindings('{"finding": {"title": "legacy", "severity": "high"}}');
    expect(out).toHaveLength(1);
    expect((out as any[])[0].title).toBe("legacy");
  });

  test("a bare finding object with no envelope is accepted", () => {
    const out = parseFindings('{"title": "envelopeless", "severity": "low"}');
    expect(out).toHaveLength(1);
  });

  test('{"finding": [...]} — an array under the legacy key — is accepted', () => {
    const out = parseFindings('{"finding": [{"title": "a"}, {"title": "b"}]}');
    expect(out).toHaveLength(2);
  });
});

describe("parseFindings — extraction from messy output", () => {
  test("a fenced json block is unwrapped", () => {
    const out = parseFindings('here you go:\n```json\n{"findings": [{"title": "x"}]}\n```');
    expect(out).toHaveLength(1);
  });

  test("prose around a bare object still parses", () => {
    const out = parseFindings('Analysis complete.\n{"findings": [{"title": "x"}]}\nDone.');
    expect(out).toHaveLength(1);
  });

  test("prose around a bare array still parses", () => {
    // Exercises the array fallback: the greedy {...} match grabs `{"title":
    // "x"},{"title": "y"}` first, fails to parse, and the [...] branch recovers.
    const out = parseFindings('Result:\n[{"title": "x"}, {"title": "y"}]\n');
    expect(out).toHaveLength(2);
  });

  test("unparseable output is null, distinguishable from silence", () => {
    expect(parseFindings("I could not complete the analysis.")).toBeNull();
  });

  test("an object with no recognised key is null, not an empty pass", () => {
    expect(parseFindings('{"summary": "all good"}')).toBeNull();
  });

  test("a non-array findings value is a parse failure, not silence", () => {
    expect(parseFindings('{"findings": "none"}')).toBeNull();
  });
});

describe("rankAndCap", () => {
  test("the cap drops the least severe, never the outage", () => {
    // The failure this pins: an agent lists five nits first and the outage
    // last. Capping in arrival order would truncate the one finding that
    // matters and file five that don't.
    const raw = [
      { title: "nit 1", severity: "low" },
      { title: "nit 2", severity: "low" },
      { title: "nit 3", severity: "low" },
      { title: "nit 4", severity: "low" },
      { title: "nit 5", severity: "low" },
      { title: "prod is down", severity: "high" },
    ];
    const out = rankAndCap(raw);
    expect(out).toHaveLength(5);
    expect(out[0].title).toBe("prod is down");
    expect(out.map((f) => f.title)).toContain("prod is down");
  });

  test("ordering within a severity is the agent's own", () => {
    const out = rankAndCap([
      { title: "b", severity: "high" },
      { title: "a", severity: "high" },
    ]);
    expect(out.map((f) => f.title)).toEqual(["b", "a"]);
  });

  test("untitled findings are dropped, not filed blank", () => {
    const out = rankAndCap([{ title: "  ", severity: "high" }, { title: "real" }]);
    expect(out).toHaveLength(1);
    expect(out[0].title).toBe("real");
  });

  test("missing severity defaults to med rather than throwing", () => {
    expect(rankAndCap([{ title: "x" }])[0].severity).toBe("med");
  });

  test("reasoning is capped at 6 bullets", () => {
    const out = rankAndCap([
      { title: "x", reasoning: ["1", "2", "3", "4", "5", "6", "7", "8"] },
    ]);
    expect(out[0].reasoning).toHaveLength(6);
  });

  test("a run under the cap is passed through untouched", () => {
    const out = rankAndCap([{ title: "only one", severity: "med" }]);
    expect(out).toHaveLength(1);
  });
});
