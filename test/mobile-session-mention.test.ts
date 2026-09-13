import { describe, expect, test } from "bun:test";
import {
  applySessionMention,
  createSessionMentionPicker,
  createSessionRefOpener,
  resolveSessionRef,
  resolveSessionRefWith,
  sessionFolderName,
  sessionMentionAt,
  sessionMentionPath,
  sessionRefFromHref,
  type MentionableSession,
  type SessionRefClient,
} from "../mobile/src/omg/session-mention";
import { parseSessionMentions } from "../packages/protocol/src/session-mention-token";

const FULL = "0f1e2d3c-1111-2222-3333-444455556666";
const row = (id: string, title: string): MentionableSession => ({
  sessionId: id,
  title,
  cwd: "/r/lfg",
  project: "lfg",
  lastUserText: null,
  lastActivityAt: 1,
  agent: "claude",
  live: false,
  sameFolder: true,
});
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("mobile # trigger", () => {
  test("opens on # after start or whitespace, closes at a space", () => {
    expect(sessionMentionAt("#", 1)).toEqual({ start: 0, end: 1, query: "" });
    expect(sessionMentionAt("see #Login", 10)).toEqual({ start: 4, end: 10, query: "login" });
    expect(sessionMentionAt("issue#12", 8)).toBeNull();
    expect(sessionMentionAt("# Title", 7)).toBeNull();
    expect(sessionMentionAt("#x", null)).toBeNull();
  });

  test("builds the same endpoint path the web uses", () => {
    expect(sessionMentionPath("login", { cwd: "/r/lfg", sessionId: "abc" })).toBe(
      "/api/sessions/mentionable?q=login&cwd=%2Fr%2Flfg&exclude=abc&limit=20",
    );
    expect(sessionMentionPath("", { cwd: null })).toBe("/api/sessions/mentionable?limit=20");
  });

  test("inserts the shared token, which the server parses back", () => {
    const active = sessionMentionAt("look at #fix", 12)!;
    const next = applySessionMention("look at #fix", active, { sessionId: FULL, title: "Fix login" });
    expect(next).toBe("look at [#Fix login](omg:session_0f1e2d3c) ");
    expect(parseSessionMentions(next)).toEqual([{ sessionRef: "0f1e2d3c", label: "Fix login" }]);
  });

  test("keeps a harness-native id whole rather than truncating it", () => {
    const next = applySessionMention("#t", sessionMentionAt("#t", 2)!, {
      sessionId: "thread_abc123",
      title: "",
    });
    expect(next).toBe("[#thread_abc123](omg:session_thread_abc123) ");
  });

  test("folder name is the last path segment", () => {
    expect(sessionFolderName("/home/dev/repos/lfg/")).toBe("lfg");
    expect(sessionFolderName(null)).toBe("");
  });
});

