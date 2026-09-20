import { expect, test } from "bun:test";
import { SessionCacheStore, type CacheStorage } from "../mobile/src/omg/session-cache-store";
function storage() {
  const rows = new Map<string, string>();
  return { rows, getItem: async (key: string) => rows.get(key) ?? null,
    setItem: async (key: string, value: string) => { rows.set(key, value); },
    removeItem: async (key: string) => { rows.delete(key); } };
}
test("restores saved roster and transcript after process restart, scoped to account and machine", async () => {
  const disk = storage(); const cache = new SessionCacheStore();
  await cache.open("alice", disk);
  cache.write("roster:mac", [{ sessionId: "one" }]);
  cache.write("transcript:mac:one", { messages: [{ id: "1", text: "hello" }] });
  await cache.flush();
  const restarted = new SessionCacheStore(); await restarted.open("alice", disk);
  expect(restarted.read("roster:mac")).toEqual([{ sessionId: "one" }]);
  expect(restarted.read("transcript:mac:one")).toEqual({ messages: [{ id: "1", text: "hello" }] });
  expect(restarted.read("roster:other")).toBeNull();
  await restarted.open("bob", disk);
  expect(restarted.read("roster:mac")).toBeNull();
  await restarted.clear();
});
test("sign out removes saved data even when a write was queued", async () => {
  const disk = storage(); const cache = new SessionCacheStore();
  await cache.open("alice", disk); cache.write("roster:mac", [1]);
  const writing = cache.flush(); await cache.clear(); await writing;
  const restarted = new SessionCacheStore(); await restarted.open("alice", disk);
  expect(restarted.read("roster:mac")).toBeNull();
  expect(disk.rows.size).toBe(0);
});
test("corrupt and expired caches do not block startup", async () => {
  const disk = storage(); const cache = new SessionCacheStore();
  disk.rows.set("omg:session-cache:v1:alice", "broken");
  await cache.open("alice", disk); expect(cache.read("a")).toBeNull();
  disk.rows.set("omg:session-cache:v1:bob", JSON.stringify([["a", { at: 1, value: "old" }]]));
  await cache.open("bob", disk); expect(cache.read("a")).toBeNull(); await cache.clear();
});
test("a late restore cannot populate a different account", async () => {
  let resolve!: (s: string) => void;
  const disk: CacheStorage = { getItem: (key) => key.endsWith("alice") ? new Promise(r => { resolve = r; }) : Promise.resolve(null), setItem: async () => {}, removeItem: async () => {} };
  const cache = new SessionCacheStore(); const old = cache.open("alice", disk);
  await Promise.resolve(); await Promise.resolve();
  await cache.open("bob", disk);
  resolve(JSON.stringify([["private", { at: Date.now(), value: "alice" }]]));
  await old; expect(cache.read("private")).toBeNull(); await cache.clear();
});

test("bounded snapshots retain the selected computer and skip oversized pages", async () => {
  const disk = storage(); const cache = new SessionCacheStore();
  await cache.open("alice", disk); cache.write("binding", "mac");
  for (let i = 0; i < 80; i++) cache.write(`transcript:mac:${i}`, [{ id: String(i) }]);
  cache.write("huge", "x".repeat(600 * 1024));
  await cache.flush();
  const restored = new SessionCacheStore(); await restored.open("alice", disk);
  expect(restored.read("binding")).toBe("mac");
  expect(restored.read("transcript:mac:0")).toBeNull();
  expect(restored.read("transcript:mac:79")).toEqual([{ id: "79" }]);
  expect(restored.read("huge")).toBeNull();
  await restored.clear();
});
test("storage failures do not prevent reading the live in-memory snapshot", async () => {
  const disk: CacheStorage = { getItem: async () => { throw Error("unavailable"); },
    setItem: async () => { throw Error("full"); }, removeItem: async () => { throw Error("unavailable"); } };
  const cache = new SessionCacheStore(); await cache.open("alice", disk);
  cache.write("roster:mac", [{ sessionId: "one" }]); await cache.flush();
  expect(cache.read("roster:mac")).toEqual([{ sessionId: "one" }]); await cache.clear();
});
