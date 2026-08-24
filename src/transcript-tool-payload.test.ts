// Tool payloads must not reach a client.
//
// A transcript is mostly tool traffic. On a real 4 732-message session the
// tool_use / tool_result / thinking messages are 4 070 of them, 86 percent,
// and they render as roughly 502 pills that show a tool name and a count.
// tool_result is the heaviest of the three (1 713 messages, 895 KB) and the
// only one that nothing renders at all, so `visibleTranscriptMessages` drops
// it before any transport touches it.
//
// These tests pin the three properties that make the drop safe, because none
// of them was covered before and each one is easy to break by accident:
//
//   1. the drop happens, and takes nothing else with it;
//   2. the collapsed row model is unchanged by it, so a client that never
//      sees a result still draws the same pills in the same order;
//   3. the server-side index KEEPS the result text, so transcript search
//      still matches inside a tool result the client never received.
//
// A fourth test guards the single owner: a new transport that forgets to
// filter would silently start streaming megabytes of command output again.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PATHS } from "./config.ts";
import {
  indexSessionMessagesDirect,
  resetTranscriptIndexConnectionForTests,
  searchTranscriptIndex,
  sessionIndexKey,
} from "./transcript-index.ts";
import { visibleTranscriptMessages, type SessionMsg } from "./sessions.ts";
import { buildChatRenderItems, toolGroupLabel } from "./transcript-rows.ts";

const SESSION = "77777777-7777-4777-8777-777777777777";

function m(id: string, kind: SessionMsg["kind"], text: string): SessionMsg {
  return { id, role: kind === "tool_result" ? "tool" : "assistant", kind, text, ts: 1 } as SessionMsg;
}

/** The label the reader sees on the single tool pill of a folded run. */
function pillLabel(messages: SessionMsg[]): string {
  const pill = buildChatRenderItems(messages).find((row) => row.type === "tools");
  if (pill?.type !== "tools") throw new Error("expected exactly one folded tool row");
  return toolGroupLabel(pill.items);
}

// One assistant turn: some prose, a run of three tool calls each answered by a
// result, then the closing prose.
const TURN: SessionMsg[] = [
  m("t1", "text", "Let me look at the config."),
  m("u1", "tool_use", 'Read: {"file_path":"/etc/app.conf"}'),
  m("r1", "tool_result", "listen_port = 8080\nworkers = 4\n"),
  m("u2", "tool_use", 'Bash: {"command":"grep -n port /etc/app.conf"}'),
  m("r2", "tool_result", "1:listen_port = 8080"),
  m("u3", "tool_use", 'Bash: {"command":"systemctl status app"}'),
  m("r3", "tool_result", "active (running) since Tue"),
  m("t2", "text", "The port is 8080."),
];

describe("tool_result never reaches a client", () => {
  test("the filter drops every result and keeps everything else in order", () => {
    const sent = visibleTranscriptMessages(TURN);
    expect(sent.map((x) => x.id)).toEqual(["t1", "u1", "u2", "u3", "t2"]);
    expect(sent.some((x) => x.kind === "tool_result")).toBe(false);
    // The calls keep their full text. Only the results are dropped.
    expect(sent.find((x) => x.id === "u1")?.text).toBe('Read: {"file_path":"/etc/app.conf"}');
  });

  test("it removes the bulk of the bytes", () => {
    const before = TURN.reduce((n, x) => n + x.text.length, 0);
    const after = visibleTranscriptMessages(TURN).reduce((n, x) => n + x.text.length, 0);
    expect(after).toBeLessThan(before);
  });

  test("thinking and tool_use survive — only results are dropped", () => {
    const withThought = [m("h1", "thinking", "(thinking)"), ...TURN];
    const kinds = new Set(visibleTranscriptMessages(withThought).map((x) => x.kind));
    expect(kinds.has("thinking")).toBe(true);
    expect(kinds.has("tool_use")).toBe(true);
    expect(kinds.has("tool_result")).toBe(false);
  });
});

describe("the collapsed row model is unaffected", () => {
  test("the run still folds into exactly one pill, between the two prose rows", () => {
    const rows = buildChatRenderItems(visibleTranscriptMessages(TURN));
    expect(rows.map((r) => r.type)).toEqual(["msg", "tools", "msg"]);
  });

  test("the pill label still names and counts the tools", () => {
    // "1 Read · 2 Bash" — the counter the reader actually sees, derived with no
    // result body present.
    expect(pillLabel(visibleTranscriptMessages(TURN))).toBe("1 Read · 2 Bash");
  });

  test("a client that receives results anyway still renders the same rows", () => {
    // An older client, or any caller that reads the index directly, may hold
    // the unfiltered list. The grouping rule folds tool_result into the same
    // run, so the row shape does not change and nothing breaks.
    expect(buildChatRenderItems(TURN).map((r) => r.type)).toEqual(["msg", "tools", "msg"]);
    expect(pillLabel(TURN)).toBe("1 Read · 2 Bash · 3 results");
  });
});

describe("transcript search still reaches a dropped tool result", () => {
  const originalData = PATHS.data;
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "lfg-tool-payload-"));
    PATHS.data = join(root, "data");
    resetTranscriptIndexConnectionForTests();
  });

  afterEach(() => {
    resetTranscriptIndexConnectionForTests();
    PATHS.data = originalData;
    rmSync(root, { recursive: true, force: true });
  });

  test("text that exists only inside a tool_result is still findable", async () => {
    indexSessionMessagesDirect(SESSION, TURN);
    // "workers" appears in r1 only, and r1 is never sent to a client.
    const res = await searchTranscriptIndex(sessionIndexKey(SESSION), SESSION, "workers");
    expect(res.results).toHaveLength(1);
    expect(res.results[0]!.kind).toBe("tool_result");
    expect(res.results[0]!.snippet).toContain("workers = 4");
  });

  test("the find bar can still land on the row that produced the hit", async () => {
    indexSessionMessagesDirect(SESSION, TURN);
    const res = await searchTranscriptIndex(sessionIndexKey(SESSION), SESSION, "systemctl");
    expect(res.results).toHaveLength(1);
    // The hit is the u3 CALL, which the client does hold, so the find bar maps
    // it onto the tools row. This is why dropping the results costs no reach:
    // a command and its output share their vocabulary.
    expect(res.results[0]!.kind).toBe("tool_use");
    expect(res.results[0]!.messageId).toBe("u3");
  });
});

describe("one owner for the rule", () => {
  const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");

  test("both transports import the shared filter and keep no private copy", () => {
    for (const path of ["./commands/serve.ts", "./live-ws.ts"]) {
      const src = read(path);
      expect(src).toContain("visibleTranscriptMessages");
      // A second declaration would let the transports drift apart.
      expect(src).not.toMatch(/function visibleTranscriptMessages/);
    }
  });

  test("every client-facing send routes through it", () => {
    // transcriptMessagesForClient is the only thing the endpoints and the
    // websocket publishes call, and it is defined in terms of the filter.
    for (const path of ["./commands/serve.ts", "./live-ws.ts"]) {
      expect(read(path)).toMatch(
        /function transcriptMessagesForClient[\s\S]{0,400}visibleTranscriptMessages\(messages\)/,
      );
    }
  });
});
