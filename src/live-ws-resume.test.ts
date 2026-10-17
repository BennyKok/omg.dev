// Resume after a drop must never hide a line written while no one listened.
//
// The server follows a transcript only while a socket subscribes to it. A line
// written after the last socket left is in no replay frame, so a reconnect that
// was answered "resumed, nothing missed" lost that line until a reload: a phone
// back from the background, a laptop waking (2026-10-17, scripts/sync-bench.ts).
import { afterAll, beforeAll, expect, test } from "bun:test";
import { appendFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { ServerWebSocket } from "bun";
import { createLiveWsSupport } from "./live-ws.ts";
import { setClaudeProjectsDirForTests } from "./sessions.ts";

const home = mkdtempSync(join(tmpdir(), "omg-resume-"));
const SID = "33333333-3333-4333-8333-333333333333";
const projectDir = join(home, ".claude", "projects", "-bench-project");
const transcript = join(projectDir, `${SID}.jsonl`);

function line(role: "user" | "assistant", text: string, uuid: string, parent: string | null): string {
  const base = { sessionId: SID, uuid, parentUuid: parent, cwd: "/bench/project", timestamp: new Date().toISOString(), isSidechain: false, userType: "external" };
  return JSON.stringify(role === "user"
    ? { ...base, type: "user", message: { role: "user", content: text } }
    : { ...base, type: "assistant", message: { role: "assistant", content: [{ type: "text", text }] } }) + "\n";
}

type Frame = Record<string, unknown>;
type Fake = ServerWebSocket<unknown> & { frames: Frame[] };
let live: { open(ws: unknown): void; message(ws: unknown, raw: string): void; close(ws: unknown): void; dataForRequest(id: string | null): unknown };

beforeAll(() => {
  mkdirSync(projectDir, { recursive: true });
  writeFileSync(transcript, line("user", "hello", "u1", null) + line("assistant", "first reply", "a1", "u1"));
  setClaudeProjectsDirForTests(join(home, ".claude", "projects"));
  live = createLiveWsSupport({ evlog: () => {} }) as unknown as typeof live;
});

afterAll(() => {
  setClaudeProjectsDirForTests(null);
  rmSync(home, { recursive: true, force: true });
});

function socket(): Fake {
  const frames: Frame[] = [];
  const ws = {
    frames,
    data: live.dataForRequest(null),
    send(raw: string) { frames.push(JSON.parse(raw) as Frame); },
    close() {},
  } as unknown as Fake;
  live.open(ws);
  return ws;
}

async function until(check: () => boolean, ms = 5_000): Promise<void> {
  const t0 = Date.now();
  while (!check()) {
    if (Date.now() - t0 > ms) throw new Error("timed out");
    await new Promise((r) => setTimeout(r, 25));
  }
}

const mentions = (ws: Fake, text: string) => ws.frames.some((f) => f.key === SID && JSON.stringify(f).includes(text));

test("a line written while no socket listened reaches the resumed client", async () => {
  const first = socket();
  live.message(first, JSON.stringify({ t: "subscribe", channels: [{ kind: "transcript", key: SID }] }));
  await until(() => first.frames.some((f) => f.t === "snapshot" && f.key === SID));
  appendFileSync(transcript, line("assistant", "while watched", "a2", "a1"));
  await until(() => mentions(first, "while watched"));
  const cursor = Math.max(...first.frames.filter((f) => f.key === SID && typeof f.seq === "number").map((f) => f.seq as number));
  live.close(first);

  appendFileSync(transcript, line("assistant", "while away", "a3", "a2"));
  await new Promise((r) => setTimeout(r, 1_500));

  const again = socket();
  live.message(again, JSON.stringify({ t: "subscribe", channels: [{ kind: "transcript", key: SID, resumeFromSeq: cursor }] }));
  await until(() => mentions(again, "while away"));
  // Not "resumed": the server cannot replay what it never recorded.
  expect(again.frames.some((f) => f.key === SID && f.t === "resumed")).toBe(false);
  expect(again.frames.some((f) => f.key === SID && f.t === "gap")).toBe(true);
  live.close(again);
});
