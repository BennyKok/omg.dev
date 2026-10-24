// An open question reaches every socket that watches the session, including
// one that joins after it was asked.
//
// The session watcher publishes a question only when it changes, once per
// session. A second socket (another tab, the phone while the laptop is open, a
// resubscribe) that subscribed after the question was asked never received it,
// so the question card was missing there until the next change.
import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { PATHS } from "./config.ts";
import { createLiveWsSupport } from "./live-ws.ts";
import { writeEntry, removeEntry } from "./aisdk-registry.ts";
import { indexSessionMessagesDirect, resetTranscriptIndexConnectionForTests } from "./transcript-index.ts";
import type { SessionMsg } from "./sessions.ts";

const home = mkdtempSync(join(tmpdir(), "omg-prompt-join-"));
const originalData = PATHS.data;
const SID = "88888888-8888-4888-8888-888888888888";
const question = {
  question: "Which fruit do you like?",
  header: "Fruit",
  options: [
    { index: 0, label: "Apple", selected: false },
    { index: 1, label: "Pear", selected: false },
  ],
};

type Frame = Record<string, unknown>;
type Fake = { frames: Frame[]; data: unknown; send(raw: string): void; close(): void };
let live: { open(ws: unknown): void; message(ws: unknown, raw: string): void; close(ws: unknown): void; dataForRequest(id: string | null): unknown };

beforeAll(() => {
  PATHS.data = join(home, "data");
  resetTranscriptIndexConnectionForTests();
  indexSessionMessagesDirect(SID, [{ id: "u1", role: "user", kind: "text", text: "ask me", ts: Date.now() } as SessionMsg]);
  writeEntry({
    sessionId: SID,
    agent: "claude",
    cwd: home,
    model: "haiku",
    busy: false,
    createdAt: Date.now(),
    prompt: question,
  } as Parameters<typeof writeEntry>[0]);
  live = createLiveWsSupport({ evlog: () => {} }) as unknown as typeof live;
});

afterAll(() => {
  removeEntry(SID);
  resetTranscriptIndexConnectionForTests();
  PATHS.data = originalData;
  rmSync(home, { recursive: true, force: true });
});

async function until(check: () => boolean, ms: number): Promise<void> {
  const t0 = Date.now();
  while (!check()) {
    if (Date.now() - t0 > ms) throw new Error(`timed out after ${ms} ms`);
    await new Promise((r) => setTimeout(r, 5));
  }
}

async function watch(): Promise<Fake> {
  const frames: Frame[] = [];
  const ws: Fake = { frames, data: live.dataForRequest(null), send(raw) { frames.push(JSON.parse(raw) as Frame); }, close() {} };
  live.open(ws);
  live.message(ws, JSON.stringify({ t: "subscribe", channels: [{ kind: "transcript", key: SID }] }));
  await until(() => frames.some((f) => f.t === "snapshot"), 5_000);
  return ws;
}

const hasQuestion = (ws: Fake) =>
  ws.frames.some((f) => JSON.stringify(f).includes("Which fruit do you like?"));

test("a socket that joins after the question was asked still gets it", async () => {
  const first = await watch();
  const second = await watch();
  try {
    await until(() => hasQuestion(first), 2_000);
    await until(() => hasQuestion(second), 2_000);
    expect(hasQuestion(second)).toBe(true);
  } finally {
    live.close(first);
    live.close(second);
  }
}, 15_000);
