import { test, expect, spyOn } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { PATHS } from "./config.ts";
import { onChangeAnnounced } from "./change-topics.ts";
import { startThread, setTyping, threadTyping } from "./threads.ts";

// Without polling, both typing start and expiry must wake connected viewers.
test("thread typing announces visible changes and expiry, but not heartbeats", async () => {
  const original = PATHS.data;
  const root = mkdtempSync(join(tmpdir(), "thread-live-"));
  PATHS.data = root;
  const thread = startThread({ identity: "typing-events@example.com" });
  const author = { kind: "human" as const, participantId: "typing-events", name: "Writer" };
  let changes = 0;
  const timers: ReturnType<typeof setTimeout>[] = [];
  const expire: Array<() => void> = [];
  const schedule = globalThis.setTimeout;
  const clock = spyOn(globalThis, "setTimeout").mockImplementation(((fn: () => void, delay: number) => {
    expect(delay).toBe(6_000);
    expire.push(fn);
    const timer = schedule(() => {}, 1_000_000);
    timers.push(timer);
    return timer;
  }) as typeof setTimeout);
  const off = onChangeAnnounced(topic => { if (topic === "threads") changes++; });
  try {
    setTyping(thread.id, author, true);
    expect(changes).toBe(1);
    setTyping(thread.id, author, true);
    expect(changes).toBe(1);
    clock.mockRestore();
    expire[0]!(); // A stale expiry must not clear the renewed claim.
    expect(changes).toBe(1);
    expire[1]!();
    expect(changes).toBe(2);
    expect(threadTyping(thread.id)).toEqual([]);
  } finally {
    clock.mockRestore();
    for (const timer of timers) clearTimeout(timer);
    setTyping(thread.id, author, false);
    off();
    PATHS.data = original;
    rmSync(root, { recursive: true, force: true });
  }
}, 8_000);
