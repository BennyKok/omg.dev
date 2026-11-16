import { describe, expect, test } from "bun:test";
import { classifySystemMessage, classifyUserTurn } from "./system-message";

describe("classifyUserTurn", () => {
  test("splits the launch envelope before classifying a fork opener", () => {
    const task = [
      "You are starting a fresh agent session from an existing omg.dev session.",
      "",
      "Source session id: 542a7801-118e-4740-a8df-eb9b1ded1fd5",
      "Source title: Icons",
      "",
      "User's extra prompt:",
      "Finish the picker.",
    ].join("\n");
    const wrapped = [
      "=== omg.dev RUNTIME CONTRACT (capability version 2026-08-12.2) ===",
      "- Use the omg.dev tools.",
      "=== END omg.dev RUNTIME CONTRACT ===",
      "=== USER TASK ===",
      task,
    ].join("\n");
    expect(classifySystemMessage(wrapped)).toBeNull();
    expect(classifyUserTurn(wrapped)).toEqual(classifySystemMessage(task));
    expect(classifyUserTurn(wrapped)?.label).toBe("Started from Icons");
  });
});

describe("systemMessagePreview markdown", () => {
  test("drops markdown marks so the preview reads as prose", () => {
    const { systemMessagePreview } = require("./system-message");
    const body = "Done.\n\n## What changed\n- Re-rendered **6 screenshots**\n- Updated `public/shots/`\n\n| Page | Status |\n| --- | --- |\n| Home | done |";
    expect(systemMessagePreview(body)).toBe(
      "Done. What changed Re-rendered 6 screenshots Updated public/shots/ Page · Status Home · done",
    );
  });
});
