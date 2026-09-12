import { describe, expect, it } from "bun:test";
import {
  applySessionMention,
  sessionFolderName,
  sessionMentionAt,
  sessionMentionUrl,
} from "./session-mention";
import { parseSessionMentions } from "../../../src/session-mention-token.ts";

describe("sessionMentionAt", () => {
  it("opens on a bare # at the start", () => {
    expect(sessionMentionAt("#", 1)).toEqual({ start: 0, end: 1, query: "" });
  });

  it("opens after whitespace and lowercases the query", () => {
    expect(sessionMentionAt("see #Login", 10)).toEqual({ start: 4, end: 10, query: "login" });
  });

  it("does not trigger when # is glued to a preceding word", () => {
    expect(sessionMentionAt("issue#12", 8)).toBeNull();
  });

  it("closes once the query hits a space, so a markdown heading is left alone", () => {
    expect(sessionMentionAt("# Title", 7)).toBeNull();
  });

  it("reads the trigger at the caret, not at the end", () => {
    expect(sessionMentionAt("#lo trailing", 3)).toEqual({ start: 0, end: 3, query: "lo" });
  });

  it("returns null without a caret", () => {
    expect(sessionMentionAt("#x", null)).toBeNull();
  });
});

describe("sessionMentionUrl", () => {
  it("carries query, folder and the composer's own session", () => {
    expect(
      sessionMentionUrl("login", { cwd: "/home/dev/repos/lfg", sessionId: "abc" }),
    ).toBe("/api/sessions/mentionable?q=login&cwd=%2Fhome%2Fdev%2Frepos%2Flfg&exclude=abc");
  });

  it("omits empty parts", () => {
    expect(sessionMentionUrl("", undefined)).toBe("/api/sessions/mentionable");
    expect(sessionMentionUrl("", { cwd: null, sessionId: null })).toBe("/api/sessions/mentionable");
  });
});

describe("applySessionMention", () => {
  const session = { sessionId: "0f1e2d3c-1111-2222-3333-444455556666", title: "Fix login" };

  it("replaces the trigger with a token the server can parse", () => {
    const active = sessionMentionAt("look at #fix now", 12)!;
    const next = applySessionMention("look at #fix now", active, session);
    expect(next.value).toBe("look at [#Fix login](omg:session_0f1e2d3c)  now");
    expect(next.cursor).toBe("look at [#Fix login](omg:session_0f1e2d3c) ".length);
    expect(parseSessionMentions(next.value)).toEqual([
      { sessionRef: "0f1e2d3c", label: "Fix login" },
    ]);
  });
});

describe("sessionFolderName", () => {
  it("returns the last path segment", () => {
    expect(sessionFolderName("/home/dev/repos/lfg/")).toBe("lfg");
    expect(sessionFolderName(null)).toBe("");
  });
});
