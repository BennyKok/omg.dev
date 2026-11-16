import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PATHS } from "./config.ts";
import {
  DashboardInputError,
  buildLiveRuntimeViews,
  deleteDashboardView,
  normalizeDashboardView,
  refreshDashboardView,
  resetDashboardBuiltinViews,
  resolveDashboardResponse,
  upsertDashboardView,
} from "./dashboard.ts";

const home = mkdtempSync(join(tmpdir(), "omg-dashboard-"));
const originalData = PATHS.data;

beforeAll(() => {
  PATHS.data = home;
});

afterAll(() => {
  PATHS.data = originalData;
  rmSync(home, { recursive: true, force: true });
});

beforeEach(() => {
  rmSync(join(home, "dashboard"), { recursive: true, force: true });
});

describe("normalizeDashboardView", () => {
  test("validates KPIs, charts, tables, and lists", () => {
    const view = normalizeDashboardView(
      {
        id: "growth",
        title: "  Growth  ",
        kpis: [
          { label: "MRR", value: "$228", delta: "+14%", deltaTone: "good", spark: [180, 200, 228] },
          { label: "Cost / paid", value: 18, tone: "warn", sub: "12 paid" },
        ],
        sections: [
          {
            kind: "chart",
            chart: {
              title: "Sign-ups / day",
              value: "42",
              kind: "bar",
              points: [
                { label: "14 Nov", value: 18 },
                { label: "15 Nov", value: 24 },
              ],
            },
          },
          {
            kind: "table",
            table: {
              title: "Campaigns",
              columns: [
                { key: "name", label: "Campaign" },
                { key: "spend", label: "Spend", align: "right" },
              ],
              rows: [{ id: "c1", tone: "good", cells: { name: "Search", spend: "$120" } }],
            },
          },
          {
            kind: "list",
            list: {
              title: "Needs you",
              count: 1,
              items: [{ title: "Trial ending", detail: "benny@omg.dev", when: "in 2d", tone: "warn" }],
            },
          },
        ],
      },
      true,
    )!;

    expect(view.id).toBe("growth");
    expect(view.title).toBe("Growth");
    expect(view.kpis).toHaveLength(2);
    expect(view.kpis?.[0].spark).toEqual([180, 200, 228]);
    expect(view.sections).toHaveLength(3);
  });

  test("rejects malformed view ids and invalid section kinds in strict mode", () => {
    expect(() => normalizeDashboardView({ id: "BAD ID!", title: "Test" }, true)).toThrow(DashboardInputError);
    expect(() =>
      normalizeDashboardView(
        {
          id: "valid-id",
          title: "Test",
          sections: [{ kind: "unknown" }],
        },
        true,
      ),
    ).toThrow(DashboardInputError);
  });
});

describe("dashboard store and live runtime views", () => {
  const sampleRuntime = {
    sessions: [
      { sessionId: "s1", project: "lfg", agent: "claude", busy: true, lastActivityAt: 1_700_000_000_000 },
      { sessionId: "s2", project: "vibes", agent: "codex", busy: false, lastActivityAt: 1_700_000_000_000 },
    ],
    findings: [
      { id: "f1", agentId: "a1", title: "High memory usage", severity: "high" as const, createdAt: 1_700_000_000_000 },
    ],
    autoAgents: [
      { id: "a1", name: "Security audit", schedule: "0 9 * * *", enabled: true, running: false },
    ],
    shippedPosts: [
      { id: "p1", title: "Mobile nav cleanup", project: "lfg", agent: "claude", ts: 1_700_000_000_000 },
    ],
    reposCount: 4,
    diskFreeBytes: 200 * 1024 * 1024 * 1024,
    diskTotalBytes: 500 * 1024 * 1024 * 1024,
    now: 1_700_000_010_000,
  };

  test("builds Today and System views out of the box", () => {
    const builtins = buildLiveRuntimeViews(sampleRuntime);
    expect(builtins.map((v) => v.id)).toEqual(["today", "system"]);
    expect(builtins[0].kpis?.[0]).toMatchObject({
      label: "Sessions",
      value: "2",
      sub: "1 working · 1 idle",
    });
    expect(builtins[0].kpis?.[1]).toMatchObject({
      label: "Findings",
      value: "1",
      tone: "bad",
    });
  });

  test("merges custom views with built-in views and supports overriding or deleting", () => {
    upsertDashboardView({
      id: "analytics",
      title: "Analytics",
      order: 2,
      kpis: [{ label: "Visitors", value: "1,377" }],
    });
    const res1 = resolveDashboardResponse(sampleRuntime);
    expect(res1.views.map((v) => v.id)).toEqual(["today", "system", "analytics"]);

    // Override built-in Today view
    upsertDashboardView({
      id: "today",
      title: "Today Custom",
      order: 0,
      kpis: [{ label: "MRR", value: "$420" }],
    });
    const res2 = resolveDashboardResponse(sampleRuntime);
    expect(res2.views.find((v) => v.id === "today")?.title).toBe("Today Custom");

    // Reset built-in views restores live Today
    resetDashboardBuiltinViews();
    const res3 = resolveDashboardResponse(sampleRuntime);
    expect(res3.views.find((v) => v.id === "today")?.title).toBe("Today");

    // Delete custom view
    expect(deleteDashboardView("analytics")).toBe(true);
    const res4 = resolveDashboardResponse(sampleRuntime);
    expect(res4.views.map((v) => v.id)).toEqual(["today", "system"]);
  });

  test("executes a scoped refresh script and updates the view in place", async () => {
    const workspace = join(home, "workspace");
    mkdirSync(workspace, { recursive: true });
    const script = join(workspace, "collect.sh");
    writeFileSync(
      script,
      `#!/usr/bin/env bash\necho '{"kpis":[{"label":"Live Users","value":"86","delta":"+12%","deltaTone":"good"}]}'\n`,
    );
    chmodSync(script, 0o755);

    upsertDashboardView(
      {
        id: "growth",
        title: "Growth",
        kpis: [{ label: "Live Users", value: "0" }],
      },
      {
        scopeRoot: workspace,
        refreshScriptPath: script,
      },
    );

    const refreshed = await refreshDashboardView("growth");
    expect(refreshed.kpis).toEqual([
      { label: "Live Users", value: "86", delta: "+12%", deltaTone: "good" },
    ]);
    expect(refreshed.source?.status).toBe("ok");
  });

  test("rejects a refresh script outside the session workspace", () => {
    const workspace = join(home, "workspace-a");
    const outside = join(home, "workspace-b");
    mkdirSync(workspace, { recursive: true });
    mkdirSync(outside, { recursive: true });
    const script = join(outside, "evil.sh");
    writeFileSync(script, "#!/usr/bin/env bash\necho '{}'\n");
    chmodSync(script, 0o755);

    expect(() =>
      upsertDashboardView(
        { id: "growth", title: "Growth" },
        { scopeRoot: workspace, refreshScriptPath: script },
      ),
    ).toThrow(DashboardInputError);
  });
});
