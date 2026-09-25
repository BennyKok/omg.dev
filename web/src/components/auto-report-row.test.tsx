import { afterEach, beforeEach, expect, mock, test } from "bun:test";
import { act } from "react";
import { mount, type Mounted } from "../test-support/render";
const { AutoReportRow } = await import("./auto-report-row");

let ui: Mounted;
beforeEach(() => {
  ui = mount();
});
afterEach(() => ui.cleanup());

const report = {
  agentId: "fleet",
  severity: "high" as const,
  latestAt: Date.now(),
  findings: [
    { id: "a", agentId: "fleet", severity: "high" as const, createdAt: 1, title: "Disk full" },
    { id: "b", agentId: "fleet", severity: "low" as const, createdAt: 2, title: "Slow build" },
  ],
};

function click(el: Element | null) {
  if (!el) throw new Error("missing element");
  act(() => {
    (el as HTMLElement).click();
  });
}

test("triage button triages only this group and does not open the report", () => {
  const onOpen = mock(() => {});
  const onTriage = mock(() => {});
  ui.render(<AutoReportRow report={report} agentName="Fleet Health" onOpen={onOpen} onTriage={onTriage} />);
  click(ui.query('[aria-label="Triage and execute 2 Fleet Health findings"]'));
  expect(onTriage).toHaveBeenCalledTimes(1);
  expect(onOpen).not.toHaveBeenCalled();
  click(ui.query("button"));
  expect(onOpen).toHaveBeenCalledTimes(1);
  expect(onTriage).toHaveBeenCalledTimes(1);
});

test("no triage button without onTriage, and busy disables it", () => {
  ui.render(<AutoReportRow report={report} agentName="Fleet Health" onOpen={() => {}} />);
  expect(ui.queryAll("button").length).toBe(1);
  expect(ui.text()).toContain("Disk full");
  ui.render(
    <AutoReportRow report={report} agentName="Fleet Health" onOpen={() => {}} onTriage={() => {}} triageBusy />,
  );
  const btn = ui.query('[aria-label^="Triage and execute"]') as HTMLButtonElement;
  expect(btn.disabled).toBe(true);
});
