// The agent's plan (src/session-plan.ts) reaches every socket that watches the
// session: the current plan on subscribe, including for a socket that joins
// late, and every later change.
import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { PATHS } from "./config.ts";
import { createLiveWsSupport } from "./live-ws.ts";
import { writeEntry, removeEntry } from "./aisdk-registry.ts";
import { indexSessionMessagesDirect, resetTranscriptIndexConnectionForTests } from "./transcript-index.ts";
import { writeSessionPlan, type SessionPlan } from "./session-plan.ts";
import type { SessionMsg } from "./sessions.ts";

const home = mkdtempSync(join(tmpdir(), "omg-plan-ws-"));
const originalData = PATHS.data;
const SID = "77777777-7777-4777-8777-777777777777";
const CLOSED = "66666666-6666-4666-8666-666666666666";

const plan = (status: "pending" | "in_progress" | "completed"): SessionPlan => ({
  source: "claude",
  updatedAt: Date.now(),
  items: [
    { id: "todo-1", text: "Read the code", status: "completed" },
    { id: "todo-2", text: "Write the tests", status },
  ],
  agents: [{ id: "toolu_1", title: "Search the repo", kind: "Explore", status: "running", startedAt: 1 }],
});

type Frame = Record<string, unknown>;
type Fake = { frames: Frame[]; data: unknown; send(raw: string): void; close(): void };
let live: { open(ws: unknown): void; message(ws: unknown, raw: string): void; close(ws: unknown): void; dataForRequest(id: string | null): unknown };

beforeAll(() => {
  PATHS.data = join(home, "data");
  resetTranscriptIndexConnectionForTests();
  for (const sid of [SID, CLOSED]) {
    indexSessionMessagesDirect(sid, [{ id: `u-${sid}`, role: "user", kind: "text", text: "go", ts: Date.now() } as SessionMsg]);
  }
  writeEntry({
    sessionId: SID,
    agent: "claude",
    cwd: home,
    model: "haiku",
    busy: true,
    createdAt: Date.now(),
  } as Parameters<typeof writeEntry>[0]);
  writeSessionPlan(SID, plan("in_progress"));
  // A finished session: no registry entry, but its last plan is on disk.
  writeSessionPlan(CLOSED, plan("completed"));
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

async function watch(sid: string): Promise<Fake> {
  const frames: Frame[] = [];
  const ws: Fake = { frames, data: live.dataForRequest(null), send(raw) { frames.push(JSON.parse(raw) as Frame); }, close() {} };
  live.open(ws);
  live.message(ws, JSON.stringify({ t: "subscribe", channels: [{ kind: "transcript", key: sid }] }));
  await until(() => frames.some((f) => f.t === "snapshot"), 5_000);
  return ws;
}

/** Every plan the socket received, direct or inside a channel delta, in order. */
function plans(ws: Fake): Array<SessionPlan | null> {
  const out: Array<SessionPlan | null> = [];
  for (const f of ws.frames) {
    if (f.t === "plan") out.push((f.plan as SessionPlan | null) ?? null);
    const d = f.delta as Frame | undefined;
    if (f.t === "delta" && d?.t === "plan") out.push((d.plan as SessionPlan | null) ?? null);
  }
  return out;
}
const lastStatus = (ws: Fake) => plans(ws).at(-1)?.items[1]?.status;

test("a subscriber gets the current plan, and so does one that joins later", async () => {
  const first = await watch(SID);
  const second = await watch(SID);
  try {
    await until(() => lastStatus(first) === "in_progress", 3_000);
    await until(() => lastStatus(second) === "in_progress", 3_000);
    expect(plans(second).at(-1)?.agents[0]).toMatchObject({ title: "Search the repo", status: "running" });
  } finally {
    live.close(first);
    live.close(second);
  }
}, 15_000);

test("a change to the plan reaches every watching socket", async () => {
  const a = await watch(SID);
  const b = await watch(SID);
  try {
    await until(() => lastStatus(a) === "in_progress" && lastStatus(b) === "in_progress", 3_000);
    writeSessionPlan(SID, plan("completed"));
    await until(() => lastStatus(a) === "completed" && lastStatus(b) === "completed", 4_000);
  } finally {
    live.close(a);
    live.close(b);
  }
}, 15_000);

test("a finished session still shows its last plan", async () => {
  const ws = await watch(CLOSED);
  try {
    await until(() => lastStatus(ws) === "completed", 3_000);
  } finally {
    live.close(ws);
  }
}, 15_000);
