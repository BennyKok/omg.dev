// Deferring tool_use ARGUMENTS off the transcript stream.
//
// After tool_result is dropped (see transcript-tool-payload.test.ts), the
// arguments are what is left of the tool traffic and they are most of the
// payload. On a real 4 732-message session the 3 019 messages a client keeps
// are 1 690 KB, of which 1 095 KB is tool_use arguments. Nothing shows them
// until a reader opens a pill, so a capable connection asks for the name only
// and fetches the arguments of the one call it opened.
//
// The whole change rests on four properties, and each one is a way it could
// break a client:
//
//   1. the split is exact, so the fetch reconstructs the original text;
//   2. the ROW MODEL is untouched, so the pills and their live counter are
//      identical with and without the arguments;
//   3. it is OPT IN, so a client that does not ask is unchanged byte for byte;
//   4. the index keeps the arguments, so search still matches inside them.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PATHS } from "./config.ts";
import {
  indexSessionMessagesDirect,
  indexedToolUseArgs,
  resetTranscriptIndexConnectionForTests,
  searchTranscriptIndex,
  sessionIndexKey,
} from "./transcript-index.ts";
import {
  deferToolUseArgs,
  splitToolUseText,
  visibleTranscriptMessages,
  type SessionMsg,
} from "./sessions.ts";
import { buildChatRenderItems, toolGroupLabel, toolName } from "./transcript-rows.ts";

const SESSION = "88888888-8888-4888-8888-888888888888";
const OTHER = "99999999-9999-4999-8999-999999999999";

function m(id: string, kind: SessionMsg["kind"], text: string): SessionMsg {
  return { id, role: kind === "tool_result" ? "tool" : "assistant", kind, text, ts: 1 } as SessionMsg;
}

const READ_ARGS = '{"file_path":"/etc/app.conf"}';
const BASH_ARGS = '{"command":"grep -n listen_port /etc/app.conf"}';

const TURN: SessionMsg[] = [
  m("t1", "text", "Let me look at the config."),
  m("u1", "tool_use", `Read: ${READ_ARGS}`),
  m("r1", "tool_result", "listen_port = 8080"),
  m("u2", "tool_use", `Bash: ${BASH_ARGS}`),
  m("r2", "tool_result", "1:listen_port = 8080"),
  m("t2", "text", "The port is 8080."),
];

/** What a capable connection actually receives. */
const forCapableClient = (messages: SessionMsg[]) =>
  deferToolUseArgs(visibleTranscriptMessages(messages));
/** What every client received before the capability existed. */
const forOlderClient = (messages: SessionMsg[]) => visibleTranscriptMessages(messages);

describe("splitting a tool_use into name and arguments", () => {
  test("splits at the first colon, which is how the text was assembled", () => {
    expect(splitToolUseText(`Read: ${READ_ARGS}`)).toEqual({ name: "Read", args: READ_ARGS });
  });

  test("a call with no arguments has no colon and yields no arguments", () => {
    expect(splitToolUseText("TodoWrite")).toEqual({ name: "TodoWrite", args: "" });
  });

  test("colons INSIDE the arguments stay in the arguments", () => {
    const args = '{"command":"echo a:b:c"}';
    expect(splitToolUseText(`Bash: ${args}`)).toEqual({ name: "Bash", args });
  });

  test("an mcp tool keeps its full dunder name", () => {
    const { name } = splitToolUseText('mcp__omg__omg_ship: {"summary":"done"}');
    expect(name).toBe("mcp__omg__omg_ship");
  });
});

describe("what the deferred payload contains", () => {
  test("the call keeps its name and reports how much was cut", () => {
    const sent = forCapableClient(TURN);
    const call = sent.find((x) => x.id === "u1")!;
    expect(call.text).toBe("Read");
    expect(call.toolArgsLen).toBe(READ_ARGS.length);
  });

  test("nothing but tool_use text is touched", () => {
    const sent = forCapableClient(TURN);
    expect(sent.map((x) => x.id)).toEqual(["t1", "u1", "u2", "t2"]);
    expect(sent.find((x) => x.id === "t1")!.text).toBe("Let me look at the config.");
    expect(sent.find((x) => x.id === "t1")).not.toHaveProperty("toolArgsLen");
  });

  test("a call that took no arguments is sent unchanged and unmarked", () => {
    // There is nothing to fetch, so marking it would only cost a round trip.
    const sent = deferToolUseArgs([m("u9", "tool_use", "TodoWrite")]);
    expect(sent[0]!.text).toBe("TodoWrite");
    expect(sent[0]).not.toHaveProperty("toolArgsLen");
  });

  test("thinking is left alone — it is already ten bytes", () => {
    const sent = deferToolUseArgs([m("h1", "thinking", "(thinking)")]);
    expect(sent[0]!.text).toBe("(thinking)");
  });

  test("it removes the bulk of the bytes", () => {
    const before = forOlderClient(TURN).reduce((n, x) => n + x.text.length, 0);
    const after = forCapableClient(TURN).reduce((n, x) => n + x.text.length, 0);
    expect(after).toBeLessThan(before / 2);
  });
});

