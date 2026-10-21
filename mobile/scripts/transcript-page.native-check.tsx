/** @jsxImportSource ../../web/node_modules/react */
import { mount } from "../../web/src/test-support/render";
import { afterEach, expect, mock, test } from "bun:test";
import * as React from "../../web/node_modules/react";
import { resolve } from "node:path";
mock.module(resolve(import.meta.dir, "../node_modules/react/index.js"), () => React);
const { useTranscriptPage } = await import("../src/omg/use-transcript-page");
const { clearTranscriptCache, writeTranscriptCache, transcriptCacheKey } = await import("../src/omg/transcript-cache");
const rows = (n: number) => Array.from({ length: n }, (_, i) => ({ id: String(i), role: "assistant" as const, text: `Reply ${i}` }));
afterEach(() => clearTranscriptCache());
const noop = () => {};
test("cached text is present on the first render, before refresh resolves", async () => {
  writeTranscriptCache(transcriptCacheKey("mac", "s"), rows(40), 40);
  let resolvePage!: (value: any) => void;
  const client = { getMessages: () => new Promise<any>(resolve => { resolvePage = resolve; }) };
  const paints: { count: number; loading: boolean }[] = [];
  function Probe() {
    const page = useTranscriptPage(client, "mac", "s", noop);
    paints.push({ count: page.messages.length, loading: page.loading });
    return <div>{page.messages.at(-1)?.text}</div>;
  }
  const ui = mount();
  try {
    ui.render(<Probe />);
    expect(paints[0]).toEqual({ count: 40, loading: false });
    expect(ui.text()).toBe("Reply 39");
    await ui.flushAsync(async () => { resolvePage({ messages: rows(41) }); });
    expect(ui.text()).toBe("Reply 40");
  } finally { ui.cleanup(); }
});
type Pending = { path: string; resolve: (value: any) => void };
function pagingClient() {
  const tails: { limit: number; resolve: (value: any) => void }[] = [];
  const older: Pending[] = [];
  const client = {
    getMessages: (_id: string, limit: number) => new Promise<any>(resolve => tails.push({ limit, resolve })),
    transport: { request: (path: string) => new Promise<any>(resolve => older.push({ path, resolve })) },
  };
  return { client, tails, older };
}
const range = (from: number, to: number) => Array.from({ length: to - from }, (_, i) => ({ id: String(from + i), role: "assistant" as const, text: `Reply ${from + i}` }));

test("a folded page shorter than the request is not the start of the session", async () => {
  // 1566 raw messages, workRows on: the machine answered a page of 40 with 7 rows.
  const { client, tails, older } = pagingClient();
  let page!: ReturnType<typeof useTranscriptPage>;
  function Probe() { page = useTranscriptPage(client, "mac", "s", noop); return <div>{page.messages.length}</div>; }
  const ui = mount();
  try {
    ui.render(<Probe />);
    await ui.flushAsync(async () => { tails[0].resolve({ messages: range(100, 107), nextBefore: 1526 }); });
    expect(page.reachedStart).toBe(false);
    ui.flush(() => page.loadMore());
    expect(page.loadingMore).toBe(true);
    expect(older[0].path).toContain("page=backward&before=1526");
    expect(older[0].path).toContain("workRows=1");
    expect(tails.length).toBe(1);
    // The page overlaps the tail by one row; it is not drawn twice.
    await ui.flushAsync(async () => { older[0].resolve({ messages: range(90, 101), nextBefore: 1400 }); });
    expect(page.loadingMore).toBe(false);
    expect(page.messages.map(m => m.id)).toEqual(range(90, 107).map(m => m.id));
    expect(page.reachedStart).toBe(false);
    // Past the 200-message cap the old growing request hit: the cursor keeps going.
    ui.flush(() => page.loadMore());
    expect(older[1].path).toContain("before=1400");
    await ui.flushAsync(async () => { older[1].resolve({ messages: range(80, 90), nextBefore: null }); });
    expect(page.messages[0].id).toBe("80");
    expect(page.reachedStart).toBe(true);
    ui.flush(() => page.loadMore());
    expect(older.length).toBe(2);
  } finally { ui.cleanup(); }
});

test("a scroll to the top before the tail answers loads once the cursor arrives", async () => {
  writeTranscriptCache(transcriptCacheKey("mac", "s"), rows(40), 40);
  const { client, tails, older } = pagingClient();
  let page!: ReturnType<typeof useTranscriptPage>;
  function Probe() { page = useTranscriptPage(client, "mac", "s", noop); return <div>{page.messages.length}</div>; }
  const ui = mount();
  try {
    ui.render(<Probe />);
    expect(page.loading).toBe(false);
    ui.flush(() => page.loadMore());
    expect(older.length).toBe(0);
    await ui.flushAsync(async () => { tails[0].resolve({ messages: rows(40), nextBefore: 60 }); });
    expect(older[0]?.path).toContain("before=60");
  } finally { ui.cleanup(); }
});

