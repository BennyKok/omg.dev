import { afterEach, beforeEach, expect, test } from "bun:test";
import { mount, type Mounted } from "./test-support/render";

const { AgentReportSheet } = await import("./App");
const { AutoAgentPageInStage } = await import("./components/auto-agent-page");

let ui: Mounted;
beforeEach(() => {
  ui = mount();
  // The launch settings read the bare global, as the browser has it.
  (globalThis as { localStorage?: Storage }).localStorage = window.localStorage;
  window.localStorage.clear();
});
afterEach(() => ui.cleanup());

const now = Date.now();
const finding = (id: string, severity: "high" | "med" | "low", title: string) =>
  ({
    id,
    agentId: "repo-review",
    title,
    severity,
    reasoning: [`why ${id}`],
    suggest: `fix ${id}`,
    createdAt: now - 60_000,
    status: "open",
  }) as never;

function renderInStage(findings: never[]) {
  ui.render(
    <AutoAgentPageInStage.Provider value>
      <AgentReportSheet
        agentName="Repo review"
        findings={findings}
        tz="UTC"
        onClose={() => {}}
        onReply={async () => {}}
        onDismiss={() => {}}
        onDismissAll={() => {}}
        onEditAgent={() => {}}
      />
    </AutoAgentPageInStage.Provider>,
  );
}

test("in the stage the report is a list beside the worst finding, named once", () => {
  renderInStage([finding("a", "low", "Low thing"), finding("b", "high", "Prod is on fire")]);
  expect(ui.query('[role="dialog"]')).toBeNull();
  expect(ui.query('nav ul[aria-label="Repo review findings"]')).not.toBeNull();
  // The worst finding opens without a click, and there is no back link.
  expect(ui.query("h3")?.textContent).toBe("Prod is on fire");
  expect(ui.text()).not.toContain("All 2");
  expect(ui.text().match(/Repo review/g)?.length).toBe(1);

  const low = ui.queryAll("nav button").find((b) => b.textContent?.includes("Low thing"))!;
  ui.flush(() => (low as HTMLElement).click());
  expect(ui.query("h3")?.textContent).toBe("Low thing");
  expect(low.getAttribute("aria-current")).toBe("true");
});

test("one finding needs no list", () => {
  renderInStage([finding("a", "med", "Only one")]);
  expect(ui.query("nav")).toBeNull();
  expect(ui.query("h3")?.textContent).toBe("Only one");
});

test("the finding footer uses the home composer's agent and model pill, and has no Feedback", () => {
  renderInStage([finding("a", "high", "Prod is on fire")]);
  const footer = ui.query("footer")!;
  expect(footer.querySelector('button[aria-label^="Agent "][aria-label$="Change agent or model"]')).not.toBeNull();
  const labels = Array.from(footer.querySelectorAll("button")).map((b) => b.textContent?.trim());
  expect(labels).toContain("Make the change");
  expect(labels).toContain("Dismiss");
  expect(labels).not.toContain("Feedback");
});
