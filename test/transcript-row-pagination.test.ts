// Pagination counts RENDER ROWS, not raw messages.
//
// The UI folds every run of tool_use / tool_result / thinking into one row, so
// a page of 80 raw messages could render as three rows and leave the viewport
// empty on a tool-heavy session. The rule that decides a row has exactly one
// definition, in src/transcript-rows.ts, and both the server and the client
// import it. These tests defend that shape and the wire compatibility of the
// `rows` parameter.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { requestedRows } from "../src/commands/serve.ts";

const ROOT = join(import.meta.dir, "..");
const read = (...parts: string[]) => readFileSync(join(ROOT, ...parts), "utf8");
const SERVE = read("src", "commands", "serve.ts");
const LIVE_WS = read("src", "live-ws.ts");
const APP = read("web", "src", "App.tsx");
const LIVE_SOCKET = read("web", "src", "useLiveSocket.ts");
const RENDER_ITEMS = read("web", "src", "lib", "chat-render-items.ts");

describe("the rows parameter", () => {
  test("is optional, so an old client gets the old raw-message page", () => {
    expect(requestedRows(new URL("http://127.0.0.1/api/sessions/x/messages?limit=80"))).toBeNull();
  });

  test("rejects junk instead of guessing", () => {
    for (const value of ["", "0", "-4", "abc"]) {
      expect(requestedRows(new URL(`http://127.0.0.1/x?rows=${value}`))).toBeNull();
    }
  });

  test("is clamped so one request cannot ask for the whole transcript", () => {
    expect(requestedRows(new URL("http://127.0.0.1/x?rows=40"))).toBe(40);
    expect(requestedRows(new URL("http://127.0.0.1/x?rows=99999"))).toBe(500);
  });
});

describe("the row rule has one owner", () => {
  test("the client re-exports the shared module instead of defining the rule", () => {
    expect(RENDER_ITEMS).toContain("src/transcript-rows.ts");
    expect(RENDER_ITEMS).not.toContain("function buildChatRenderItems");
  });

  test("the server imports the rule rather than copying it", () => {
    expect(SERVE).toContain('from "../transcript-rows.ts"');
    expect(SERVE).not.toContain("function buildChatRenderItems");
    expect(LIVE_WS).toContain('from "./transcript-rows.ts"');
  });
});

describe("every transcript reader pages in rows", () => {
  test("the live backlogs are row-aware", () => {
    expect(SERVE).not.toContain("indexedMessagePage(p.tp, p.sid, { limit: 40 })");
    expect(SERVE).not.toContain("indexedMessagePage(tp, sid, { limit: 40 })");
    expect(LIVE_WS).toContain("indexedMessageRowPage");
  });

  test("the client asks through the one page-path owner", () => {
    for (const source of [APP, LIVE_SOCKET]) {
      expect(source).not.toContain("/messages?limit=80");
      expect(source).not.toContain("/messages?page=backward");
      expect(source).toContain("transcriptPagePath(sid)");
      expect(source).toContain("transcriptOlderPagePath(sid, before)");
    }
  });
});

describe("a live update never truncates a paged-back backlog", () => {
  test("the raw 80-message cap is gone from both live owners", () => {
    expect(APP).not.toContain("slice(-80)");
    expect(LIVE_SOCKET).not.toContain("slice(-80)");
    expect(APP).toContain("windowLiveMessages");
    expect(LIVE_SOCKET).toContain("windowLiveMessages");
  });
});

describe("the backfill guard", () => {
  test("ChatStream asks the shared predicate instead of testing overflow inline", () => {
    expect(APP).toContain("loadOlderIntent");
    expect(APP).not.toContain("el.scrollHeight <= el.clientHeight + 80");
  });
});
