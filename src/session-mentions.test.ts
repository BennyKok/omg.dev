import { describe, expect, it } from "bun:test";
import { rankSessionMentions, sessionMentionTerms } from "./session-mentions";
import {
  formatSessionMentionToken,
  parseSessionMentions,
  shortSessionRef,
} from "./session-mention-token";
import { SHORT_SESSION_ID_LENGTH, shortSessionId } from "./omg-capabilities";

const row = (
  id: string,
  title: string,
  cwd: string,
  lastActivityAt: number,
  extra: Partial<{ lastUserText: string | null; project: string }> = {},
) => ({
  sessionId: id,
  title,
  cwd,
  project: extra.project ?? cwd.split("/").pop() ?? "",
  lastUserText: extra.lastUserText ?? null,
  lastActivityAt,
  agent: "claude",
});

const HERE = "/home/dev/repos/lfg";
const historical = [
  row("a1", "Fix login bug", "/home/dev/repos/other", 500),
  row("b2", "Add # picker", HERE, 300),
  row("c3", "Refactor auth", HERE, 100, { lastUserText: "login flow cleanup" }),
  row("d4", "Deploy notes", "/home/dev/repos/other", 900),
];

describe("rankSessionMentions", () => {
  it("puts the caller's folder first, newest first inside each group", () => {
    const ids = rankSessionMentions({ live: [], historical, cwd: HERE }).map((r) => r.sessionId);
    expect(ids).toEqual(["b2", "c3", "d4", "a1"]);
  });

  it("orders purely by recency without a folder", () => {
    const ids = rankSessionMentions({ live: [], historical }).map((r) => r.sessionId);
    expect(ids).toEqual(["d4", "a1", "b2", "c3"]);
  });

  it("holds live rows to the same keyword rule as the catalog", () => {
    const live = [row("l1", "Live login work", HERE, 2000), row("l2", "Unrelated", HERE, 3000)];
    const rows = rankSessionMentions({ live, historical, cwd: HERE, query: "login" });
    expect(rows.map((r) => r.sessionId)).toEqual(["l1", "c3", "a1"]);
    expect(rows[0].live).toBe(true);
    expect(rows[1].live).toBe(false);
  });

  it("matches every term across title, last prompt and project", () => {
    const rows = rankSessionMentions({ live: [], historical, query: "login cleanup" });
    expect(rows.map((r) => r.sessionId)).toEqual(["c3"]);
    expect(rankSessionMentions({ live: [], historical, query: "other" }).map((r) => r.sessionId))
      .toEqual(["d4", "a1"]);
  });

  it("dedupes a session that is both live and cached, keeping live", () => {
    const live = [row("b2", "Add # picker", HERE, 5000)];
    const rows = rankSessionMentions({ live, historical, cwd: HERE });
    expect(rows.filter((r) => r.sessionId === "b2")).toHaveLength(1);
    expect(rows[0]).toMatchObject({ sessionId: "b2", live: true, sameFolder: true });
  });

  it("never offers the composer's own session, and drops rows without an id", () => {
    const live = [{ ...row("x", "no id", HERE, 1), sessionId: null }];
    const ids = rankSessionMentions({ live, historical, cwd: HERE, excludeId: "b2" }).map(
      (r) => r.sessionId,
    );
    expect(ids).not.toContain("b2");
    expect(ids).not.toContain("x");
  });

  it("treats a trailing slash as the same folder and caps the list", () => {
    const rows = rankSessionMentions({ live: [], historical, cwd: `${HERE}/`, limit: 1 });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ sessionId: "b2", sameFolder: true });
  });

  it("caps terms at eight", () => {
    expect(sessionMentionTerms("a b c d e f g h i j")).toHaveLength(8);
  });
});

describe("session mention token", () => {
  const FULL = "0f1e2d3c-1111-2222-3333-444455556666";

  it("writes the same short id agents already see", () => {
    expect(shortSessionRef(FULL)).toBe(shortSessionId(FULL));
    expect(shortSessionRef(FULL)).toHaveLength(SHORT_SESSION_ID_LENGTH);
    expect(shortSessionRef("thread_abc123")).toBe("thread_abc123");
  });

  it("round-trips through the parser", () => {
    const token = formatSessionMentionToken(FULL, "Fix login (staging) [wip]");
    expect(token).toBe("[#Fix login staging wip](omg:session_0f1e2d3c)");
    expect(parseSessionMentions(`please see ${token} and ${token}`)).toEqual([
      { sessionRef: "0f1e2d3c", label: "Fix login staging wip" },
    ]);
  });

  it("falls back to the id when the title is empty", () => {
    expect(formatSessionMentionToken(FULL, "  ")).toBe("[#0f1e2d3c](omg:session_0f1e2d3c)");
  });

  it("ignores text without a token cheaply", () => {
    expect(parseSessionMentions("no refs here #123")).toEqual([]);
  });
});
