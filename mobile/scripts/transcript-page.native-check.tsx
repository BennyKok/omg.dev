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
test("pagination keeps the current page and stays pending until the request finishes", async () => {
  writeTranscriptCache(transcriptCacheKey("mac", "s"), rows(40), 40);
  const requests: { limit: number; resolve: (value: any) => void }[] = [];
  const client = { getMessages: (_id: string, limit: number) => new Promise<any>(resolve => requests.push({ limit, resolve })) };
  let page!: ReturnType<typeof useTranscriptPage>;
  function Probe() { page = useTranscriptPage(client, "mac", "s", noop); return <div>{page.messages.length}</div>; }
  const ui = mount();
  try {
    ui.render(<Probe />);
    await ui.flushAsync(async () => { requests[0].resolve({ messages: rows(40) }); });
    ui.flush(() => page.loadMore());
    expect(requests[1].limit).toBe(80);
    expect(page.loadingMore).toBe(true);
    expect(page.messages.length).toBe(40);
    await ui.flushAsync(async () => { requests[1].resolve({ messages: rows(80) }); });
    expect(page.loadingMore).toBe(false);
    ui.flush(() => page.loadMore());
    expect(page.messages.length).toBe(80);
    expect(requests[2].limit).toBe(120);
    await ui.flushAsync(async () => { requests[2].resolve({ messages: rows(100) }); });
    expect(page.reachedStart).toBe(true);
    ui.flush(() => page.loadMore());
    expect(requests.length).toBe(3);
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