describe("picker controller", () => {
  type Pending = {
    query: string;
    scope: unknown;
    resolve: (items: MentionableSession[]) => void;
    reject: (error: unknown) => void;
  };
  function harness(debounceMs = 0) {
    const pending: Pending[] = [];
    const picker = createSessionMentionPicker({
      debounceMs,
      fetch: (query, scope) =>
        new Promise((resolve, reject) => {
          pending.push({ query, scope, resolve, reject });
        }),
    });
    const states: string[] = [];
    picker.subscribe(() => {
      const s = picker.getState();
      states.push(`${s.active ? s.active.query : "-"}:${s.items.map((i) => i.sessionId).join(",")}`);
    });
    return { picker, pending, states };
  }

  test("stays closed without a trigger and while disabled", () => {
    const { picker, pending } = harness();
    picker.update({ value: "hello" });
    picker.update({ value: "#lo", disabled: true });
    expect(pending).toHaveLength(0);
    expect(picker.getState()).toEqual({ active: null, items: [] });
  });

  test("shows only the answer to the newest query when responses arrive out of order", async () => {
    const { picker, pending, states } = harness();
    picker.update({ value: "#lo", scope: { cwd: "/r/lfg" } });
    picker.update({ value: "#login", scope: { cwd: "/r/lfg" } });
    expect(pending.map((p) => p.query)).toEqual(["lo", "login"]);
    pending[1].resolve([row("b", "login fix")]);
    await tick();
    pending[0].resolve([row("a", "lo-fi")]);
    await tick();
    expect(picker.getState().items.map((i) => i.sessionId)).toEqual(["b"]);
    expect(states.at(-1)).toBe("login:b");
  });

  test("a late answer never reopens a closed picker", async () => {
    const { picker, pending } = harness();
    picker.update({ value: "#lo" });
    picker.update({ value: "#lo done" });
    expect(picker.getState().active).toBeNull();
    pending[0].resolve([row("a", "lo-fi")]);
    await tick();
    expect(picker.getState()).toEqual({ active: null, items: [] });
  });

  test("becoming disabled mid-request closes and drops the answer", async () => {
    const { picker, pending } = harness();
    picker.update({ value: "#lo" });
    picker.update({ value: "#lo", disabled: true });
    pending[0].resolve([row("a", "lo-fi")]);
    await tick();
    expect(picker.getState()).toEqual({ active: null, items: [] });
  });

  test("a folder or session change refetches and drops the old ranking", async () => {
    const { picker, pending } = harness();
    picker.update({ value: "#", scope: { cwd: "/r/one" } });
    pending[0].resolve([row("a", "in one")]);
    await tick();
    expect(picker.getState().items.map((i) => i.sessionId)).toEqual(["a"]);
    picker.update({ value: "#", scope: { cwd: "/r/two" } });
    expect(picker.getState().items).toEqual([]);
    expect(pending).toHaveLength(2);
    expect(pending[1].scope).toEqual({ cwd: "/r/two", sessionId: null });
    pending[0].resolve([row("stale", "late for one")]);
    await tick();
    expect(picker.getState().items).toEqual([]);
    picker.update({ value: "#", scope: { cwd: "/r/two", sessionId: "self" } });
    expect(pending).toHaveLength(3);
    expect(pending[2].scope).toEqual({ cwd: "/r/two", sessionId: "self" });
  });

  test("a new query keeps the previous list up until its own answer lands", async () => {
    const { picker, pending } = harness();
    picker.update({ value: "#l" });
    pending[0].resolve([row("a", "l")]);
    await tick();
    picker.update({ value: "#lo" });
    expect(picker.getState().items.map((i) => i.sessionId)).toEqual(["a"]);
    expect(picker.getState().active?.query).toBe("lo");
    pending[1].resolve([]);
    await tick();
    expect(picker.getState().items).toEqual([]);
  });

  test("the same query in a longer draft keeps the list and moves the span", () => {
    const { picker, pending } = harness();
    picker.update({ value: "#lo" });
    picker.update({ value: "a #lo" });
    expect(pending).toHaveLength(1);
    expect(picker.getState().active).toEqual({ start: 2, end: 5, query: "lo" });
  });

  test("a failed fetch clears the list", async () => {
    const { picker, pending } = harness();
    picker.update({ value: "#" });
    pending[0].reject(new Error("offline"));
    await tick();
    expect(picker.getState()).toEqual({ active: { start: 0, end: 1, query: "" }, items: [] });
  });

  test("reset drops the pending answer, and the picker works again afterwards", async () => {
    const { picker, pending, states } = harness();
    picker.update({ value: "#x" });
    picker.reset();
    expect(picker.getState()).toEqual({ active: null, items: [] });
    const before = states.length;
    pending[0].resolve([row("stale", "x")]);
    await tick();
    expect(states.length).toBe(before);
    // StrictMode: cleanup ran, then setup runs the update effect again.
    picker.update({ value: "#x" });
    expect(pending).toHaveLength(2);
    pending[1].resolve([row("a", "x")]);
    await tick();
    expect(picker.getState().items.map((i) => i.sessionId)).toEqual(["a"]);
  });

  test("debounces a typed query but not a bare #", async () => {
    const { picker, pending } = harness(20);
    picker.update({ value: "#" });
    expect(pending).toHaveLength(1);
    picker.update({ value: "#l" });
    picker.update({ value: "#lo" });
    expect(pending).toHaveLength(1);
    await new Promise((resolve) => setTimeout(resolve, 40));
    expect(pending.map((p) => p.query)).toEqual(["", "lo"]);
  });
});

