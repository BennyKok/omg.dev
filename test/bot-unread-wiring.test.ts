import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const APP = readFileSync(new URL("../web/src/App.tsx", import.meta.url), "utf8");
const SERVE = readFileSync(new URL("../src/commands/serve.ts", import.meta.url), "utf8");

describe("bot unread surface wiring", () => {
  test("the shared mobile and desktop toggle exposes one aggregate status", () => {
    expect(APP).toContain('aria-label="Bots have unread conversations"');
    expect(APP).toContain("hasUnreadBotConversation(botConversations)");
  });

  test("the switch stays on the conversation list and out of an open bot chat", () => {
    expect(APP).toContain("shouldShowMobileSurfaceToggle(isMobile, tab, selectedBotId)");
    expect(APP).toContain("{!selectedBotId ? (");
  });

  test("the mobile roster and desktop rail render conversation rows and accessible dots", () => {
    expect(APP.match(/botConversationRows\(bots, sessions/g)?.length).toBeGreaterThanOrEqual(3);
    expect(APP.match(/Unread conversation with/g)?.length).toBeGreaterThanOrEqual(2);
  });

  test("selection marks one server conversation and websocket arrivals refresh it", () => {
    expect(APP).toContain("/api/bot-conversations/${encodeURIComponent(sessionId)}/read");
    expect(APP).toContain("wsLiveStream.subscribeTranscript(conversation.sessionId");
    expect(SERVE).toContain('path.match(/^\\/api\\/bot-conversations\\/([^/]+)\\/read$/)');
  });
});
