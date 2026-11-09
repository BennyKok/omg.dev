import { describe, expect, test } from "bun:test";
import { newTabName, scopeId, scopeQuery, tabLabel, tabsFromShells } from "./terminal-panel";

const shell = (id: string, createdAt: number, extra: Partial<{ title: string; program: string }> = {}) => ({
  id,
  createdAt,
  title: extra.title ?? null,
  program: extra.program ?? null,
});

describe("terminal tabs", () => {
  test("a session's shells become its tabs, oldest first, and nobody else's", () => {
    const scope = { sessionId: "abc-1" };
    const tabs = tabsFromShells(scope, [
      shell("s-abc-1-tb", 3, { program: "vim" }),
      shell("s-abc-1", 1),
      shell("s-abc-12", 2),
      shell("main", 0),
    ]);
    expect(tabs).toEqual([
      { tab: null, title: null, program: null },
      { tab: "tb", title: null, program: "vim" },
    ]);
  });

  test("queries and ids match what the server resolves", () => {
    expect(scopeQuery({ sessionId: "a b" })).toBe("sessionId=a%20b");
    expect(scopeQuery({ sessionId: "abc" }, "t1")).toBe("sessionId=abc&tab=t1");
    expect(scopeQuery({ name: "main" })).toBe("session=main");
    expect(scopeId({ sessionId: "abc-1" })).toBe("s-abc-1");
    expect(scopeId({ name: "login-codex" })).toBe("login-codex");
  });

  test("labels prefer the running program, then the title, then a number", () => {
    expect(tabLabel({ tab: null, title: "dev@box: ~/x", program: "htop" }, 0)).toBe("htop");
    expect(tabLabel({ tab: null, title: "dev@box: ~/x", program: null }, 0)).toBe("dev@box: ~/x");
    expect(tabLabel({ tab: null, title: "x".repeat(40), program: null }, 0)).toHaveLength(28);
    expect(tabLabel({ tab: "t", title: null, program: null }, 2)).toBe("Terminal 3");
  });

  test("new tab names are valid ids and never collide", () => {
    const name = newTabName([], 1_700_000_000_000);
    expect(name).toMatch(/^t[a-z0-9]+$/);
    expect(newTabName([{ tab: name, title: null, program: null }], 1_700_000_000_000)).not.toBe(name);
  });
});