describe("the row model and the pill are identical either way", () => {
  test("the same rows, in the same order", () => {
    expect(buildChatRenderItems(forCapableClient(TURN)).map((r) => r.type)).toEqual(
      buildChatRenderItems(forOlderClient(TURN)).map((r) => r.type),
    );
  });

  test("the same pill label, so the live counter still ticks up", () => {
    const label = (messages: SessionMsg[]) => {
      const pill = buildChatRenderItems(messages).find((row) => row.type === "tools");
      if (pill?.type !== "tools") throw new Error("expected a folded tool row");
      return toolGroupLabel(pill.items);
    };
    expect(label(forCapableClient(TURN))).toBe("1 Read · 1 Bash");
    expect(label(forCapableClient(TURN))).toBe(label(forOlderClient(TURN)));
  });

  test("a display tool still pairs with the artifact it produced", () => {
    // artifactKindForTool matches on the tool NAME, which survives the split.
    // If it stopped matching, the image would detach from its call and render
    // as a stray pill next to a stray picture.
    const withArtifact: SessionMsg[] = [
      m("u5", "tool_use", 'mcp__omg__omg_display_image: {"path":"/tmp/shot.png"}'),
      m("a5", "image", "shot.png"),
    ];
    expect(buildChatRenderItems(forCapableClient(withArtifact)).map((r) => r.type)).toEqual([
      "artifact_tool",
    ]);
    expect(buildChatRenderItems(forCapableClient(withArtifact)).map((r) => r.type)).toEqual(
      buildChatRenderItems(forOlderClient(withArtifact)).map((r) => r.type),
    );
  });

  test("toolName reads the deferred text as the same tool", () => {
    // The row rule has one owner and it parses the name out of `text`. The
    // deferred text is exactly that name, so the owner needs no change.
    expect(toolName("Read")).toBe(toolName(`Read: ${READ_ARGS}`));
  });
});

describe("an older client that never asks is unchanged", () => {
  test("the payload is byte for byte what it always was", () => {
    const older = forOlderClient(TURN);
    expect(older.find((x) => x.id === "u1")!.text).toBe(`Read: ${READ_ARGS}`);
    expect(older.find((x) => x.id === "u2")!.text).toBe(`Bash: ${BASH_ARGS}`);
    expect(older.some((x) => "toolArgsLen" in x)).toBe(false);
  });

  test("it renders the arguments inline, with no fetch available", () => {
    // The pre-capability client splits `text` itself. That still works,
    // because without the capability the arguments are still in `text`.
    const call = forOlderClient(TURN).find((x) => x.id === "u2")!;
    const separator = call.text.indexOf(":");
    expect(call.text.slice(0, separator)).toBe("Bash");
    expect(call.text.slice(separator + 1).trim()).toBe(BASH_ARGS);
  });
});

describe("fetching the arguments back", () => {
  const originalData = PATHS.data;
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "lfg-tool-args-"));
    PATHS.data = join(root, "data");
    resetTranscriptIndexConnectionForTests();
  });

  afterEach(() => {
    resetTranscriptIndexConnectionForTests();
    PATHS.data = originalData;
    rmSync(root, { recursive: true, force: true });
  });

  test("the fetch reconstructs exactly what was cut out", () => {
    indexSessionMessagesDirect(SESSION, TURN);
    const found = indexedToolUseArgs(sessionIndexKey(SESSION), "u1");
    expect(found).toEqual({ messageId: "u1", name: "Read", args: READ_ARGS });
    // name + ": " + args is the original text, so nothing is lost.
    expect(`${found!.name}: ${found!.args}`).toBe(`Read: ${READ_ARGS}`);
  });

  test("a message that is not a tool call is not readable this way", () => {
    indexSessionMessagesDirect(SESSION, TURN);
    expect(indexedToolUseArgs(sessionIndexKey(SESSION), "t1")).toBeNull();
  });

  test("an unknown id is a miss, not a throw", () => {
    indexSessionMessagesDirect(SESSION, TURN);
    expect(indexedToolUseArgs(sessionIndexKey(SESSION), "nope")).toBeNull();
  });

  test("the read is scoped to the session that was asked for", () => {
    // Ids are globally unique, so an unscoped lookup would let a caller read a
    // tool call out of a session it never requested.
    indexSessionMessagesDirect(SESSION, TURN);
    indexSessionMessagesDirect(OTHER, [m("secret", "tool_use", 'Bash: {"command":"cat /etc/shadow"}')]);
    expect(indexedToolUseArgs(sessionIndexKey(SESSION), "secret")).toBeNull();
    expect(indexedToolUseArgs(sessionIndexKey(OTHER), "secret")).not.toBeNull();
  });
});

describe("search still reaches deferred arguments", () => {
  const originalData = PATHS.data;
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "lfg-tool-args-search-"));
    PATHS.data = join(root, "data");
    resetTranscriptIndexConnectionForTests();
  });

  afterEach(() => {
    resetTranscriptIndexConnectionForTests();
    PATHS.data = originalData;
    rmSync(root, { recursive: true, force: true });
  });

  test("text that exists only inside the deferred arguments is still findable", async () => {
    indexSessionMessagesDirect(SESSION, TURN);
    // "listen_port" is inside u2's ARGUMENTS, which a capable client never
    // receives. The index kept them, so the find bar still matches.
    const sent = forCapableClient(TURN);
    expect(sent.find((x) => x.id === "u2")!.text).not.toContain("listen_port");

    const res = await searchTranscriptIndex(sessionIndexKey(SESSION), SESSION, "listen_port");
    const hit = res.results.find((r) => r.messageId === "u2");
    expect(hit).toBeDefined();
    expect(hit!.kind).toBe("tool_use");
    expect(hit!.snippet).toContain("listen_port");
  });

  test("the hit carries the id the find bar maps onto a row", async () => {
    indexSessionMessagesDirect(SESSION, TURN);
    const res = await searchTranscriptIndex(sessionIndexKey(SESSION), SESSION, "app.conf");
    // Every hit names a message the client holds by id, even though the text
    // that matched is not in the client's copy of it.
    const clientIds = new Set(forCapableClient(TURN).map((x) => x.id));
    const toolHits = res.results.filter((r) => r.kind === "tool_use");
    expect(toolHits.length).toBeGreaterThan(0);
    for (const hit of toolHits) expect(clientIds.has(hit.messageId)).toBe(true);
  });
});
