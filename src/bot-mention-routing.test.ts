import { describe, expect, test } from "bun:test";

const SERVE = await Bun.file(new URL("./commands/serve.ts", import.meta.url)).text();

const SEND_ROUTE = (() => {
  const start = SERVE.indexOf('/^\\/api\\/sessions\\/([0-9a-fA-F-]{36})\\/send$/');
  expect(start).toBeGreaterThan(-1);
  const end = SERVE.indexOf("return json({ ok: true, msg: sentMsg", start);
  expect(end).toBeGreaterThan(start);
  return SERVE.slice(start, end);
})();

describe("mention fan-out on a session send", () => {
  test("it reuses the single delivery owner instead of a second send path", () => {
    expect(SEND_ROUTE).toContain("deliverBotMessage(bot, text)");
  });

  // Delivery and rotation both mutate bot.sessionId. Every other caller of
  // deliverBotMessage takes this critical section; a fan-out must too.
  test("each delivery takes the per-bot critical section", () => {
    const lock = SEND_ROUTE.indexOf("serializeBotWork(bot.id");
    expect(lock).toBeGreaterThan(-1);
    expect(SEND_ROUTE.indexOf("deliverBotMessage(bot, text)")).toBeGreaterThan(lock);
  });

  // A cold bot start takes seconds. Awaiting N of them would hold the send
  // response open for the person who typed the message.
  test("delivery does not block the send response", () => {
    expect(SEND_ROUTE).toContain("void dispatchBotMentions(");
  });

  // Two bots quoting each other's text would otherwise loop forever.
  test("only a human composer send fans out", () => {
    expect(SEND_ROUTE).toContain('!body?.fromSessionId && rawText.includes("](omg:bot_")');
  });

  // listBots() reads the whole bots file. An ordinary message must not pay it.
  test("a message with no tag does no bot work at all", () => {
    const guard = SEND_ROUTE.indexOf('rawText.includes("](omg:bot_")');
    expect(guard).toBeGreaterThan(-1);
    expect(SEND_ROUTE.indexOf("await listBots()")).toBeGreaterThan(guard);
  });

  test("the tagged bot joins the conversation without back-reading it", () => {
    expect(SEND_ROUTE).toContain("upsertConversationParticipant(");
    expect(SEND_ROUTE).toContain('historyAccess: "from_join"');
  });

  test("the delivered turn keeps the standard attribution line first", () => {
    expect(SEND_ROUTE).toContain("formatBotMentionAttribution(");
  });
});
