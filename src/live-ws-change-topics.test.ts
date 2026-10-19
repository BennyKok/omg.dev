// A list an open client shows must be re-read when it changes, not on a timer.
// The web app re-read pins, schedules, findings, bots and repos every 30 s
// while its socket was open, because nothing said when one changed.
//
// Failures this must catch:
// - A store write that open sockets never hear about: the client now polls
//   those lists only every 5 minutes, so a missing announcement is a list
//   that stays wrong for minutes.
// - A socket that opens without the support frame: the client would not know
//   it may stop polling, or that it must re-read what changed while away.
// - A burst of writes sent as one frame per write.
import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { PATHS } from "./config.ts";
import { createLiveWsSupport } from "./live-ws.ts";
import { addQuestion } from "./ask/store.ts";
import { hideRepo } from "./repos-store.ts";
import { createSessionListCache } from "./session-cache.ts";
import { resetSessionPinsDbConnectionForTests, setSessionPinned } from "./session-pins.ts";

const home = mkdtempSync(join(tmpdir(), "omg-change-topics-"));
const originalData = PATHS.data;

beforeAll(() => {
  PATHS.data = join(home, "data");
  resetSessionPinsDbConnectionForTests();
});

afterAll(() => {
  resetSessionPinsDbConnectionForTests();
  PATHS.data = originalData;
  rmSync(home, { recursive: true, force: true });
});

type Frame = { t?: string; topics?: string[] };

async function until(check: () => boolean, ms: number): Promise<void> {
  const t0 = Date.now();
  while (!check()) {
    if (Date.now() - t0 > ms) throw new Error(`timed out after ${ms} ms`);
    await new Promise((r) => setTimeout(r, 5));
  }
}

test("pin, repo and question writes reach an open socket as one changed frame, after the support frame", async () => {
  const live = createLiveWsSupport({
    evlog: () => {},
    sessions: createSessionListCache(async () => []),
  }) as unknown as { open(ws: unknown): void; close(ws: unknown): void; dataForRequest(id: string | null): unknown };
  const frames: Frame[] = [];
  const ws = { data: live.dataForRequest(null), send(raw: string) { frames.push(JSON.parse(raw) as Frame); }, close() {} };
  live.open(ws);
  try {
    const changed = () => frames.filter((f) => f.t === "changed");
    expect(changed()).toEqual([{ t: "changed", topics: [] }]);

    for (let i = 0; i < 5; i++) setSessionPinned(`11111111-1111-4111-8111-11111111111${i}`, true);
    await hideRepo(join(home, "some-repo"));
    await addQuestion({ question: "Which colour?" });
    await until(() => changed().length >= 2, 2_000);
    // Give a second frame the chance to arrive if writes were not coalesced.
    await new Promise((r) => setTimeout(r, 200));
    expect(changed().length).toBe(2);
    expect([...(changed()[1].topics ?? [])].sort()).toEqual(["ask", "pins", "repos"]);
  } finally {
    live.close(ws);
  }
});

// A CLI process uses the same stores, but does not share the server's memory.
// Its committed write must invalidate an already open browser without a poll.
test("a repo write in another process reaches the open socket", async () => {
  const live = createLiveWsSupport({ evlog: () => {}, sessions: createSessionListCache(async () => []) }) as unknown as {
    open(ws: unknown): void; close(ws: unknown): void; dataForRequest(id: string | null): unknown;
  };
  const frames: Frame[] = [];
  const ws = { data: live.dataForRequest(null), send(raw: string) { frames.push(JSON.parse(raw)); }, close() {} };
  live.open(ws);
  try {
    const child = Bun.spawn([process.execPath, "--eval", `
      import { hideRepo } from ${JSON.stringify(join(import.meta.dir, "repos-store.ts"))};
      await hideRepo(${JSON.stringify(join(home, "external-repo"))});
    `], { env: { ...process.env, OMG_DATA_DIR: PATHS.data }, stdout: "pipe", stderr: "pipe" });
    expect(await child.exited).toBe(0);
    await until(() => frames.some(f => f.t === "changed" && f.topics?.includes("repos")), 2_000);
  } finally { live.close(ws); }
});