test("a machine that sends no cursor keeps the growing request", async () => {
  const { client, tails, older } = pagingClient();
  let page!: ReturnType<typeof useTranscriptPage>;
  function Probe() { page = useTranscriptPage(client, "mac", "s", noop); return <div>{page.messages.length}</div>; }
  const ui = mount();
  try {
    ui.render(<Probe />);
    await ui.flushAsync(async () => { tails[0].resolve({ messages: rows(40) }); });
    expect(page.reachedStart).toBe(false);
    ui.flush(() => page.loadMore());
    expect(tails[1].limit).toBe(80);
    expect(page.messages.length).toBe(40);
    await ui.flushAsync(async () => { tails[1].resolve({ messages: rows(70) }); });
    expect(page.messages.length).toBe(70);
    expect(page.reachedStart).toBe(true);
    expect(older.length).toBe(0);
  } finally { ui.cleanup(); }
});

test("an overlapping live snapshot preserves loaded history and the older page cursor", async () => {
  const { client, tails, older } = pagingClient();
  let page!: ReturnType<typeof useTranscriptPage>;
  function Probe() { page = useTranscriptPage(client, "mac", "s", noop); return <div>{page.messages.length}</div>; }
  const ui = mount();
  try {
    ui.render(<Probe />);
    await ui.flushAsync(async () => { tails[0].resolve({ messages: range(100, 107), nextBefore: 500 }); });
    ui.flush(() => page.loadMore());
    ui.flush(() => page.applySnapshot(range(101, 110), 510));
    await ui.flushAsync(async () => { older[0].resolve({ messages: range(50, 60), nextBefore: 400 }); });
    expect(page.messages.map(m => m.id)).toEqual([...range(50, 60), ...range(100, 110)].map(m => m.id));
    ui.flush(() => page.loadMore());
    expect(older[1].path).toContain("before=400");
  } finally { ui.cleanup(); }
});

test("a reconnect tail keeps the older reply currently on screen and refreshes edited text", async () => {
  const { client, tails, older } = pagingClient();
  let page!: ReturnType<typeof useTranscriptPage>;
  function Probe() {
    page = useTranscriptPage(client, "mac", "s", noop);
    return <div>{page.messages.find(m => m.id === "93")?.text}</div>;
  }
  const ui = mount();
  try {
    ui.render(<Probe />);
    await ui.flushAsync(async () => { tails[0].resolve({ messages: range(94, 101), nextBefore: 564 }); });
    ui.flush(() => page.loadMore());
    await ui.flushAsync(async () => { older[0].resolve({ messages: range(54, 94), nextBefore: 324 }); });
    expect(ui.text()).toBe("Reply 93");
    ui.flush(() => page.applySnapshot(range(94, 102).map(m => m.id === "100" ? { ...m, text: "Updated reply" } : m), 564));
    expect(ui.text()).toBe("Reply 93");
    expect(page.messages.find(m => m.id === "100")?.text).toBe("Updated reply");
    expect(page.messages.at(-1)?.id).toBe("101");
    ui.flush(() => page.loadMore());
    expect(older[1].path).toContain("before=324");
  } finally { ui.cleanup(); }
});

test("late responses from a previous session cannot overwrite the newly mounted page", async () => {
  const requests: { resolve: (value: any) => void }[] = [];
  const client = { getMessages: () => new Promise<any>(resolve => requests.push({ resolve })) };
  function Probe({ id }: { id: string }) { const p = useTranscriptPage(client, "mac", id, noop); return <div>{p.messages[0]?.text ?? "empty"}</div>; }
  const ui = mount();
  try {
    ui.render(<Probe key="a" id="a" />);
    ui.render(<Probe key="b" id="b" />);
    await ui.flushAsync(async () => { requests[1].resolve({ messages: [{ id: "b", text: "Session B" }] }); });
    await ui.flushAsync(async () => { requests[0].resolve({ messages: [{ id: "a", text: "Session A" }] }); });
    expect(ui.text()).toBe("Session B");
  } finally { ui.cleanup(); }
});

