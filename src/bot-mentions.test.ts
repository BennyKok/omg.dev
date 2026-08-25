import { describe, expect, test } from "bun:test";
import {
  formatBotMentionToken,
  parseBotMentions,
  sanitizeMentionLabel,
} from "./bots/mention-token.ts";
import { dispatchBotMentions, resolveBotMentions } from "./bots/mentions.ts";
import type { Bot } from "./bots/store.ts";

function bot(id: string, over: Partial<Bot> = {}): Bot {
  return {
    id,
    name: id,
    persona: "p",
    agent: "claude",
    enabled: true,
    createdAt: 0,
    ...over,
  } as Bot;
}

describe("the mention token", () => {
  test("round-trips id and label", () => {
    const token = formatBotMentionToken("bot_1234abcd", "Research Bot");
    expect(token).toBe("[@Research Bot](omg:bot_1234abcd)");
    expect(parseBotMentions(token)).toEqual([
      { botId: "bot_1234abcd", label: "Research Bot" },
    ]);
  });

  test("a name cannot break the token open", () => {
    expect(sanitizeMentionLabel("Ops (staging) [eu]")).toBe("Ops staging eu");
    const token = formatBotMentionToken("bot_1234abcd", "a]b(c)");
    expect(parseBotMentions(token)).toHaveLength(1);
  });

  test("an empty name falls back to the id, keeping the token valid", () => {
    const token = formatBotMentionToken("bot_1234abcd", "   ");
    expect(parseBotMentions(token)).toEqual([
      { botId: "bot_1234abcd", label: "bot_1234abcd" },
    ]);
  });

  test("the same bot tagged twice delivers once", () => {
    const t = formatBotMentionToken("bot_1234abcd", "A");
    expect(parseBotMentions(`${t} and again ${t}`)).toHaveLength(1);
  });

  test("order follows first appearance", () => {
    const text = `${formatBotMentionToken("bot_bbbbbbbb", "B")} ${formatBotMentionToken("bot_aaaaaaaa", "A")}`;
    expect(parseBotMentions(text).map((m) => m.botId)).toEqual([
      "bot_bbbbbbbb",
      "bot_aaaaaaaa",
    ]);
  });

  test("plain text and lookalikes parse to nothing", () => {
    expect(parseBotMentions("no mentions here")).toEqual([]);
    expect(parseBotMentions("@Research Bot")).toEqual([]);
    expect(parseBotMentions("[@A](omg:bot_ZZZZ)")).toEqual([]);
    expect(parseBotMentions("[@A](https://omg.dev/bot_1234abcd)")).toEqual([]);
    expect(parseBotMentions("")).toEqual([]);
  });
});

describe("resolveBotMentions", () => {
  const roster = [
    bot("bot_1234abcd", { name: "Research" }),
    bot("bot_2234abcd", { name: "Off", enabled: false }),
    bot("bot_3234abcd", { name: "Rot", rotationState: "rotating" }),
    bot("bot_4234abcd", { name: "Me" }),
  ];
  const tag = (id: string) => formatBotMentionToken(id, "x");

  test("delivers to an enabled bot", () => {
    const { targets, skipped } = resolveBotMentions(tag("bot_1234abcd"), roster);
    expect(targets.map((t) => t.bot.id)).toEqual(["bot_1234abcd"]);
    expect(skipped).toEqual([]);
  });

  test("skips an unknown id rather than inventing a target", () => {
    const { targets, skipped } = resolveBotMentions(tag("bot_9999ffff"), roster);
    expect(targets).toEqual([]);
    expect(skipped[0].reason).toBe("unknown");
  });

  test("skips a disabled bot, which cannot take a turn", () => {
    expect(resolveBotMentions(tag("bot_2234abcd"), roster).skipped[0].reason).toBe("disabled");
  });

  test("skips a bot mid-rotation", () => {
    expect(resolveBotMentions(tag("bot_3234abcd"), roster).skipped[0].reason).toBe("rotating");
  });

  test("a failed config rotation blocks, a failed restart does not", () => {
    const blocked = [bot("bot_5234abcd", { rotationState: "failed", rotationReason: "config" })];
    const fine = [bot("bot_5234abcd", { rotationState: "failed", rotationReason: "restart" })];
    expect(resolveBotMentions(tag("bot_5234abcd"), blocked).skipped[0].reason).toBe("rotating");
    expect(resolveBotMentions(tag("bot_5234abcd"), fine).targets).toHaveLength(1);
  });

  test("a bot cannot tag itself into a loop", () => {
    const { targets, skipped } = resolveBotMentions(tag("bot_4234abcd"), roster, {
      selfBotId: "bot_4234abcd",
    });
    expect(targets).toEqual([]);
    expect(skipped[0].reason).toBe("self");
  });

  test("no mentions means no work", () => {
    expect(resolveBotMentions("just a message", roster)).toEqual({ targets: [], skipped: [] });
  });
});

describe("dispatchBotMentions", () => {
  const target = { mention: { botId: "bot_1234abcd", label: "A" }, bot: bot("bot_1234abcd") };

  test("records participation before delivering", async () => {
    const order: string[] = [];
    const out = await dispatchBotMentions([target], "conv_1", {
      addParticipant: () => void order.push("participant"),
      attribute: () => "text",
      deliver: async () => void order.push("deliver"),
    });
    expect(order).toEqual(["participant", "deliver"]);
    expect(out[0].delivered).toBe(true);
  });

  test("an error from the delivery owner is reported, not thrown", async () => {
    const out = await dispatchBotMentions([target], "conv_1", {
      addParticipant: () => {},
      attribute: () => "text",
      deliver: async () => ({ error: "failed to start bot session" }),
    });
    expect(out[0]).toMatchObject({
      delivered: false,
      reason: "delivery-failed",
      error: "failed to start bot session",
    });
  });

  test("a thrown error is contained so one bot cannot fail the send", async () => {
    const out = await dispatchBotMentions(
      [target, { mention: { botId: "bot_7234abcd", label: "B" }, bot: bot("bot_7234abcd") }],
      "conv_1",
      {
        addParticipant: () => {},
        attribute: () => "text",
        deliver: async (b) => {
          if (b.id === "bot_1234abcd") throw new Error("boom");
        },
      },
    );
    expect(out[0]).toMatchObject({ delivered: false, error: "boom" });
    expect(out[1].delivered).toBe(true);
  });

  test("a session with no conversation still delivers", async () => {
    let added = 0;
    const out = await dispatchBotMentions([target], undefined, {
      addParticipant: () => void added++,
      attribute: () => "text",
      deliver: async () => {},
    });
    expect(added).toBe(0);
    expect(out[0].delivered).toBe(true);
  });
});
