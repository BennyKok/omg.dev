import { describe, expect, test } from "bun:test";

import { parseOmgPromptEnvelope } from "../mobile/src/omg/omg-prompt-envelope";
import { parseOmgPromptEnvelope as parseOnWeb } from "../web/src/lib/omg-prompt-envelope";

const SAMPLE = [
  "=== omg.dev RUNTIME CONTRACT (capability version 2026-08-12.2) ===",
  "- Narrate progress.",
  "- Ship verified work.",
  "=== END omg.dev RUNTIME CONTRACT ===",
  "",
  "=== USER TASK ===",
  "Make the first message easy to read.",
].join("\n");

describe("the phone splits the omg.dev launch envelope off a user message", () => {
  test("separates omg.dev instructions from the user's task", () => {
    expect(parseOmgPromptEnvelope(SAMPLE)).toEqual({
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
          "=== END OMG RUNTIME CONTRACT ===",
          "",
          "=== USER TASK ===",
          "Make the first message easy to read.",
        ].join("\n"),
      ),
    ).toEqual({
      instructions: "- Narrate progress.",
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
          "=== END LFG RUNTIME CONTRACT ===",
          "",
          "=== USER TASK ===",
          "Make the first message easy to read.",
        ].join("\n"),
      ),
    ).toEqual({
      instructions: "- Narrate progress.",
      task: "Make the first message easy to read.",
      version: "2026-08-04.1",
    });
  });

  test("leaves ordinary and malformed messages alone", () => {
    expect(parseOmgPromptEnvelope("Just a normal follow-up")).toBeNull();
    expect(parseOmgPromptEnvelope("=== LFG RUNTIME CONTRACT ===\nNo closing marker")).toBeNull();
  });

  // The two copies (web/src/lib/omg-prompt-envelope.ts and this one) exist
  // because mobile can't import from web/. This test is the tripwire: if a fix
  // lands on one side and not the other, an old-brand transcript renders
  // correctly on one platform and shows the raw contract on the other.
  test("stays in lockstep with the web parser", () => {
    expect(parseOmgPromptEnvelope(SAMPLE)).toEqual(parseOnWeb(SAMPLE));
    expect(parseOmgPromptEnvelope("Just a normal follow-up")).toEqual(
      parseOnWeb("Just a normal follow-up"),
    );
  });
});
