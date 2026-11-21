import { afterEach, beforeEach, expect, test } from "bun:test";
import { mount, type Mounted } from "../test-support/render";
import type { DashboardPayload } from "./dashboard-page";

const { default: DashboardPage } = await import("./dashboard-page");

let ui: Mounted;
beforeEach(() => {
  ui = mount();
});
afterEach(() => ui.cleanup());

const SAMPLE_PAYLOAD: DashboardPayload = {
  updatedAt: 1_700_000_000_000,
  editorSessionId: "session-123",
  views: [
    {
      id: "today",
      title: "Today",
      updatedAt: 1_700_000_000_000,
      kpis: [
        { label: "MRR", value: "$228", sub: "14 paying", delta: "+14%", deltaTone: "good", spark: [180, 200, 228] },
        { label: "Findings", value: "2", sub: "1 high · 1 med", tone: "bad" },
      ],
      sections: [
        {
          kind: "list",
          list: {
            title: "Needs you",
            count: 1,
            items: [{ title: "High memory alert", detail: "ops-watch", when: "5m", tone: "bad", badge: "high" }],
          },
        },
        {
          kind: "chart",
          chart: {
            title: "Shipped / day",
            value: "18",
            kind: "bar",
            points: [
              { label: "14 Nov", value: 8 },
              { label: "15 Nov", value: 10 },
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
      ],
    },
    {
      id: "system",
      title: "System",
      updatedAt: 1_700_000_000_000,
      kpis: [{ label: "Uptime", value: "14d 3h" }],
      sections: [],
    },
  ],
};

test("renders KPIs, Needs you list, charts, and tables and switches views", async () => {
  ui.render(<DashboardPage active={false} initialData={SAMPLE_PAYLOAD} />);

  expect(ui.text()).toContain("Dashboard");
  expect(ui.text()).toContain("MRR");
  expect(ui.text()).toContain("$228");
  expect(ui.text()).toContain("Needs you");
  expect(ui.text()).toContain("High memory alert");
  expect(ui.text()).toContain("Shipped / day");
  expect(ui.text()).toContain("Campaigns");
  expect(ui.text()).toContain("Search");

  const systemTab = ui.query('[data-testid="dashboard-tab-system"]') as HTMLElement;
  expect(systemTab).not.toBeNull();
  ui.flush(() => systemTab.click());
  expect(ui.text()).toContain("Uptime");
  expect(ui.text()).toContain("14d 3h");
});

test("Edit hands the open tab to the shell, with no input bar on the page", () => {
  const edits: Array<string | undefined> = [];
  ui.render(
    <DashboardPage active={false} initialData={SAMPLE_PAYLOAD} onEdit={(view) => edits.push(view?.id)} />,
  );
  expect(ui.query("input")).toBeNull();
  expect(ui.query("form")).toBeNull();
  ui.flush(() => (ui.query('[data-testid="dashboard-tab-system"]') as HTMLElement).click());
  ui.flush(() => (ui.query('[data-testid="dashboard-edit"]') as HTMLElement).click());
  expect(edits).toEqual(["system"]);
  // Header: Edit and Refresh only, while no agent is at work.
  expect(ui.query('[data-testid="dashboard-open-agent-session"]')).toBeNull();
});

test("Updating… shows only while the dashboard's own agent works, and opens its chat", () => {
  const busy = new Set<string>(["some-other-session"]);
  const opened: string[] = [];
  const draw = () =>
    ui.render(
      <DashboardPage
        initialData={SAMPLE_PAYLOAD}
        active={false}
        isSessionBusy={(sid) => busy.has(sid)}
        onOpenEditorSession={(sid) => opened.push(sid)}
      />,
    );
  draw();
  expect(ui.text()).not.toContain("Updating…");
  expect(ui.query('[data-testid="dashboard-open-agent-session"]')).toBeNull();
  busy.add("session-123");
  draw();
  expect(ui.text()).toContain("Updating…");
  ui.flush(() => (ui.query('[data-testid="dashboard-open-agent-session"]') as HTMLElement).click());
  expect(opened).toEqual(["session-123"]);
});

test("opens on the first tab, not always on Today", async () => {
  const revenueFirst: DashboardPayload = {
    ...SAMPLE_PAYLOAD,
    views: [
      { id: "revenue", title: "Revenue", order: 0, updatedAt: 1, kpis: [{ label: "MRR", value: "$262.62" }] },
      ...SAMPLE_PAYLOAD.views,
    ],
  };
  ui.render(<DashboardPage active={false} initialData={revenueFirst} />);
  expect(ui.text()).toContain("$262.62");
  expect(ui.text()).not.toContain("High memory alert");
});

test("a table with more than three columns also gets a stacked form for phones", async () => {
  const { DashboardTableCard } = await import("./dashboard-page");
  const columns = [
    { key: "campaign", label: "Campaign" },
    { key: "spend", label: "Spend", align: "right" as const },
    { key: "clicks", label: "Clicks", align: "right" as const },
    { key: "cpc", label: "Cost / click", align: "right" as const },
  ];
  ui.render(
    <DashboardTableCard
      table={{ title: "Ads", columns, rows: [{ cells: { campaign: "YouTube", spend: "35.87", clicks: 47, cpc: "0.76" } }] }}
    />,
  );
  const stacked = ui.query('[data-testid="dashboard-table-stacked"]') as HTMLElement;
  expect(stacked.textContent).toBe("YouTubeSpend35.87Clicks47Cost / click0.76");
  // Three columns fit a phone: no second form.
  ui.render(<DashboardTableCard table={{ title: "Ads", columns: columns.slice(0, 3), rows: [{ cells: { campaign: "YouTube" } }] }} />);
  expect(ui.query('[data-testid="dashboard-table-stacked"]')).toBeNull();
});

test("the To-do tab is always there and opens the add box", () => {
  ui.render(<DashboardPage active={false} initialData={SAMPLE_PAYLOAD} onEdit={() => {}} />);
  expect(ui.query('[data-testid="todo-input"]')).toBeNull();
  ui.flush(() => (ui.query('[data-testid="dashboard-tab-todo"]') as HTMLElement).click());
  expect(ui.query('[data-testid="todo-input"]')).not.toBeNull();
  expect(ui.query('[data-testid="dashboard-edit"]')).toBeNull();
});
