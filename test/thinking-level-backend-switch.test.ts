// Switching a launch surface to a backend with no reasoning knob must DROP the
// thinking level, not carry it over.
//
// Two independent spots resurrected a level the new backend can't take, and
// both surfaced as the same 400 on the home screen:
//
//   thinkingLevel is not supported for opencode sessions
//
//   1. saveAutoAgent merged `input.thinkingLevel ?? existing.thinkingLevel`.
//      The editor correctly omits the level for opencode, so the merge put the
//      level the agent held as claude straight back and persisted a record that
//      no longer validates. Nothing re-checks a stored row, so it only broke
//      later, at launch.
//   2. replyToFinding (graduating a finding into a session) sent
//      `opts.thinkingLevel ?? sourceAgent.thinkingLevel` while sending the
//      OVERRIDDEN agent — so picking opencode in the finding sheet, which sends
//      no level by design, inherited the source auto agent's level anyway.
//
// These assert the property (level is always valid for the backend that runs
// it), so a third surface can't reintroduce it.

import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { sanitizeThinkingLevel } from "../src/auto/store.ts";
import { AUTO_AGENT_BACKENDS, thinkingLevelsForAgent } from "../src/agent-catalog.ts";

describe("auto agent store: thinking level survives only a compatible backend", () => {
  test("drops the level for a backend with no reasoning knob", () => {
    // The exact regression: a claude auto agent switched to opencode.
    expect(sanitizeThinkingLevel("high", "opencode")).toBeUndefined();
  });

  test("keeps a level the backend actually accepts", () => {
    expect(sanitizeThinkingLevel("high", "aisdk")).toBe("high");
    expect(sanitizeThinkingLevel("high", "grok")).toBe("high");
  });

  test("drops a level outside the new backend's own vocabulary", () => {
    // grok's CLI hard-exits on anything above high, so a claude "max" carried
    // across a backend switch would kill every future run.
    expect(sanitizeThinkingLevel("max", "grok")).toBeUndefined();
  });

  test("an omitted level stays omitted", () => {
    expect(sanitizeThinkingLevel(undefined, "aisdk")).toBeUndefined();
  });

  test("no backend can retain a level its own catalog rejects", () => {
    for (const backend of AUTO_AGENT_BACKENDS) {
      const allowed = thinkingLevelsForAgent(backend) ?? [];
      for (const level of ["off", "none", "minimal", "low", "medium", "high", "xhigh", "max"]) {
        const kept = sanitizeThinkingLevel(level, backend);
        if (kept !== undefined) expect(allowed).toContain(kept);
      }
    }
  });

  test("a legacy row with no backend is treated as the aisdk default", () => {
    expect(sanitizeThinkingLevel("high", undefined)).toBe("high");
  });
});

describe("web: every session launch gates thinkingLevel on the launching agent", () => {
  test("no /api/sessions/new body sends an ungated thinkingLevel", async () => {
    const source = await readFile("web/src/App.tsx", "utf8");
    // Each POST body that carries a level must gate it on the agent it is
    // actually launching, via agentSupportsThinking(...).
    const bodies = [...source.matchAll(/thinkingLevel:\s*([^,\n]+)/g)].map((m) => m[1].trim());
    const ungated = bodies.filter(
      (expr) =>
        expr.includes("sourceAgent?.thinkingLevel") && !expr.includes("agentSupportsThinking"),
    );
    expect(ungated).toEqual([]);
  });

  test("replyToFinding resolves the launch agent before judging the level", async () => {
    const source = await readFile("web/src/App.tsx", "utf8");
    const start = source.indexOf("async function replyToFinding(");
    const end = source.indexOf("async function saveAutoAgent(", start);
    const fn = source.slice(start, end);

    expect(start).toBeGreaterThan(-1);
    // The level is judged against the resolved launch agent, not the source.
    expect(fn).toContain("const launchAgent = opts.agent ?? sourceAgent?.agent ?? \"aisdk\"");
    expect(fn).toContain(
      "thinkingLevel: agentSupportsThinking(launchAgent) ? inheritedThinkingLevel : undefined",
    );
    // ...and the agent sent is the same one that decision was made against.
    expect(fn).toContain("agent: launchAgent,");
  });
});
