import { describe, expect, test } from "bun:test";

import { classifySystemMessage, systemMessagePreview } from "../mobile/src/omg/system-message";

describe("classifySystemMessage", () => {
  test("a person's own words are not a system message", () => {
    expect(classifySystemMessage("Fix the login bug")).toBeNull();
    expect(classifySystemMessage("")).toBeNull();
    expect(classifySystemMessage(null)).toBeNull();
    // Brackets alone are not a marker.
    expect(classifySystemMessage("[1] first item")).toBeNull();
  });

  test("background task attribution names the child and keeps its id", () => {
    const out = classifySystemMessage(
      "[Background task ios app · 542a7801]\n\nExact shipping tip is 0964f06ea.",
    );
    expect(out).toEqual({
      kind: "background-task",
      label: "ios app reported in",
      id: "542a7801",
      body: "Exact shipping tip is 0964f06ea.",
    });
  });

  test("background task with only an id falls back to the generic label", () => {
    const out = classifySystemMessage("[Background task cde6c958]\n\ndone");
    expect(out?.label).toBe("Background task reported in");
    expect(out?.id).toBe("cde6c958");
  });

  test("bare subagent markers, old transcripts included", () => {
    expect(classifySystemMessage("[subagent complete] rebased onto main")?.label).toBe(
      "Background task completed",
    );
    expect(classifySystemMessage("[subagent progress] halfway")?.label).toBe(
      "Background task reported in",
    );
    expect(classifySystemMessage("[subagent blocked] need a token")?.kind).toBe("subagent");
    expect(classifySystemMessage("[subagent failed] tests red")?.label).toBe(
      "Background task failed",
    );
  });

  test("peer bot message", () => {
    const out = classifySystemMessage(
      "[Peer message from Scout (bot_1a2b3c4d5e) to Angel (bot_9f8e7d6c5b)]\n\nnice try",
    );
    expect(out?.kind).toBe("peer");
    expect(out?.label).toBe("Message from Scout");
    expect(out?.body).toBe("nice try");
  });

  test("human to bot attribution", () => {
    const out = classifySystemMessage(
      "[Message from itechbenny@gmail.com to bot iOS Manager] try again",
    );
    expect(out?.kind).toBe("bot-message");
    expect(out?.label).toBe("Message from itechbenny@gmail.com to iOS Manager");
    expect(out?.body).toBe("try again");
  });

  test("answered omg_input question", () => {
    const out = classifySystemMessage(
      "[ask-user answer 4f2a9c1e-1111-2222-3333-444444444444] Their reply: ship it\n",
    );
    expect(out?.kind).toBe("ask-answer");
    expect(out?.id).toBe("4f2a9c1e");
    expect(out?.body).toBe("ship it");
  });

  test("fork and continue opener: label names the source, body is the extra prompt", () => {
    const out = classifySystemMessage(
      [
        "You are starting a fresh agent session from an existing lfg session.",
        "",
        "This is NOT a resume. Treat the source transcript as read-only context, then follow the user's extra prompt below.",
        "",
        "Source session id: 542a7801-118e-4740-a8df-eb9b1ded1fd5",
        "Source title: Show coding agent icons",
        "Source cwd: /home/dev/lfg-worktrees/lfg-e7a545",
        "Source transcript JSONL: /tmp/x.jsonl",
        "",
        "Read the transcript file directly before acting.",
        "",
        "User's extra prompt:",
        "Finish the picker.",
      ].join("\n"),
    );
    expect(out?.kind).toBe("fork");
    expect(out?.label).toBe("Started from Show coding agent icons");
    expect(out?.id).toBe("542a7801");
    expect(out?.body).toBe("Finish the picker.");
  });

  test("rotation notices, all three reasons", () => {
    expect(
      classifySystemMessage(
        "[This conversation continues with your updated configuration. Earlier history is preserved and searchable.]",
      )?.label,
    ).toBe("Conversation continues with your updated configuration");
    expect(
      classifySystemMessage(
        "[This conversation continues after a runtime restart. Earlier history is preserved and searchable.]",
      )?.label,
    ).toBe("Conversation continues after a runtime restart");
    expect(
      classifySystemMessage(
        "[This conversation continues in a fresh context window. Earlier history is preserved and searchable.]",
      )?.kind,
    ).toBe("rotation");
  });

  test("scheduled routine keeps its prompt as the body", () => {
    const out = classifySystemMessage("[Scheduled routine: Morning check]\n\nLook at CI.");
    expect(out?.label).toBe("Routine Morning check ran");
    expect(out?.body).toBe("Look at CI.");
  });
});

test("systemMessagePreview flattens to one run of prose", () => {
  expect(systemMessagePreview("a\n\n  b\tc ")).toBe("a b c");
});
