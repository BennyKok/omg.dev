// The session LIST payload used to carry every session's whole spawn command
// line in `cmd`.
//
// For a managed session that command line embeds the entire omg.dev runtime
// contract and the complete user prompt: a live box measured 15 sessions
// carrying 36 KB of `cmd` — 67.7% of a 53 KB /api/sessions response, median
// 2,019 chars per session — refetched by the dashboard's 5s poll and again by
// /api/bootstrap on every cold open, uncompressed across the hosted relay.
// Nothing that reads the list renders `cmd`, and the field is the one place
// the response carried prompt text, which this codebase treats as sensitive.
//
// The rule these tests defend: LIST responses (/api/sessions, the sessions
// block of /api/bootstrap) drop `cmd`; `?full=1` opts back in for the one
// caller that genuinely wants it (omg_list_sessions with verbose:true).
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { sessionListRow } from "../src/commands/serve.ts";
import type { Session } from "../src/sessions.ts";

const SERVE = readFileSync(join(import.meta.dir, "..", "src", "commands", "serve.ts"), "utf8");
const MCP = readFileSync(join(import.meta.dir, "..", "src", "commands", "mcp.ts"), "utf8");
const APP = readFileSync(join(import.meta.dir, "..", "web", "src", "App.tsx"), "utf8");

function fakeSession(cmd: string): Session {
  return {
    agent: "grok",
    pid: 1234,
    cmd,
    cwd: "/home/dev/lfg-worktrees/lfg-138661",
    project: "omg.dev",
    title: "a session",
    lastUserText: null,
    sessionId: "11111111-2222-4333-8444-555555555555",
    startedAt: 1,
    transcriptPath: null,
    lastActivityAt: 2,
    last: null,
    tmuxTarget: null,
    tmuxName: null,
    managed: true,
    assignedUser: null,
  };
}

describe("sessionListRow", () => {
  test("drops cmd and keeps every other field", () => {
    const session = fakeSession("grok --model grok-4.6 -- the whole prompt");
    const row = sessionListRow(session);
    expect("cmd" in row).toBe(false);
    expect(row).toEqual({ ...session, cmd: undefined } as unknown as typeof row);
    expect(row.sessionId).toBe(session.sessionId);
    expect(row.title).toBe(session.title);
  });

  test("does not mutate the row it was given", () => {
    // listSessionsCached() hands out the shared cache snapshot; the push
    // notifier, the send queue and live-ws all read the same objects.
    const session = fakeSession("grok --model grok-4.6 -- the whole prompt");
    sessionListRow(session);
    expect(session.cmd).toBe("grok --model grok-4.6 -- the whole prompt");
  });
});

describe("which responses drop cmd", () => {
  test("both list surfaces use the slim shape", () => {
    // /api/sessions and the sessions block of /api/bootstrap are the two hot
    // readers; either one left on the full shape puts the prompts back.
    const listers = [...SERVE.matchAll(/map\(\s*sessionListRow\s*\)/g)];
    expect(listers.length, "expected /api/sessions and /api/bootstrap to map the list shape")
      .toBe(2);
  });

  test("/api/sessions keeps a full=1 opt-in", () => {
    const route = SERVE.indexOf('path === "/api/sessions"');
    expect(route, "/api/sessions route not found").toBeGreaterThanOrEqual(0);
    // Slice to the start of the *next* top-level route handler rather than a
    // fixed char count — a fixed window silently stops covering this route
    // the moment someone adds a comment inside it (see the pendingLogins
    // hibernation note above), which is exactly what happened here.
    const nextRoute = SERVE.indexOf("\n      if (path ===", route + 1);
    expect(nextRoute, "next route boundary not found").toBeGreaterThan(route);
    const block = SERVE.slice(route, nextRoute);
    expect(block).toContain('url.searchParams.get("full") === "1"');
    expect(block).toContain("full ? sessions : sessions.map(sessionListRow)");
  });

  test("the MCP verbose listing asks for full rows", () => {
    // omg_list_sessions with verbose:true promises the spawn command line in
    // its tool description; without full=1 it would silently lose `cmd`.
    expect(MCP).toContain('verbose ? "/api/sessions?full=1" : "/api/sessions"');
  });

  test("the web Session type no longer declares cmd", () => {
    // The UI never rendered it; keeping the field on the type would invite a
    // future reader to depend on a value the wire no longer carries.
    expect(APP).not.toMatch(/^\s+cmd\?: string;$/m);
  });
});
