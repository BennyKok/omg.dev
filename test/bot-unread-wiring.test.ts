import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const APP = readFileSync(new URL("../web/src/App.tsx", import.meta.url), "utf8");
const SERVE = readFileSync(new URL("../src/commands/serve.ts", import.meta.url), "utf8");

describe("bot unread surface wiring", () => {
  test("the shared mobile and desktop toggle exposes one aggregate status", () => {
    expect(APP).toContain('aria-label="Bots have unread conversations"');
    expect(APP).toContain("hasUnreadBotConversation(botConversations)");
  });

  test("the mobile switch stays on the conversation list and out of an open bot chat", () => {
    expect(APP).toContain("shouldShowMobileSurfaceToggle(isMobile, tab, selectedBotId)");
  });

  // Desktop regressed here once: an earlier revision copied the mobile
  // `selectedBotId` guard onto the desktop rail's own SurfaceToggle mount.
  // Unlike the mobile full-screen chat, the desktop rail is never replaced by
  // an open bot conversation — it keeps showing the roster — so that guard
  // hid the switch with no way back to Chat. See
  // test/desktop-rail-switch-bar.test.ts for the focused regression coverage.
  test("the desktop rail's switch is never gated on selectedBotId", () => {
    expect(APP).not.toMatch(/\{!selectedBotId\s*\?\s*\(\s*<SurfaceToggle/);
  });

  test("the mobile roster and desktop rail render conversation rows and accessible dots", () => {
    expect(APP.match(/botConversationRows\(bots, sessions/g)?.length).toBeGreaterThanOrEqual(3);
    expect(APP.match(/Unread conversation with/g)?.length).toBeGreaterThanOrEqual(2);
  });

  test("selection marks one server conversation and websocket arrivals refresh it", () => {
    expect(APP).toContain("/api/bot-conversations/${encodeURIComponent(sessionId)}/read");
    expect(APP).toContain("botConversationSubscriptionIds(botConversations)");
    expect(APP).toContain("wsLiveStream.subscribeTranscript(sessionId");
    expect(SERVE).toContain('path.match(/^\\/api\\/bot-conversations\\/([^/]+)\\/read$/)');
  });
});
