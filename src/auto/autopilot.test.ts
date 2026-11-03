import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PATHS } from "../config.ts";
import type { Finding } from "./store.ts";

const originalData = PATHS.data;
let testData = "";
let ap: typeof import("./autopilot.ts");
let store: typeof import("./store.ts");

beforeAll(async () => {
  testData = await mkdtemp(join(tmpdir(), "lfg-autopilot-"));
  PATHS.data = testData;
  ap = await import("./autopilot.ts");
  store = await import("./store.ts");
});

afterEach(async () => {
  await rm(join(testData, "auto"), { recursive: true, force: true });
});

afterAll(async () => {
  PATHS.data = originalData;
  await rm(testData, { recursive: true, force: true });
});

const NOW = 1_800_000_000_000;
const f = (over: Partial<Finding>): Finding => ({
  id: "a1",
  agentId: "watch",
  title: "t",
  reasoning: [],
  severity: "med",
  createdAt: NOW - 1000,
  status: "open",
  ...over,
});

describe("pickCandidates", () => {
  const cfg = () => ({ ...ap.AUTOPILOT_DEFAULTS, enabled: true });

  test("takes open findings only, most severe first, then most recently seen", () => {
    const rows = [
      f({ id: "low", severity: "low" }),
      f({ id: "med-old", severity: "med", createdAt: NOW - 5000 }),
      f({ id: "med-new", severity: "med", createdAt: NOW - 10 }),
      f({ id: "high", severity: "high" }),
      f({ id: "closed", severity: "high", status: "resolved" }),
      f({ id: "busy", severity: "high", status: "session" }),
    ];
    expect(ap.pickCandidates(rows, cfg()).map((r) => r.id)).toEqual(["high", "med-new", "med-old", "low"]);
  });

  test("skips findings held for a human, out of attempts, or from an excluded agent", () => {
    const rows = [
      f({ id: "human", needsHuman: true }),
      f({ id: "tried", autopilot: { attempts: 2, lastAt: NOW } }),
      f({ id: "excluded", agentId: "noisy" }),
      f({ id: "ok", autopilot: { attempts: 1, lastAt: NOW } }),
    ];
    const picked = ap.pickCandidates(rows, { ...cfg(), excludeAgents: ["noisy"] });
    expect(picked.map((r) => r.id)).toEqual(["ok"]);
  });
});

describe("inFlight and stuck", () => {
  test("an autopilot session inside its window is in flight; past it, stuck", () => {
    const cfg = { ...ap.AUTOPILOT_DEFAULTS, enabled: true, inFlightMs: 1000 };
    const fresh = f({ id: "fresh", status: "session", autopilot: { attempts: 1, lastAt: NOW - 10 } });
    const old = f({ id: "old", status: "session", autopilot: { attempts: 1, lastAt: NOW - 5000 } });
    const human = f({ id: "human", status: "session", sessionId: "x" });
    expect(ap.inFlight([fresh, old, human], cfg, NOW).map((r) => r.id)).toEqual(["fresh"]);
    expect(ap.stuck([fresh, old, human], cfg, NOW).map((r) => r.id)).toEqual(["old"]);
  });
});

describe("autopilotTick", () => {
  test("does nothing while the config file is absent", async () => {
    const created = await store.addFinding({ agentId: "w", title: "x", reasoning: [], severity: "high" });
    await ap.autopilotTick(() => {}, NOW);
    expect((await store.listFindings()).find((r) => r.id === created.id)?.status).toBe("open");
  });

  test("a stuck session's finding is reopened, and handed to the owner after the last attempt", async () => {
    await mkdir(join(testData, "auto"), { recursive: true });
    // maxConcurrent 0: this test covers the stuck sweep only, no dispatch.
    await writeFile(
      join(testData, "auto", "autopilot.json"),
      JSON.stringify({ enabled: true, maxConcurrent: 0, inFlightMs: 1000, maxAttempts: 2 }),
    );
    const a = await store.addFinding({ agentId: "w", title: "retry me", reasoning: [], severity: "high" });
    const b = await store.addFinding({ agentId: "w", title: "give up", reasoning: [], severity: "high" });
    await store.updateFinding(a.id, { status: "session", autopilot: { attempts: 1, lastAt: NOW - 5000 } });
    await store.updateFinding(b.id, { status: "session", autopilot: { attempts: 2, lastAt: NOW - 5000 } });

    await ap.autopilotTick(() => {}, NOW);
    const rows = await store.listFindings();
    const ra = rows.find((r) => r.id === a.id)!;
    const rb = rows.find((r) => r.id === b.id)!;
    expect(ra.status).toBe("open");
    expect(ra.needsHuman).toBeUndefined();
    expect(rb.status).toBe("open");
    expect(rb.needsHuman).toBe(true);
    expect(rb.note).toContain("gave up");
  });
});

describe("closedAt", () => {
  test("is stamped on resolve and cleared when the finding reopens", async () => {
    const row = await store.addFinding({ agentId: "w", title: "c", reasoning: [], severity: "low" });
    const resolved = await store.updateFinding(row.id, { status: "resolved", note: "checked" });
    expect(typeof resolved?.closedAt).toBe("number");
    expect(resolved?.note).toBe("checked");
    const reopened = await store.updateFinding(row.id, { status: "open" });
    expect(reopened?.closedAt).toBeUndefined();
  });

  test("a recurring dismissed finding is open again and no longer closed", async () => {
    const row = await store.addFinding({ agentId: "w", title: "disk 91% full", reasoning: [], severity: "med" });
    await store.updateFinding(row.id, { status: "dismissed" });
    const again = await store.recordRecurrence("w", "disk 93% full");
    expect(again?.status).toBe("open");
    expect(again?.closedAt).toBeUndefined();
  });
});
