import { describe, expect, test } from "bun:test";

import { isMachineryPreviewText, isRequestInterruptedMessage } from "./transcript-status";

describe("isMachineryPreviewText", () => {
  // Each of these was seen leaking into a session row's preview, where the row
  // is supposed to show the last thing a person or an agent actually said.
  test("catches the synthetic turns the transcript records for bookkeeping", () => {
    for (const text of [
      "[Request interrupted by user]",
      "[Request interrupted by user for tool use]",
      "[ask-user answer 4f2a91bc] Their reply: Yes, update it",
      "[subagent progress] Starting work on the rail",
      "[subagent complete]",
      "[Peer message from A (a) to B (b)] ping",
      "[Message from itechbenny@gmail.com to bot iOS Manager] try again",
      "[Image: original 1260x2736, displayed at 921x2000]",
    ]) {
      expect(isMachineryPreviewText(text), text).toBe(true);
    }
  });

  // A scheduled routine's turn carries the prompt it ran, so it IS the content
  // of that turn rather than plumbing around it.
  test("leaves a scheduled routine alone", () => {
    expect(
      isMachineryPreviewText("[Scheduled routine: App Store review watch] Check whether…"),
    ).toBe(false);
  });

  test("leaves ordinary text alone, including text that merely starts bracketed", () => {
    for (const text of [
      "Deployed and verified live on omg.dev.",
      "[tentatively] I think the rail is fine now",
      "",
      undefined,
    ]) {
      expect(isMachineryPreviewText(text), String(text)).toBe(false);
    }
  });

  test("matches regardless of surrounding whitespace", () => {
    expect(isMachineryPreviewText("  [Request interrupted by user]  ")).toBe(true);
  });
});

describe("isRequestInterruptedMessage", () => {
  // Narrower than the preview filter on purpose: this one decides whether to
  // draw the "Interrupted" divider, so it must match the whole turn and only a
  // synthetic user turn — not an assistant quoting the marker back.
  test("only matches a synthetic user turn that is exactly the marker", () => {
    expect(
      isRequestInterruptedMessage({ role: "user", kind: "text", text: "[Request interrupted by user]" }),
    ).toBe(true);
    expect(
      isRequestInterruptedMessage({
        role: "assistant",
        kind: "text",
        text: "[Request interrupted by user]",
      }),
    ).toBe(false);
    expect(
      isRequestInterruptedMessage({
        role: "user",
        kind: "text",
        text: "[Request interrupted by user] and then I typed more",
      }),
    ).toBe(false);
  });
});
