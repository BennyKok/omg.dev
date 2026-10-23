import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { buildRefinePrompt, refineAutoPrompt } from "../src/auto/enhance.ts";

const SERVE = readFileSync(new URL("../src/commands/serve.ts", import.meta.url), "utf8");

const agent = {
  name: "repo-review",
  prompt: "You watch web/src for regressions. Only surface broken builds.",
};

describe("buildRefinePrompt", () => {
  test("carries the agent's current instruction so the rewrite is an edit, not a fresh write", () => {
    const out = buildRefinePrompt({ ...agent, feedback: "too many nits" });
    expect(out).toContain(agent.prompt);
    expect(out).toContain("Name: repo-review");
    expect(out).toContain("too many nits");
  });

  test("the feedback comes last", () => {
    // The whole point of the ordering: the model reads the standing
    // instruction, then the example, and applies the correction on top. With
    // the feedback buried first it rewrote the agent around the one finding.
    const out = buildRefinePrompt({
      ...agent,
      feedback: "raise the bar",
      finding: { title: "nit: rename a var", reasoning: ["cosmetic"], suggest: "rename it" },
    });
    expect(out.indexOf("raise the bar")).toBeGreaterThan(out.indexOf("nit: rename a var"));
    expect(out.indexOf(agent.prompt)).toBeLessThan(out.indexOf("nit: rename a var"));
  });

  test("the finding block is included only when one is given", () => {
    const withFinding = buildRefinePrompt({
      ...agent,
      feedback: "f",
      finding: {
        title: "build is red",
        severity: "high",
        reasoning: ["tsc fails"],
        suggest: "fix the type",
      },
    });
    expect(withFinding).toContain("build is red");
    expect(withFinding).toContain("Severity: high");
    expect(withFinding).toContain("- tsc fails");
    expect(withFinding).toContain("Suggested fix: fix the type");

    const without = buildRefinePrompt({ ...agent, feedback: "f" });
    expect(without).not.toContain("## The finding");
  });

  test("the repo-inspection note rides on a resolved cwd only", () => {
    expect(buildRefinePrompt({ ...agent, feedback: "f", cwd: "/repos/lfg" })).toContain(
      "READ-ONLY tools",
    );
    expect(buildRefinePrompt({ ...agent, feedback: "f" })).not.toContain(
      "You are running INSIDE",
    );
  });

  test("the meta-prompt forbids blacklisting the one finding", () => {
    // A refine that names the finding and tells the agent to never mention it
    // again is how a watch agent goes quiet on a whole class of real problems.
    const out = buildRefinePrompt({ ...agent, feedback: "stop showing me this" });
    expect(out).toContain("SMALLEST edit");
    expect(out).toContain("does not mean naming that finding and blacklisting it");
    expect(out).toContain("never drop its core mandate");
  });
});

// The finding sheet's Feedback button was dropped in 0d0e1eebb (the footer now
// uses the composer's agent and thinking pills), so only the server side of
// the refine path is left to pin here.
describe("the refine route", () => {
  test("the server routes refine and requires feedback", () => {
    const route = SERVE.match(
      /path\.match\(\/\^\\\/api\\\/auto\\\/agents\\\/\(\[a-z0-9_-\]\+\)\\\/refine\$\/\)/,
    );
    expect(route).not.toBeNull();
    expect(SERVE).toContain('if (!feedback) return err(400, "feedback is required")');
  });
});

describe("refineAutoPrompt", () => {
  test("refuses empty feedback before spending a model call", async () => {
    await expect(refineAutoPrompt({ ...agent, feedback: "   " }, undefined)).rejects.toThrow(
      /nothing to apply/,
    );
  });

  test("refuses an agent with no instruction to edit", async () => {
    await expect(
      refineAutoPrompt({ name: "x", prompt: "  ", feedback: "be stricter" }, undefined),
    ).rejects.toThrow(/no instruction/);
  });
});
