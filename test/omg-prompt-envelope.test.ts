import { describe, expect, test } from "bun:test";
import { parseOmgPromptEnvelope } from "../web/src/lib/omg-prompt-envelope";

describe("parseOmgPromptEnvelope", () => {
  test("separates omg.dev instructions from the user's task", () => {
    expect(
      parseOmgPromptEnvelope(
        [
          "=== omg.dev RUNTIME CONTRACT (capability version 2026-08-12.2) ===",
          "- Narrate progress.",
          "- Ship verified work.",
          "=== END omg.dev RUNTIME CONTRACT ===",
          "",
          "=== USER TASK ===",
          "Make the first message easy to read.",
        ].join("\n"),
      ),
    ).toEqual({
      instructions: "- Narrate progress.\n- Ship verified work.",
      task: "Make the first message easy to read.",
      version: "2026-08-12.2",
    });
  });

  // Pre-rename transcripts are re-rendered every time an old session is opened,
  // so every legacy header has to keep parsing indefinitely.
  test("separates pre-rename OMG instructions from the user's task", () => {
    expect(
      parseOmgPromptEnvelope(
        [
          "=== OMG RUNTIME CONTRACT (capability version 2026-08-08.1) ===",
          "- Narrate progress.",
          "- Ship verified work.",
          "=== END OMG RUNTIME CONTRACT ===",
          "",
          "=== USER TASK ===",
          "Make the first message easy to read.",
        ].join("\n"),
      ),
    ).toEqual({
      instructions: "- Narrate progress.\n- Ship verified work.",
      task: "Make the first message easy to read.",
      version: "2026-08-08.1",
    });
  });

  test("separates pre-rename LFG instructions from the user's task", () => {
    expect(
      parseOmgPromptEnvelope(
        [
          "=== LFG RUNTIME CONTRACT (capability version 2026-08-04.1) ===",
          "- Narrate progress.",
          "- Ship verified work.",
          "=== END LFG RUNTIME CONTRACT ===",
          "",
          "=== USER TASK ===",
          "Make the first message easy to read.",
        ].join("\n"),
      ),
    ).toEqual({
      instructions: "- Narrate progress.\n- Ship verified work.",
      task: "Make the first message easy to read.",
      version: "2026-08-04.1",
    });
  });

  test("leaves ordinary and malformed messages alone", () => {
    expect(parseOmgPromptEnvelope("Just a normal follow-up")).toBeNull();
    expect(parseOmgPromptEnvelope("=== LFG RUNTIME CONTRACT ===\nNo closing marker")).toBeNull();
  });

  test("includes standing instructions in the inspect chip, not the task", () => {
    expect(
      parseOmgPromptEnvelope(
        [
          "=== omg.dev RUNTIME CONTRACT (capability version 2026-08-21.1) ===",
          "- Narrate progress.",
          "=== END omg.dev RUNTIME CONTRACT ===",
          "",
          "=== USER STANDING INSTRUCTIONS ===",
          "Always reply in points.",
          "=== END USER STANDING INSTRUCTIONS ===",
          "",
          "=== USER TASK ===",
          "Make the first message easy to read.",
        ].join("\n"),
      ),
    ).toEqual({
      instructions: [
        "- Narrate progress.",
        "",
        "=== USER STANDING INSTRUCTIONS ===",
        "Always reply in points.",
        "=== END USER STANDING INSTRUCTIONS ===",
      ].join("\n"),
      task: "Make the first message easy to read.",
      version: "2026-08-21.1",
    });
  });
});