test("a disjoint snapshot drops stale history responses even when its cursor matches", async () => {
  const { client, tails, older } = pagingClient();
  let page!: ReturnType<typeof useTranscriptPage>;
  function Probe() { page = useTranscriptPage(client, "mac", "s", noop); return null; }
  const ui = mount();
  try {
    ui.render(<Probe />);
    await ui.flushAsync(async () => { tails[0].resolve({ messages: range(100, 107), nextBefore: 500 }); });
    ui.flush(() => page.loadMore());
    ui.flush(() => page.applySnapshot(range(200, 207), 500));
    await ui.flushAsync(async () => { older[0].resolve({ messages: range(90, 100), nextBefore: 400 }); });
    expect(page.messages.map(m => m.id)).toEqual(range(200, 207).map(m => m.id));
    ui.flush(() => page.loadMore());
    expect(older[1].path).toContain("before=500");
  } finally { ui.cleanup(); }
});

test("a complete snapshot removes deleted rows and keeps confirmed send keys", async () => {
  const { client, tails } = pagingClient();
  let page!: ReturnType<typeof useTranscriptPage>;
  function Probe() { page = useTranscriptPage(client, "mac", "s", noop); return null; }
  const ui = mount();
  try {
    ui.render(<Probe />);
    await ui.flushAsync(async () => { tails[0].resolve({ messages: range(1, 5), nextBefore: null }); });
    ui.flush(() => page.setMessages(prev => prev.map(m => m.id === "4" ? { ...m, localKey: "local-send" } : m)));
    ui.flush(() => page.applySnapshot(range(2, 5), null));
    expect(page.messages.map(m => m.id)).toEqual(["2", "3", "4"]);
    expect(page.messages.at(-1)?.localKey).toBe("local-send");
    expect(page.reachedStart).toBe(true);
  } finally { ui.cleanup(); }
});

test("a late opening request cannot roll a live snapshot and its cache back", async () => {
  const { client, tails } = pagingClient();
  let page!: ReturnType<typeof useTranscriptPage>;
  function Probe() { page = useTranscriptPage(client, "mac", "s", noop); return null; }
  const ui = mount();
  try {
    ui.render(<Probe />);
    ui.flush(() => page.applySnapshot(range(100, 110), 500));
    await ui.flushAsync(async () => { tails[0].resolve({ messages: range(100, 107), nextBefore: 500 }); });
    expect(page.messages.at(-1)?.id).toBe("109");
    const { readTranscriptCache } = await import("../src/omg/transcript-cache");
    expect(readTranscriptCache(transcriptCacheKey("mac", "s"))?.messages.at(-1)?.id).toBe("109");
  } finally { ui.cleanup(); }
});

test("disk-restored text paints before a slow reconnect and keeps the submitted prompt until history arrives", async () => {
  const { sessionCache } = await import("../src/omg/session-cache-store");
  const stored = new Map<string, string>();
  const disk = { getItem: async (key: string) => stored.get(key) ?? null,
    setItem: async (key: string, value: string) => { stored.set(key, value); },
    removeItem: async (key: string) => { stored.delete(key); } };
  await sessionCache.open("alice", disk);
  writeTranscriptCache(transcriptCacheKey("mac", "saved"), rows(3), 40);
  await sessionCache.flush(); clearTranscriptCache();
  await sessionCache.open("other", disk); await sessionCache.open("alice", disk);
  const client = { getMessages: () => new Promise<any>(() => {}) };
  function Probe({ id }: { id: string }) {
    const page = useTranscriptPage(client, "mac", id, noop, "Submitted prompt");
    return <div>{page.messages.at(-1)?.text}</div>;
  }
  const ui = mount();
  try {
    ui.render(<Probe key="saved" id="saved" />);
    expect(ui.text()).toContain("Reply 2");
    ui.render(<Probe key="created" id="created" />);
    expect(ui.text()).toContain("Submitted prompt");
  } finally { ui.cleanup(); clearTranscriptCache(); await sessionCache.clear(); }
});

test("a reply from the previous account cannot populate the new account's cache", async () => {
  const { sessionCache } = await import("../src/omg/session-cache-store");
  const disk = { getItem: async () => null, setItem: async () => {}, removeItem: async () => {} };
  await sessionCache.open("alice", disk);
  let finish!: (value: any) => void;
  const client = { getMessages: () => new Promise<any>(resolve => { finish = resolve; }) };
  function Probe() { const page = useTranscriptPage(client, "mac", "private", noop); return <div>{page.messages[0]?.text}</div>; }
  const ui = mount();
  try {
    ui.render(<Probe />);
    await sessionCache.open("bob", disk);
    await ui.flushAsync(async () => { finish({ messages: rows(2) }); });
    expect(ui.text()).not.toContain("Reply");
    expect(sessionCache.read("transcript:mac:private")).toBeNull();
  } finally { ui.cleanup(); await sessionCache.clear(); }
});
