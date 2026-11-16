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

test("sends agent edit requests for the active view and opens the linked session", async () => {
  const asks: Array<{ prompt: string; viewId: string | undefined }> = [];
  const opened: string[] = [];

  ui.render(
    <DashboardPage
      active={false}
      initialData={SAMPLE_PAYLOAD}
      onAskAgent={(prompt, view) => {
        asks.push({ prompt, viewId: view?.id });
      }}
      onOpenEditorSession={(sid) => opened.push(sid)}
    />,
  );

  // Quick prompt chip populates input and form submit invokes onAskAgent
  const chip = ui.queryAll("button").find((b) => b.textContent === "Add an Analytics tab with 7d metrics")!;
  ui.flush(() => chip.click());

  const form = ui.query('[data-testid="dashboard-agent-form"]') as HTMLFormElement;
  await ui.flushAsync(() => {
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
  expect(asks).toEqual([
    { prompt: "Add an Analytics tab with 7d metrics", viewId: "today" },
  ]);

  const openChatBtn = ui.query('[data-testid="dashboard-open-agent-session"]') as HTMLElement;
  ui.flush(() => openChatBtn.click());
  expect(opened).toEqual(["session-123"]);
});

test("Updating… follows the dashboard's own agent session, not any busy agent", async () => {
  const busy = new Set<string>(["some-other-session"]);
  ui.render(
    <DashboardPage
      initialData={SAMPLE_PAYLOAD}
      active={false}
      isSessionBusy={(sid) => busy.has(sid)}
      onOpenEditorSession={() => {}}
    />,
  );
  expect(ui.text()).not.toContain("Updating…");
  expect(ui.text()).toContain("Agent chat");
  busy.add("session-123");
  ui.render(
    <DashboardPage
      initialData={SAMPLE_PAYLOAD}
      active={false}
      isSessionBusy={(sid) => busy.has(sid)}
      onOpenEditorSession={() => {}}
    />,
  );
  expect(ui.text()).toContain("Updating…");
});
