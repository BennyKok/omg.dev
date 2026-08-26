import { describe, expect, test } from "bun:test";
import type { PersistentBot } from "../App";
import {
  pausedProviderErrorDetail,
  projectFaviconSrc,
  resolveSessionHeaderIdentity,
} from "./session-ui";

// A mobile bot conversation's header used to always wear the harness's agent
// mark (e.g. the Claude/Codex icon), even for a session driven by a bot with
// its own configured avatar. resolveSessionHeaderIdentity is the single
// branch both the session card header and the mobile session sheet header
// render from, so this pins the branch order directly instead of relying on
// a full component render.

function bot(overrides: Partial<PersistentBot> = {}): PersistentBot {
  return {
    id: "bot-1",
    name: "Engineer",
    persona: "You fix bugs.",
    agent: "aisdk",
    enabled: true,
    createdAt: 0,
    ...overrides,
  };
}

describe("resolveSessionHeaderIdentity", () => {
  test("a bot-driven session whose bot has resolved wears the bot's own avatar", () => {
    const engineer = bot();
    const directory = new Map([[engineer.id, engineer]]);
    const identity = resolveSessionHeaderIdentity({ botId: engineer.id }, directory);
    expect(identity).toEqual({ kind: "bot", bot: engineer });
  });

  test("a bot-driven session whose bot hasn't resolved yet gets a neutral loading state, not the agent icon", () => {
    const directory = new Map<string, PersistentBot>();
    const identity = resolveSessionHeaderIdentity({ botId: "still-loading" }, directory);
    expect(identity).toEqual({ kind: "bot-loading" });
  });

  test("a session with no bot at all falls back to the harness agent icon", () => {
    const directory = new Map([["some-bot", bot()]]);
    const identity = resolveSessionHeaderIdentity({ botId: null }, directory);
    expect(identity).toEqual({ kind: "agent" });
  });

  test("a bot-driven session never resolves against the wrong bot in a populated directory", () => {
    const engineer = bot({ id: "bot-1", name: "Engineer" });
    const designer = bot({ id: "bot-2", name: "Designer" });
    const directory = new Map([
      [engineer.id, engineer],
      [designer.id, designer],
    ]);
    const identity = resolveSessionHeaderIdentity({ botId: designer.id }, directory);
    expect(identity).toEqual({ kind: "bot", bot: designer });
  });
});

describe("pausedProviderErrorDetail", () => {
  test("does not label a Claude Code failure as an OpenCode failure", () => {
    const detail = pausedProviderErrorDetail({
      agent: "aisdk",
      statusDetail: "Claude Code returned an error result: No conversation found",
    });

    expect(detail).toContain("Claude Code returned an error result");
    expect(detail).toContain("Retry the session or switch models.");
    expect(detail).not.toContain("OpenCode");
  });

  test("keeps the OpenCode-specific recovery hint for OpenCode sessions", () => {
    const detail = pausedProviderErrorDetail({
      agent: "opencode",
      statusDetail: "OpenCode turn failed",
    });

    expect(detail).toContain("Check the OpenCode provider logs or switch models.");
  });
});

describe("projectFaviconSrc", () => {
  test("addresses the project by its encoded identity, never by a local path", () => {
    expect(projectFaviconSrc("my app/日本語")).toBe(
      "/api/repos/favicon?project=my%20app%2F%E6%97%A5%E6%9C%AC%E8%AA%9E",
    );
    expect(projectFaviconSrc("  ")).toBeNull();
  });
});
