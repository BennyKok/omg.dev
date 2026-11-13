// A new agent line must reach a watching socket on a write notification,
// without waiting for the file or index fallback poll.
import { afterAll, beforeAll, spyOn, test } from "bun:test";
import { appendFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { PATHS } from "./config.ts";
import { ensureChatTranscriptCaughtUp } from "./chat-ingest.ts";
import { createLiveWsSupport } from "./live-ws.ts";
import { setClaudeProjectsDirForTests, type SessionMsg } from "./sessions.ts";
import { indexSessionMessagesDirect, resetTranscriptIndexConnectionForTests } from "./transcript-index.ts";

const home = mkdtempSync(join(tmpdir(), "omg-transcript-push-"));
const originalData = PATHS.data;
const FILE_SID = "66666666-6666-4666-8666-666666666666";
const INDEX_SID = "77777777-7777-4777-8777-777777777777";
const projectDir = join(home, ".claude", "projects", "-bench-project");
const transcript = join(projectDir, `${FILE_SID}.jsonl`);
// Prove write notifications work without a poll, rather than racing a 300 ms
// wall-clock budget on a busy test host. Periodic fallback polls cannot fire
// during either test; file/index write notifications remain real.
const DEADLINE_MS = 5_000;
const realSetInterval = globalThis.setInterval;
let intervals: ReturnType<typeof spyOn>;

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
  intervals = spyOn(globalThis, "setInterval").mockImplementation(((callback: Parameters<typeof setInterval>[0], _delay?: number, ...args: unknown[]) =>
    realSetInterval(callback, 60_000, ...args)) as typeof setInterval);
  mkdirSync(projectDir, { recursive: true });
  writeFileSync(transcript, line("user", "hello", "u1", null) + line("assistant", "first reply", "a1", "u1"));
  setClaudeProjectsDirForTests(join(home, ".claude", "projects"));
  PATHS.data = join(home, "data");
  resetTranscriptIndexConnectionForTests();
  indexSessionMessagesDirect(INDEX_SID, [msg("u1", "user", "hello"), msg("a1", "assistant", "first reply")]);
  live = createLiveWsSupport({ evlog: () => {} }) as unknown as typeof live;
});

afterAll(() => {
  intervals.mockRestore();
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

const mentions = (ws: Fake, sid: string, text: string) => ws.frames.some((f) => f.key === sid && f.t === "delta" && JSON.stringify(f).includes(text));

async function watch(sid: string): Promise<Fake> {
  const ws = socket();
  live.message(ws, JSON.stringify({ t: "subscribe", channels: [{ kind: "transcript", key: sid }] }));
  await until(() => ws.frames.some((f) => f.t === "snapshot" && f.key === sid), 5_000);
  return ws;
}

test("a line an agent appends to its transcript file reaches the socket at once", async () => {
  const ws = await watch(FILE_SID);
  try {
    // Finish the initial read before appending: the notification, not a read
    // already in flight when we subscribed, must deliver the new line.
    await ensureChatTranscriptCaughtUp(transcript, FILE_SID);
    appendFileSync(transcript, line("assistant", "file line", "a2", "a1"));
    await until(() => mentions(ws, FILE_SID, "file line"), DEADLINE_MS);
  } finally {
    live.close(ws);
  }
}, 15_000);

test("a row a harness writes to the transcript index reaches the socket at once", async () => {
  const ws = await watch(INDEX_SID);
  try {
    indexSessionMessagesDirect(INDEX_SID, [msg("a2", "assistant", "index line")]);
    await until(() => mentions(ws, INDEX_SID, "index line"), DEADLINE_MS);
  } finally {
    live.close(ws);
  }
}, 15_000);
