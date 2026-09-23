import { afterEach, beforeEach, expect, test } from "bun:test";
import { mount, type Mounted } from "../test-support/render";
import { sideNavRows } from "../lib/side-nav-items";

const { SideNavButton, SideNavDrawer } = await import("./side-nav");

let ui: Mounted;
beforeEach(() => {
  ui = mount();
});
afterEach(() => ui.cleanup());

/** The drawer portals out of the host, so assert against the document. */
const inDoc = (selector: string) => document.querySelector(selector);
const rowFor = (key: string) =>
  document.querySelector(`[data-testid="side-nav-row-${key}"]`) as HTMLButtonElement | null;

test("the button names the computer it belongs to and shows its status", () => {
  ui.render(<SideNavButton onOpen={() => {}} machineName="Work" online />);
  const button = ui.query('[data-testid="side-nav-button"]');
  expect(button?.getAttribute("aria-label")).toBe("Navigation. Computer: Work");
});

test("opening is the button's only job", () => {
  let opened = 0;
  ui.render(<SideNavButton onOpen={() => (opened += 1)} machineName="Work" online={false} />);
  ui.flush(() => (ui.query('[data-testid="side-nav-button"]') as HTMLButtonElement).click());
  expect(opened).toBe(1);
});

test("every row the model offers is drawn and can be navigated to", () => {
  const rows = sideNavRows({ tab: "live" });
  const went: string[] = [];
  ui.render(
    <SideNavDrawer open onOpenChange={() => {}} rows={rows} onNavigate={(key) => went.push(key)} />,
  );
  for (const row of rows) {
    expect(rowFor(row.key), `missing row ${row.key}`).not.toBeNull();
  }
  ui.flush(() => rowFor("artifacts")!.click());
  expect(went).toEqual(["artifacts"]);
});

test("the current row is marked and navigating to it is a no-op", () => {
  const rows = sideNavRows({ tab: "auto" });
  const went: string[] = [];
  let open = true;
  ui.render(
    <SideNavDrawer
      open
      onOpenChange={(next) => (open = next)}
      rows={rows}
      onNavigate={(key) => went.push(key)}
    />,
  );
  expect(rowFor("auto")?.getAttribute("aria-current")).toBe("page");
  expect(rowFor("live")?.getAttribute("aria-current")).toBeNull();
  // Tapping where you already are closes the drawer without navigating, as on
  // iOS. Navigating would push a duplicate history entry for the same page.
  ui.flush(() => rowFor("auto")!.click());
  expect(went).toEqual([]);
  expect(open).toBe(false);
});

test("choosing a row closes the drawer", () => {
  let open = true;
  ui.render(
    <SideNavDrawer
      open
      onOpenChange={(next) => (open = next)}
      rows={sideNavRows({ tab: "live" })}
      onNavigate={() => {}}
    />,
  );
  ui.flush(() => rowFor("notifications")!.click());
  expect(open).toBe(false);
});

test("the machine switcher leads the panel, above the first row", () => {
  ui.render(
    <SideNavDrawer
      open
      onOpenChange={() => {}}
      rows={sideNavRows({ tab: "live" })}
      onNavigate={() => {}}
      machineSwitcher={<div data-testid="machine-slot">Work</div>}
    />,
  );
  const panel = inDoc('[data-slot="side-nav"]')!;
  const order = [...panel.querySelectorAll('[data-testid]')].map((el) =>
    el.getAttribute("data-testid"),
  );
  expect(order[0]).toBe("machine-slot");
  expect(order[1]).toBe("side-nav-row-live");
});
