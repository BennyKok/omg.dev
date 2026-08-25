import { describe, expect, it } from "bun:test";
import {
  applyBotMention,
  botMentionAt,
  formatBotMention,
  matchBots,
  type MentionableBot,
} from "./bot-mention";

const BOTS: MentionableBot[] = [
  { id: "bot_00000001", name: "Research Bot", enabled: true },
  { id: "bot_00000002", name: "deploy", enabled: true },
  { id: "bot_00000003", name: "Retired", enabled: false },
  { id: "bot_00000004", name: "researcher-2", enabled: true },
];

describe("botMentionAt", () => {
  it("opens on a bare @ at the start", () => {
    expect(botMentionAt("@", 1)).toEqual({ start: 0, end: 1, query: "" });
  });

  it("opens on @ after whitespace and captures the query", () => {
    expect(botMentionAt("hey @res", 8)).toEqual({ start: 4, end: 8, query: "res" });
  });

  it("lowercases the query", () => {
    expect(botMentionAt("@ReS", 4)?.query).toBe("res");
  });

  it("does not trigger inside an email address", () => {
    expect(botMentionAt("mail me at benny@omg.dev", 24)).toBeNull();
  });

  it("does not trigger when @ is glued to a preceding word", () => {
    expect(botMentionAt("foo@bar", 7)).toBeNull();
  });

  it("closes once the query hits a space", () => {
    expect(botMentionAt("@research bot", 13)).toBeNull();
  });

  it("returns null without a caret", () => {
    expect(botMentionAt("@res", null)).toBeNull();
    expect(botMentionAt("@res", undefined)).toBeNull();
  });

  it("reads the trigger at the caret, not at the end of the text", () => {
    expect(botMentionAt("@re trailing text", 3)).toEqual({ start: 0, end: 3, query: "re" });
  });

  it("opens on a newline boundary", () => {
    expect(botMentionAt("line one\n@dep", 13)).toEqual({ start: 9, end: 13, query: "dep" });
  });
});

describe("matchBots", () => {
  it("returns every enabled bot for an empty query", () => {
    expect(matchBots(BOTS, "").map((b) => b.name)).toEqual([
      "Research Bot",
      "deploy",
      "researcher-2",
    ]);
  });

  it("never offers a disabled bot, which the API would reject", () => {
    expect(matchBots(BOTS, "retired")).toEqual([]);
  });

  it("matches case-insensitively", () => {
    expect(matchBots(BOTS, "DEPLOY").map((b) => b.id)).toEqual(["bot_00000002"]);
  });

  it("matches across spaces and punctuation in the name", () => {
    expect(matchBots(BOTS, "researchb").map((b) => b.name)).toEqual(["Research Bot"]);
  });

  it("ranks prefix matches ahead of substring matches", () => {
    const names = matchBots([
      { id: "a", name: "my-deploy-helper" },
      { id: "b", name: "deploy" },
    ], "deploy").map((b) => b.name);
    expect(names).toEqual(["deploy", "my-deploy-helper"]);
  });

  it("drops bots with a blank name", () => {
    expect(matchBots([{ id: "x", name: "   " }], "")).toEqual([]);
  });

  it("honours the limit", () => {
    const many = Array.from({ length: 20 }, (_, i) => ({ id: `b${i}`, name: `bot${i}` }));
    expect(matchBots(many, "", 3)).toHaveLength(3);
  });

  it("treats a missing enabled flag as usable", () => {
    expect(matchBots([{ id: "x", name: "ghost" }], "ghost")).toHaveLength(1);
  });
});

describe("applyBotMention", () => {
  it("replaces the trigger and keeps the name verbatim", () => {
    const value = "hey @res";
    const active = botMentionAt(value, value.length)!;
    expect(applyBotMention(value, active, BOTS[0])).toEqual({
      value: "hey @Research Bot ",
      cursor: 18,
    });
  });

  it("preserves text after the caret and lands the caret before it", () => {
    const value = "@dep please ship";
    const active = botMentionAt(value, 4)!;
    const result = applyBotMention(value, active, BOTS[1]);
    expect(result.value).toBe("@deploy  please ship");
    expect(result.value.slice(result.cursor)).toBe(" please ship");
  });

  it("formats a tag with a single trailing space", () => {
    expect(formatBotMention(BOTS[1])).toBe("@deploy ");
  });
});
