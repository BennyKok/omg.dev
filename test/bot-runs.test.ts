// One face per run of bot turns.
//
// A bot chat gives bot turns a bubble so it reads as a conversation rather than
// a log. Stamping the avatar on every bubble undoes that: a column of faces
// reads as several speakers, not one bot saying several things. So the avatar
// marks where the bot *starts* talking, and everything it says after that lines
// up against a spacer until the human speaks again.
import { describe, expect, test } from "bun:test";

import { botRunAvatarKeys, isBotBubbleMessage } from "../web/src/lib/bot-runs";

function msg(key: string, role: string, kind = "text") {
  return { type: "msg", key, message: { role, kind } };
}

describe("bot bubble runs", () => {
  test("the first bot turn after a user turn carries the face", () => {
    const keys = botRunAvatarKeys([
      msg("u1", "user"),
      msg("a1", "assistant"),
      msg("a2", "assistant"),
      msg("u2", "user"),
      msg("a3", "assistant"),
    ]);
    expect([...keys]).toEqual(["a1", "a3"]);
  });

  test("a bot opening the conversation still starts a run", () => {
    // Relaunch continuity, a background report answered before the human said
    // anything: the transcript can begin with the bot.
    expect([...botRunAvatarKeys([msg("a1", "assistant"), msg("a2", "assistant")])])
      .toEqual(["a1"]);
  });

  test("tool work does not break a run", () => {
    // The bot answering, looking something up, then finishing the thought is
    // still one bot talking — only the human starts a new run.
    const keys = botRunAvatarKeys([
      msg("u1", "user"),
      msg("a1", "assistant"),
      { type: "tools", key: "t1", items: [] } as never,
      msg("a2", "assistant"),
    ]);
    expect([...keys]).toEqual(["a1"]);
  });

  test("only text turns get a bubble", () => {
    // Thinking blocks, media and artifacts own their own presentation; wrapping
    // them would put a card inside a card.
    expect(isBotBubbleMessage({ role: "assistant", kind: "text" })).toBe(true);
    expect(isBotBubbleMessage({ role: "assistant" })).toBe(true);
    expect(isBotBubbleMessage({ role: "assistant", kind: "thinking" })).toBe(false);
    expect(isBotBubbleMessage({ role: "assistant", kind: "image" })).toBe(false);
    expect(isBotBubbleMessage({ role: "user", kind: "text" })).toBe(false);
    expect(isBotBubbleMessage(undefined)).toBe(false);

    // A thinking block between two text turns is not a bubble, so it neither
    // opens a run nor closes one.
    const keys = botRunAvatarKeys([
      msg("a1", "assistant", "thinking"),
      msg("a2", "assistant"),
      msg("a3", "assistant"),
    ]);
    expect([...keys]).toEqual(["a2"]);
  });
});
