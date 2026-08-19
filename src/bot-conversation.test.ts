// A bot's conversation outlives its processes.
//
// The transcript read model is keyed on this id (`lfg://session/<id>`), so
// minting a fresh one on relaunch did not attach a new process to the same
// chat — it started a different chat. That is the whole reason a bot that died
// came back with nothing to show.
import { describe, expect, test } from "bun:test";

import { botConversationId } from "./bots/store.ts";

describe("the id a relaunched bot attaches to", () => {
  test("a bot that has been talked to keeps its conversation", () => {
    const mint = () => "newly-minted";
    expect(botConversationId({ sessionId: "93b246d0-a0f1-4beb-a22c-d64a6f1f7436" }, mint))
      .toBe("93b246d0-a0f1-4beb-a22c-d64a6f1f7436");
  });

  test("a bot nobody has talked to yet mints exactly one", () => {
    let minted = 0;
    const mint = () => `minted-${++minted}`;
    expect(botConversationId({}, mint)).toBe("minted-1");
    expect(botConversationId({ sessionId: "" }, mint)).toBe("minted-2");
    // Whitespace is not an id — a blank field is a bot that has never spoken.
    expect(botConversationId({ sessionId: "   " }, mint)).toBe("minted-3");
  });

  test("minting is not consulted when there is a conversation to return to", () => {
    let called = 0;
    botConversationId({ sessionId: "abc" }, () => { called++; return "x"; });
    expect(called).toBe(0);
  });
});
