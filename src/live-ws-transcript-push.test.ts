// A new agent line must reach a watching socket when it is written, not on the
// next poll. The file tailer polled every 700 ms and the index-backed path
// (agent harnesses that write the transcript index from their own process)
// every 1 s, so a line took up to that long to appear (scripts/sync-bench.ts,
// 2026-10-17: p95 700 ms). Each test writes just after a poll would have run,
// so a poll alone could not meet the deadline.
import { afterAll, beforeAll, test } from "bun:test";
import { appendFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { PATHS } from "./config.ts";
import { createLiveWsSupport } from "./live-ws.ts";
import { setClaudeProjectsDirForTests, type SessionMsg } from "./sessions.ts";
import { indexSessionMessagesDirect, resetTranscriptIndexConnectionForTests } from "./transcript-index.ts";

const home = mkdtempSync(join(tmpdir(), "omg-transcript-push-"));
const originalData = PATHS.data;
const FILE_SID = "66666666-6666-4666-8666-666666666666";
const INDEX_SID = "77777777-7777-4777-8777-777777777777";
const projectDir = join(home, ".claude", "projects", "-bench-project");
const transcript = join(projectDir, `${FILE_SID}.jsonl`);
const DEADLINE_MS = 300;

function line(role: "user" | "assistant", text: string, uuid: string, parent: string | null): string {
  const base = { sessionId: FILE_SID, uuid, parentUuid: parent, cwd: "/bench/project", timestamp: new Date().toISOString(), isSidechain: false, userType: "external" };
  return JSON.stringify(role === "user"
    ? { ...base, type: "user", message: { role: "user", content: text } }
    : { ...base, type: "assistant", message: { role: "assistant", content: [{ type: "text", text }] } }) + "\n";
}

function msg(id: string, role: string, text: string): SessionMsg {
  return { id, role, kind: "text", text, ts: Date.now() } as SessionMsg;
}

type Frame = Record<string, unknown>;
type Fake = { frames: Frame[]; data: unknown; send(raw: string): void; close(): void };
let live: { open(ws: unknown): void; message(ws: unknown, raw: string): void; close(ws: unknown): void; dataForRequest(id: string | null): unknown };

beforeAll(() => {
  mkdirSync(projectDir, { recursive: true });
  writeFileSync(transcript, line("user", "hello", "u1", null) + line("assistant", "first reply", "a1", "u1"));
  setClaudeProjectsDirForTests(join(home, ".claude", "projects"));
  PATHS.data = join(home, "data");
  resetTranscriptIndexConnectionForTests();
  indexSessionMessagesDirect(INDEX_SID, [msg("u1", "user", "hello"), msg("a1", "assistant", "first reply")]);
  live = createLiveWsSupport({ evlog: () => {} }) as unknown as typeof live;
});

afterAll(() => {
  setClaudeProjectsDirForTests(null);
  resetTranscriptIndexConnectionForTests();
  PATHS.data = originalData;
  rmSync(home, { recursive: true, force: true });
});

function socket(): Fake {
  const frames: Frame[] = [];
  const ws: Fake = { frames, data: live.dataForRequest(null), send(raw) { frames.push(JSON.parse(raw) as Frame); }, close() {} };
  live.open(ws);
  return ws;
}

async function until(check: () => boolean, ms: number): Promise<void> {
  const t0 = Date.now();
  while (!check()) {
    if (Date.now() - t0 > ms) throw new Error(`timed out after ${ms} ms`);
    await new Promise((r) => setTimeout(r, 5));
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const mentions = (ws: Fake, sid: string, text: string) => ws.frames.some((f) => f.key === sid && f.t === "delta" && JSON.stringify(f).includes(text));

async function watch(sid: string): Promise<{ ws: Fake; subscribedAt: number }> {
  const ws = socket();
  const subscribedAt = Date.now();
  live.message(ws, JSON.stringify({ t: "subscribe", channels: [{ kind: "transcript", key: sid }] }));
  await until(() => ws.frames.some((f) => f.t === "snapshot" && f.key === sid), 5_000);
  return { ws, subscribedAt };
}

test("a line an agent appends to its transcript file reaches the socket at once", async () => {
  const { ws, subscribedAt } = await watch(FILE_SID);
  try {
    // The file poll runs every 700 ms from the subscribe. Write just after one.
    await sleep(Math.max(0, subscribedAt + 760 - Date.now()));
    appendFileSync(transcript, line("assistant", "file line", "a2", "a1"));
    await until(() => mentions(ws, FILE_SID, "file line"), DEADLINE_MS);
  } finally {
    live.close(ws);
  }
}, 15_000);

test("a row a harness writes to the transcript index reaches the socket at once", async () => {
  const { ws, subscribedAt } = await watch(INDEX_SID);
  try {
    // The index poll runs every 1 s from the subscribe. Write just after one.
    await sleep(Math.max(0, subscribedAt + 1_080 - Date.now()));
    indexSessionMessagesDirect(INDEX_SID, [msg("a2", "assistant", "index line")]);
    await until(() => mentions(ws, INDEX_SID, "index line"), DEADLINE_MS);
  } finally {
    live.close(ws);
  }
}, 15_000);
