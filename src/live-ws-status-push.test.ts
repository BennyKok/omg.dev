// A session change must reach open sockets when it happens, not on the next
// poll. The status broadcast used to poll every 1 s and read a session list
// cached for 3 s, so a rename took 2.8 to 3.0 s to show on another device
// (scripts/sync-bench.ts, 2026-10-17). Every session write already calls the
// cache's invalidate(); the broadcast now publishes on that signal.
import { expect, test } from "bun:test";
import { createLiveWsSupport } from "./live-ws.ts";
import { createSessionListCache } from "./session-cache.ts";
import type { Session } from "./sessions.ts";

type Frame = { t?: string; rows?: Array<{ sessionId?: string; title?: string }> };
type Live = { open(ws: unknown): void; close(ws: unknown): void; dataForRequest(id: string | null): unknown };

const SID = "44444444-4444-4444-8444-444444444444";

async function until(check: () => boolean, ms: number): Promise<void> {
  const t0 = Date.now();
  while (!check()) {
    if (Date.now() - t0 > ms) throw new Error(`timed out after ${ms} ms`);
    await new Promise((r) => setTimeout(r, 5));
  }
}

test("a renamed session reaches an open socket without waiting for the poll or the cache", async () => {
  let title = "before";
  // The real cache, over a scan that reads the current title.
  const sessions = createSessionListCache(async () => [{ sessionId: SID, title } as unknown as Session]);
  const ticks: number[] = [];
  const live = createLiveWsSupport({
    sessions,
    evlog: (event) => { if (event === "live_status_tick") ticks.push(Date.now()); },
  }) as unknown as Live;
  const frames: Frame[] = [];
  const ws = { data: live.dataForRequest(null), send(raw: string) { frames.push(JSON.parse(raw) as Frame); }, close() {} };
  const titled = (want: string) => frames.some((f) => f.t === "status" && f.rows?.some((r) => r.sessionId === SID && r.title === want));
  live.open(ws);
  try {
    await until(() => titled("before"), 2_000);
    // Rename just after the 1 s loop ticked, with the cache warm. A poll alone
    // would show the new title only after the next tick and the cache TTL.
    const seen = ticks.length;
    await until(() => ticks.length > seen, 2_000);
    title = "after";
    const t0 = Date.now();
    sessions.invalidate();
    await until(() => titled("after"), 300);
    expect(Date.now() - t0).toBeLessThan(300);
  } finally {
    live.close(ws);
  }
});
