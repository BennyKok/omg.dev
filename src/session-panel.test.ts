// The agent's status in the side panel (omg_panel): validation, the owner-only
// HTTP route, and how readers see it next to the plan.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { PATHS } from "./config.ts";
import {
  PanelInputError,
  handlePanelRequest,
  normalizePanelStatus,
  readPanelStatus,
} from "./session-panel.ts";
import { readSessionView, summarizeSessionPlan, writeSessionPlan } from "./session-plan.ts";
import { sessionListRow } from "./commands/serve.ts";
import type { Session } from "./sessions.ts";

const home = mkdtempSync(join(tmpdir(), "omg-panel-"));
const originalData = PATHS.data;
beforeAll(() => {
  PATHS.data = home;
});
afterAll(() => {
  PATHS.data = originalData;
  rmSync(home, { recursive: true, force: true });
});

const SID = "11111111-2222-3333-4444-555555555555";
const put = (body: unknown, caller: string | null = SID, sid = SID) =>
  handlePanelRequest(
    new Request(`http://x/api/sessions/${sid}/panel`, {
      method: "PUT",
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
    sid,
    caller,
  );

describe("normalizePanelStatus", () => {
  test("keeps a full status, bounded and typed", () => {
    const s = normalizePanelStatus(
      {
        headline: "  Migrating   tables ",
        text: "**12** of 40",
        stats: [{ label: "Rows", value: 1200 }, { label: "Errors", value: "0", tone: "good" }],
        chart: { kind: "bar", unit: "rows", points: [{ label: "users", value: 10 }] },
      },
      true,
    )!;
    expect(s.headline).toBe("Migrating tables");
    expect(s.stats).toEqual([{ label: "Rows", value: "1200" }, { label: "Errors", value: "0", tone: "good" }]);
    expect(s.chart).toEqual({ kind: "bar", unit: "rows", points: [{ label: "users", value: 10 }] });
  });

  test("the write path rejects what the agent should fix", () => {
    const bad = [
      {},
      { headline: "x", stats: [{ label: "a" }] },
      { headline: "x", chart: { points: [{ label: "a", value: "12" }] } },
      { headline: "x", chart: { kind: "pie", points: [{ label: "a", value: 1 }] } },
      { headline: "x", chart: { points: [] } },
      { headline: "x", stats: Array.from({ length: 9 }, (_, i) => ({ label: `s${i}`, value: i })) },
      { headline: "x", chart: { points: [{ label: "a", value: Number.POSITIVE_INFINITY }] } },
    ];
    for (const raw of bad) expect(() => normalizePanelStatus(raw, true)).toThrow(PanelInputError);
  });

  test("reading a stored file drops what does not fit and keeps the rest", () => {
    const s = normalizePanelStatus({
      headline: "ok",
      stats: [{ label: "a" }, { label: "b", value: "2", tone: "loud" }],
      chart: { points: [{ label: "x", value: "no" }, ...Array.from({ length: 130 }, (_, i) => ({ label: `${i}`, value: i }))] },
    })!;
    expect(s.stats).toEqual([{ label: "b", value: "2" }]);
    expect(s.chart!.points).toHaveLength(120);
    expect(s.chart!.points.at(-1)).toEqual({ label: "129", value: 129 });
  });
});

describe("the panel route", () => {
  test("only the session itself can write its status", async () => {
    const res = await put({ headline: "hi" }, "99999999-2222-3333-4444-555555555555");
    expect(res.status).toBe(403);
    expect((await put({ headline: "hi" }, null)).status).toBe(403);
    expect(readPanelStatus(SID)).toBeNull();
  });

  test("PUT replaces the whole status; bad input is a 400 with the reason", async () => {
    const ok = await put({ headline: "Copying", stats: [{ label: "Done", value: "3/9" }] });
    expect(ok.status).toBe(200);
    expect(readPanelStatus(SID)?.stats).toEqual([{ label: "Done", value: "3/9" }]);

    await put({ headline: "Switching" });
    const now = readPanelStatus(SID)!;
    expect(now.headline).toBe("Switching");
    expect(now.stats).toBeUndefined();

    const bad = await put({ text: "no headline" });
    expect(bad.status).toBe(400);
    expect(((await bad.json()) as { error: string }).error).toContain("headline");
    expect((await put("{nope")).status).toBe(400);
    expect((await put({ headline: "x", text: "y".repeat(70_000) })).status).toBe(413);
    expect(readPanelStatus(SID)?.headline).toBe("Switching");
  });

  test("DELETE clears it", async () => {
    await put({ headline: "Done soon" });
    const res = await handlePanelRequest(new Request("http://x", { method: "DELETE" }), SID, SID);
    expect(await res.json()).toEqual({ ok: true, cleared: true });
    expect(readPanelStatus(SID)).toBeNull();
  });
});

describe("readers", () => {
  test("live-ws and the list see the status folded into the plan", async () => {
    const sid = "22222222-2222-3333-4444-555555555555";
    expect(readSessionView(sid)).toBeNull();
    await put({ headline: "Rendering 3 of 5 assets" }, sid, sid);
    // A status alone is enough to show the pane.
    const alone = readSessionView(sid)!;
    expect(alone.items).toEqual([]);
    expect(alone.status?.headline).toBe("Rendering 3 of 5 assets");

    writeSessionPlan(sid, { source: "claude", updatedAt: 1, items: [{ id: "1", text: "Render", status: "in_progress" }], agents: [] });
    const both = readSessionView(sid)!;
    expect(both.source).toBe("claude");
    expect(both.items).toHaveLength(1);
    expect(both.status?.headline).toBe("Rendering 3 of 5 assets");
    expect(summarizeSessionPlan(both)?.headline).toBe("Rendering 3 of 5 assets");

    const row = sessionListRow({ sessionId: sid, cmd: "x", title: "t" } as unknown as Session) as { plan?: { headline?: string } };
    expect(row.plan?.headline).toBe("Rendering 3 of 5 assets");
  });

  test("a damaged file reads as no status", () => {
    const sid = "33333333-2222-3333-4444-555555555555";
    mkdirSync(join(home, "session-panels"), { recursive: true });
    writeFileSync(join(home, "session-panels", `${sid}.json`), "{not json");
    expect(readPanelStatus(sid)).toBeNull();
  });
});
