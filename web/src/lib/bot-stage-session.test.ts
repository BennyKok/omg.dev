import { describe, expect, test } from "bun:test";

import { botDetachedSession, botStageSession } from "./bot-session";

// The reported bug: the Engineer bot's roster row resolved a real canonical
// sessionId, but the desktop stage column read that session's own `botId`
// field to decide whether to render the bot's avatar/composer or the plain
// harness header — and a session found by id alone does not always carry it
// yet (or ever, for the documented "saved id, nothing live matches" case).
// botStageSession is the guard: the picker already knows which bot the
// column belongs to, so it must not let the raw record's missing `botId`
// erase that.
describe("botStageSession", () => {
  const engineer = { id: "bot-engineer", name: "Engineer" };

  test("stamps identity onto a canonical session the record never tagged", () => {
    const session = { sessionId: "s1" };

    expect(botStageSession(engineer, session)).toEqual({
      sessionId: "s1",
      botId: "bot-engineer",
      botName: "Engineer",
    });
  });

  test("leaves an already-correctly-tagged session untouched (no-op)", () => {
    const session = { sessionId: "s1", botId: "bot-engineer", botName: "Engineer" };

    expect(botStageSession(engineer, session)).toBe(session);
  });

  // Reload / deep link and switching between bots both resolve straight to
  // whatever the roster or the URL names; both must render correctly with no
  // extra state carried over from a prior selection.
  test("stamps identity the same way on a fresh reload/deep-link lookup", () => {
    const session = { sessionId: "s1", title: "Engineer" };

    expect(botStageSession(engineer, session).botId).toBe("bot-engineer");
  });

  test("switching to a second bot stamps the second bot's identity, not the first's", () => {
    const improver = { id: "bot-improver", name: "Bot Improver" };
    const engineerSession = botStageSession(engineer, { sessionId: "s1" });
    const improverSession = botStageSession(improver, { sessionId: "s2" });

    expect(engineerSession.botId).toBe("bot-engineer");
    expect(improverSession.botId).toBe("bot-improver");
  });

  // An already-open regular chat that happens to share a sessionId with what
  // a bot's canonical resolution named is a real conflict (or, after the
  // src/bots/session.ts hardening, should no longer be handed back at all) —
  // it must be surfaced honestly, never silently relabelled as this bot's.
  test("never overwrites a session already tagged with a different bot's id", () => {
    const session = { sessionId: "s1", botId: "bot-other", botName: "Other Bot" };

    expect(botStageSession(engineer, session)).toBe(session);
  });
});

describe("botDetachedSession", () => {
  // A bot's transcript is filed on disk under its conversation id and outlives
  // the process that wrote it. The desktop stage used to render nothing for a
  // conversation the live session list did not carry, which fell through to the
  // "say hi" placeholder: a bot with months of history looked brand new.
  test("carries the id the transcript is filed under", () => {
    const session = botDetachedSession(
      { id: "bot", name: "Scout", agent: "claude", model: "opus", cwd: "/repo" },
      "conv-1",
    );
    expect(session.sessionId).toBe("conv-1");
  });

  test("wears the bot's own identity, not an unknown session's", () => {
    const session = botDetachedSession(
      { id: "bot", name: "Scout", agent: "claude" },
      "conv-1",
    );
    expect(session.botId).toBe("bot");
    expect(session.botName).toBe("Scout");
    expect(session.title).toBe("Scout");
    expect(session.managed).toBe(true);
  });
});
