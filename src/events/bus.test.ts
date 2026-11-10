// The rules that decide when an event hook acts: what counts as an event, what
// counts as new, and when the action is held back.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PATHS } from "../config.ts";
import { parseScriptOutput } from "./sources/script.ts";
import { githubEvents } from "./sources/github.ts";
import { OMG_AGENT_MARKER, type EventHook } from "./types.ts";

const originalData = PATHS.data;
let testData = "";
let bus: typeof import("./bus.ts");
let store: typeof import("./store.ts");

beforeAll(async () => {
  testData = await mkdtemp(join(tmpdir(), "omg-events-"));
  PATHS.data = testData;
  bus = await import("./bus.ts");
  store = await import("./store.ts");
});

afterAll(async () => {
  PATHS.data = originalData;
  await rm(testData, { recursive: true, force: true });
});

describe("script output", () => {
  test("one event per JSON line with a key", () => {
    const events = parseScriptOutput('{"key":"a","title":"A"}\n{"key":"b","topic":"x","data":{"n":1}}\n');
    expect(events.map((e) => [e.key, e.topic, e.title])).toEqual([
      ["a", "script", "A"],
      ["b", "x", undefined],
    ]);
    expect(events[1].data).toEqual({ n: 1 });
  });

  test("any other output is one event keyed by its content", () => {
    const a = parseScriptOutput("status: red\n");
    const b = parseScriptOutput("status: red");
    const c = parseScriptOutput("status: green");
    expect(a).toHaveLength(1);
    expect(a[0].key).toBe(b[0].key);
    expect(a[0].key).not.toBe(c[0].key);
    expect(parseScriptOutput('{"key":"a"}\nnot json')).toHaveLength(1);
  });

  test("empty output is no event", () => {
    expect(parseScriptOutput("  \n")).toEqual([]);
  });
});

describe("github", () => {
  test("skips an agent's own reply and pull requests in the issue list", () => {
    const comments = githubEvents("comments", [
      { id: 1, body: "please fix", user: { login: "someone" }, issue_url: "https://api.github.com/repos/o/r/issues/7" },
      { id: 2, body: `done\n${OMG_AGENT_MARKER}`, user: { login: "me" }, issue_url: "https://api.github.com/repos/o/r/issues/7" },
    ]);
    expect(comments.map((e) => e.key)).toEqual(["comment:1"]);
    expect(comments[0].title).toBe("someone commented on #7");

    const issues = githubEvents("issues", [{ number: 3, title: "Bug" }, { number: 4, title: "PR", pull_request: {} }]);
    expect(issues.map((e) => e.key)).toEqual(["issue:3"]);
  });
});

describe("hook input", () => {
  test("rejects unknown kinds and bad schedules, fills defaults", () => {
    expect(bus.validateHookInput({ name: "x", source: { kind: "nope" }, action: { kind: "notify" } }).ok).toBe(false);
    expect(
      bus.validateHookInput({ name: "x", schedule: "every minute", source: { kind: "script", command: "true" }, action: { kind: "notify" } }).ok,
    ).toBe(false);
    expect(bus.validateHookInput({ name: "x", source: { kind: "github", repo: "o/r; rm -rf", watch: "issues" }, action: { kind: "notify" } }).ok).toBe(false);
    const ok = bus.validateHookInput({ name: "x", source: { kind: "script", command: "true" }, action: { kind: "notify" } });
    expect(ok.ok && ok.hook.schedule).toBe(bus.DEFAULT_SCHEDULE);
    expect(ok.ok && ok.hook.maxRunsPerHour).toBe(bus.DEFAULT_MAX_RUNS_PER_HOUR);
  });
});

describe("processing", () => {
  test("first check records, then only new keys act, within the hourly limit", async () => {
    const list = join(testData, "items.txt");
    const out = join(testData, "received.jsonl");
    await Bun.write(list, '{"key":"1"}\n{"key":"2"}\n');
    const hook = await store.saveHook({
      name: "test",
      enabled: true,
      schedule: "* * * * *",
      source: { kind: "script", command: `cat ${list}` },
      action: { kind: "command", command: `cat >> ${out}` },
      maxRunsPerHour: 1,
    });

    expect((await bus.processHook(hook)).fired).toBe(0); // baseline
    expect((await bus.processHook(hook)).note).toBe("nothing new");

    await Bun.write(list, '{"key":"1"}\n{"key":"2"}\n{"key":"3","title":"three"}\n');
    expect((await bus.processHook(hook)).fired).toBe(1);
    const received = (await readFile(out, "utf8")).trim().split("\n").map((l) => JSON.parse(l));
    expect(received.map((e: { key: string }) => e.key)).toEqual(["3"]);

    await Bun.write(list, '{"key":"4"}\n');
    const held = await bus.processHook(hook as EventHook);
    expect(held.fired).toBe(0);
    expect(held.note).toContain("waiting");

    // A held item was not marked seen, so it fires once the limit allows.
    expect((await store.loadSeen(hook.id))?.has("4")).toBe(false);
  });

  test("a failing source is recorded on the hook", async () => {
    const hook = await store.saveHook({
      name: "broken",
      enabled: true,
      schedule: "* * * * *",
      source: { kind: "script", command: "echo nope >&2; exit 3" },
      action: { kind: "notify" },
      maxRunsPerHour: 6,
    });
    const r = await bus.runHook({ ...hook, lastError: "already failing" });
    expect(r.ok).toBe(false);
    expect((await store.getHook(hook.id))?.lastError).toContain("exited 3: nope");
  });

  test("a script does not see the server's secrets", async () => {
    process.env.OMG_TEST_SECRET = "s3cret";
    try {
      const events = await bus.previewSource({ kind: "script", command: 'echo "secret=[$OMG_TEST_SECRET]"' });
      expect(events[0].data).toBe("secret=[]");
    } finally {
      delete process.env.OMG_TEST_SECRET;
    }
  });
});