describe("tapping a rendered reference", () => {
  test("only omg:session_ hrefs are references", () => {
    expect(sessionRefFromHref("omg:session_0f1e2d3c")).toBe("0f1e2d3c");
    expect(sessionRefFromHref("omg:session_thread_abc123")).toBe("thread_abc123");
    expect(sessionRefFromHref("https://omg.dev")).toBeNull();
    expect(sessionRefFromHref("omg:bot_0f1e2d3c")).toBeNull();
  });

  test("resolves an unambiguous prefix against known sessions, else nothing", () => {
    const list = [
      { sessionId: FULL, nativeSessionId: null },
      { sessionId: "0f1e9999-aaaa-bbbb-cccc-dddddddddddd", nativeSessionId: null },
    ];
    expect(resolveSessionRef("0f1e2d3c", list)).toBe(FULL);
    expect(resolveSessionRef("0f1e", list)).toBeNull();
    expect(resolveSessionRef("zzzz", list)).toBeNull();
    expect(resolveSessionRef("0f1e2d3c", null)).toBeNull();
  });

  function opener() {
    const opened: string[] = [];
    const pending: { client: SessionRefClient; ref: string; resolve: (id: string | null) => void; reject: (e: unknown) => void }[] = [];
    const it = createSessionRefOpener({
      navigate: (id) => opened.push(id),
      resolve: (client, ref) =>
        new Promise((resolve, reject) => {
          pending.push({ client, ref, resolve, reject });
        }),
    });
    return { it, opened, pending };
  }
  const fakeClient = (): SessionRefClient => ({
    peekSessions: () => [],
    listSessions: async () => [],
    transport: { request: async <T,>() => ({}) as T },
  });

  test("ordinary links are not taken over, and no client means no navigation", () => {
    const { it, opened, pending } = opener();
    expect(it.open("https://omg.dev")).toBe(false);
    expect(it.open("omg:session_0f1e2d3c")).toBe(true);
    expect(pending).toHaveLength(0);
    expect(opened).toEqual([]);
  });

  test("navigates when the client that answered is still the registered one", async () => {
    const { it, opened, pending } = opener();
    const a = fakeClient();
    it.register(a);
    expect(it.open("omg:session_0f1e2d3c")).toBe(true);
    await tick();
    expect(pending[0].client).toBe(a);
    expect(pending[0].ref).toBe("0f1e2d3c");
    pending[0].resolve(FULL);
    await tick();
    expect(opened).toEqual([FULL]);
  });

  test("a lookup that outlives a machine switch or sign-out never navigates", async () => {
    const { it, opened, pending } = opener();
    const a = fakeClient();
    it.register(a);
    it.open("omg:session_0f1e2d3c");
    it.open("omg:session_0f1e2d3c");
    await tick();
    it.register(fakeClient());
    pending[0].resolve(FULL);
    await tick();
    it.register(null);
    pending[1].resolve(FULL);
    await tick();
    expect(opened).toEqual([]);
    // Re-registering the same client later does not revive an old answer either.
    it.register(a);
    it.open("omg:session_0f1e2d3c");
    await tick();
    it.register(fakeClient());
    it.register(a);
    pending[2].resolve(FULL);
    await tick();
    expect(opened).toEqual([FULL]);
  });

  test("a failed or throwing lookup is swallowed, never an unhandled rejection", async () => {
    const { it, opened, pending } = opener();
    it.register(fakeClient());
    it.open("omg:session_0f1e2d3c");
    await tick();
    pending[0].reject(new Error("offline"));
    await tick();
    const throwing = createSessionRefOpener({
      navigate: (id) => opened.push(id),
      resolve: () => {
        throw new Error("sync");
      },
    });
    throwing.register(fakeClient());
    expect(throwing.open("omg:session_0f1e2d3c")).toBe(true);
    await tick();
    expect(opened).toEqual([]);
  });

  test("climbs peek, then the live list, then the catalog, stopping at the first answer", async () => {
    const calls: string[] = [];
    const client = (peek: string[], live: string[], found: string[]): SessionRefClient => ({
      peekSessions: () => {
        calls.push("peek");
        return peek.map((sessionId) => ({ sessionId }));
      },
      listSessions: async () => {
        calls.push("list");
        return live.map((sessionId) => ({ sessionId }));
      },
      transport: {
        request: async <T,>(path: string) => {
          calls.push(path);
          return { sessions: found.map((sessionId) => ({ sessionId })) } as T;
        },
      },
    });
    expect(await resolveSessionRefWith(client([FULL], [], []), "0f1e2d3c")).toBe(FULL);
    expect(calls).toEqual(["peek"]);
    calls.length = 0;
    expect(await resolveSessionRefWith(client([], [FULL], []), "0f1e2d3c")).toBe(FULL);
    expect(calls).toEqual(["peek", "list"]);
    calls.length = 0;
    expect(await resolveSessionRefWith(client([], [], [FULL]), "0f1e2d3c")).toBe(FULL);
    expect(calls).toEqual(["peek", "list", "/api/sessions/find"]);
    expect(await resolveSessionRefWith(client([], [], []), "0f1e2d3c")).toBeNull();
  });
});
