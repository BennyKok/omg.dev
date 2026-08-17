import { describe, expect, test } from "bun:test";
import {
  botVisibleUserText,
  isBotLaunchOnlyText,
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
