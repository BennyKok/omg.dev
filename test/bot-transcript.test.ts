import { describe, expect, test } from "bun:test";
import {
  botVisibleUserText,
  isBotHiddenLogKind,
  isBotLaunchOnlyText,
  isSubagentUpdateText,
  stripBotLaunchEnvelope,
} from "../web/src/lib/bot-transcript";

const CONTRACT = [
  "=== omg.dev BOT RUNTIME CONTRACT (capability version 2026-08-12.2) ===",
  "- You are Scout, a named persistent bot in an ongoing conversation.",
  "- Your persona is: Friendly and concise.",
  "- Reply to the human through normal assistant messages.",
  "- Do not use `omg_ship` for this conversation. Do not close this session.",
  "- An attributed message follows this contract. Reply to it now, in character, as your first turn.",
  "=== END omg.dev BOT RUNTIME CONTRACT ===",
].join("\n");

const SUMMARY = [
  "=== PRIOR CONVERSATION SUMMARY ===",
  "user: what changed today",
  "assistant: two releases went out",
  "=== END PRIOR CONVERSATION SUMMARY ===",
].join("\n");

describe("bot chat transcript visibility", () => {
  test("an empty launch turn is pure plumbing and stays hidden", () => {
    expect(isBotLaunchOnlyText(CONTRACT)).toBe(true);
    expect(isBotLaunchOnlyText(`${CONTRACT}\n\n${SUMMARY}`)).toBe(true);
    expect(stripBotLaunchEnvelope(CONTRACT)).toBe("");
  });

  // The regression this file exists for: the first message is bundled into the
  // launch prompt on purpose (sending it separately raced the boot and the bot
  // answered neither). Dropping the whole launch turn therefore erased the
  // human's own opening line, and the chat began with a reply to nothing.
  test("a launch turn carrying the first message is a real turn", () => {
    const launch = `${CONTRACT}\n\n[Message from benny@example.com to bot Scout]\n\nHey Scout! Who are you?`;
    expect(isBotLaunchOnlyText(launch)).toBe(false);
    expect(botVisibleUserText(launch)).toBe("Hey Scout! Who are you?");
  });

  test("a relaunch keeps the message and drops the summary", () => {
    const launch = `${CONTRACT}\n\n${SUMMARY}\n\n[Message from benny@example.com to bot Scout]\n\nstill there?`;
    expect(isBotLaunchOnlyText(launch)).toBe(false);
    expect(botVisibleUserText(launch)).toBe("still there?");
  });

  test("ordinary turns lose only their attribution wrapper", () => {
    expect(botVisibleUserText("[Message from benny@example.com to bot Scout]\n\nping")).toBe("ping");
    expect(botVisibleUserText("no wrapper here")).toBe("no wrapper here");
  });

  test("outside a bot chat the raw text is untouched", () => {
    const launch = `${CONTRACT}\n\n[Message from benny@example.com to bot Scout]\n\nping`;
    expect(botVisibleUserText(launch, false)).toBe(launch);
  });
});

// Heavy work belongs in a background task session, and that session reports
// home with the markers from the subagent operating contract. Those reports
// land on the bot's session as user turns — i.e. in the human's chat, looking
// like the human wrote them. They are machinery; the bot's own next message is
// the part meant to be read.
describe("background task updates in a bot chat", () => {
  test("recognises every terminal state and progress", () => {
    for (const marker of ["progress", "complete", "blocked", "failed"]) {
      expect(isSubagentUpdateText(`[subagent ${marker}] rebased onto main, 3 tests fixed`)).toBe(true);
    }
    // Leading whitespace and casing come from whichever harness wrote it.
    expect(isSubagentUpdateText("  [Subagent Complete] done")).toBe(true);
  });

  test("leaves the human's own words alone", () => {
    expect(isSubagentUpdateText("can you check on the subagent progress?")).toBe(false);
    expect(isSubagentUpdateText("[subagent] no state")).toBe(false);
    expect(isSubagentUpdateText("")).toBe(false);
    // A marker quoted mid-sentence is the human talking about one, not one reporting.
    expect(isSubagentUpdateText("it said [subagent failed] and then stopped")).toBe(false);
  });
});

// A bot chat is a conversation, not a log. The full log still exists — the
// bot's session opens as an ordinary session — but the chat view does not
// narrate the mechanics of being answered.
describe("what a bot chat hides", () => {
  test("tool calls, their results, and reasoning are machinery", () => {
    expect(isBotHiddenLogKind("tool_use")).toBe(true);
    expect(isBotHiddenLogKind("tool_result")).toBe(true);
    expect(isBotHiddenLogKind("thinking")).toBe(true);
  });

  test("what the bot actually handed you stays", () => {
    // Text is the reply; media and artifacts are replies the bot chose to send
    // as something other than words.
    expect(isBotHiddenLogKind("text")).toBe(false);
    expect(isBotHiddenLogKind("image")).toBe(false);
    expect(isBotHiddenLogKind("video")).toBe(false);
    expect(isBotHiddenLogKind("html")).toBe(false);
    // An unkinded message is a plain turn, not machinery.
    expect(isBotHiddenLogKind(undefined)).toBe(false);
    expect(isBotHiddenLogKind("")).toBe(false);
  });
});
