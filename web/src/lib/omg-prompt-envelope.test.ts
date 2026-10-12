import { describe, expect, test } from "bun:test";
import { parseOmgPromptEnvelope } from "./omg-prompt-envelope";

const contract = `=== omg.dev RUNTIME CONTRACT (capability version 2026-08-12.2) ===
- Use the omg.dev tools.
=== END omg.dev RUNTIME CONTRACT ===
=== USER TASK ===
Fix the status`;

describe("parseOmgPromptEnvelope", () => {
  test("parses the plain managed launch envelope", () => {
    expect(parseOmgPromptEnvelope(contract)).toEqual({
      instructions: "- Use the omg.dev tools.",
      task: "Fix the status",
      version: "2026-08-12.2",
    });
  });

  test("parses a live user message with its transport timestamp", () => {
    expect(parseOmgPromptEnvelope(`[2026-08-14T02:32:05.580Z] ${contract}`)).toEqual({
      instructions: "- Use the omg.dev tools.",
      task: "Fix the status",
      version: "2026-08-12.2",
    });
  });

  test("does not parse prose that quotes a contract", () => {
    expect(parseOmgPromptEnvelope(`Please inspect this: ${contract}`)).toBeNull();
  });

  test("includes standing instructions in the inspect chip, not the task", () => {
    const withStanding = [
      "=== omg.dev RUNTIME CONTRACT (capability version 2026-08-21.1) ===",
      "- Use the omg.dev tools.",
      "=== END omg.dev RUNTIME CONTRACT ===",
      "",
      "=== USER STANDING INSTRUCTIONS ===",
      "Always reply in points.",
      "=== END USER STANDING INSTRUCTIONS ===",
      "",
      "=== USER TASK ===",
      "Fix the status",
    ].join("\n");
    expect(parseOmgPromptEnvelope(withStanding)).toEqual({
      instructions: [
        "- Use the omg.dev tools.",
        "",
        "=== USER STANDING INSTRUCTIONS ===",
        "Always reply in points.",
        "=== END USER STANDING INSTRUCTIONS ===",
      ].join("\n"),
      task: "Fix the status",
      version: "2026-08-21.1",
    });
  });
  test("keeps the first-run rules in the inspect chip, not in the user's first message", () => {
    // Production shape (2026-10-11): the first-run envelope sits after the
    // contract's USER TASK and ends with its own USER TASK. Before this fix the
    // new user's first bubble read "=== omg.dev FIRST RUN === This session is…".
    const firstRun = [
      "=== omg.dev RUNTIME CONTRACT (capability version 2026-10-07.1) ===",
      "- Use the omg.dev tools.",
      "=== END omg.dev RUNTIME CONTRACT ===",
      "=== USER TASK ===",
      "=== omg.dev FIRST RUN ===",
      "This session is a new user's first task on omg.dev.",
      "=== USER TASK ===",
      "A personal to-do app with work projects.",
    ].join("\n");
    const parsed = parseOmgPromptEnvelope(firstRun);
    expect(parsed?.task).toBe("A personal to-do app with work projects.");
    expect(parsed?.instructions).toContain("=== omg.dev FIRST RUN ===");
    expect(parsed?.instructions).toContain("- Use the omg.dev tools.");
  });

  test("leaves a task that only mentions the first-run header as the task", () => {
    const quoted = `${contract.replace("Fix the status", "Why do I see === omg.dev FIRST RUN === here?")}`;
    expect(parseOmgPromptEnvelope(quoted)?.task).toBe("Why do I see === omg.dev FIRST RUN === here?");
  });
});
