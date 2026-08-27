import { describe, expect, test } from "bun:test";
import {
  clearSessionUnread,
  sameUnreadSessions,
  sessionRosterRowAriaLabel,
  sessionRosterTooltip,
  unreadSessionIds,
} from "./session-unread";
import { UNREAD_DOT_CLASS } from "./unread";
import { BOT_UNREAD_DOT_CLASS } from "./bot-unread";

describe("session unread", () => {
  test("reads the ids a list payload marks unread", () => {
    const ids = unreadSessionIds([
      { sessionId: "a", unread: true },
      { sessionId: "b", unread: false },
      { sessionId: "c" },
      // A row with no id cannot be addressed, so it cannot be unread.
      { sessionId: null, unread: true },
    ]);
    expect([...ids]).toEqual(["a"]);
  });

  test("clearing keeps the same set when there was nothing to clear", () => {
    const unread = new Set(["a"]);
    expect(clearSessionUnread(unread, "b")).toBe(unread);
    expect([...clearSessionUnread(unread, "a")]).toEqual([]);
    // The original is not mutated: the roster still renders the old value
    // until React commits the new one.
    expect([...unread]).toEqual(["a"]);
  });

  test("equal sets compare equal so a poll does not re-render the roster", () => {
    expect(sameUnreadSessions(new Set(["a", "b"]), new Set(["b", "a"]))).toBe(true);
    expect(sameUnreadSessions(new Set(["a"]), new Set(["a", "b"]))).toBe(false);
    expect(sameUnreadSessions(new Set(["a"]), new Set(["b"]))).toBe(false);
    expect(sameUnreadSessions(new Set(), new Set())).toBe(true);
  });

  test("the row label states read state in words, not only in colour", () => {
    expect(sessionRosterRowAriaLabel({ title: "Robot Eend", working: false, unread: true }))
      .toBe("Robot Eend, idle, unread");
    expect(sessionRosterRowAriaLabel({ title: "Robot Eend", working: true, unread: false }))
      .toBe("Robot Eend, working, read");
    // Blocked outranks working: it is the state a person has to act on.
    expect(sessionRosterRowAriaLabel({ title: "Robot Eend", working: true, unread: true, blocked: true }))
      .toBe("Robot Eend, paused, unread");
  });

  test("the collapsed tooltip carries what the dot cannot say", () => {
    expect(sessionRosterTooltip("Robot Eend", true)).toBe("Robot Eend · unread");
    expect(sessionRosterTooltip("Robot Eend", false)).toBe("Robot Eend");
  });

  test("a session row and a bot row use one dot", () => {
    expect(BOT_UNREAD_DOT_CLASS).toBe(UNREAD_DOT_CLASS);
  });
});
