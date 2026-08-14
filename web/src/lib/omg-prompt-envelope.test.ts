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
});
