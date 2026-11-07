import { afterEach, beforeEach, expect, test } from "bun:test";
import { mount, type Mounted } from "../test-support/render";
import { sideNavRows } from "../lib/side-nav-items";

const { HostDrawerSlot, SideNavButton, SideNavPanel, SideNavRows } = await import("./side-nav");

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
  ui.render(<SideNavRows rows={rows} onNavigate={(key) => went.push(key)} onClose={() => {}} />);
  for (const row of rows) {
    expect(rowFor(row.key), `missing row ${row.key}`).not.toBeNull();
  }
  ui.flush(() => rowFor("artifacts")!.click());
  expect(went).toEqual(["artifacts"]);
});

test("the current row is marked and navigating to it is a no-op", () => {
  const went: string[] = [];
  ui.render(<SideNavRows rows={sideNavRows({ tab: "auto" })} onNavigate={(key) => went.push(key)} onClose={() => {}} />);
  expect(rowFor("auto")?.getAttribute("aria-current")).toBe("page");
  expect(rowFor("live")?.getAttribute("aria-current")).toBeNull();
  // Navigating to where you already are would push a duplicate history entry.
  ui.flush(() => rowFor("auto")!.click());
  expect(went).toEqual([]);
});

test("rows in a scrolling page carry no tap switch", () => {
  ui.render(<SideNavRows rows={sideNavRows({ tab: "live" })} onNavigate={() => {}} onClose={() => {}} haptic={false} />);
  expect(document.querySelector("[data-haptic-tap]")).toBeNull();
});

test("a host gets a slot for its own rows, and a tap in it reaches the host's close", () => {
  let closed = 0;
  ui.render(<HostDrawerSlot onClose={() => closed++} />);
  const slot = inDoc('[data-lfg-host-slot="drawer-footer"]') as HTMLElement | null;
  expect(slot).not.toBeNull();
  // The host renders from its own React root, so simulate a plain DOM child.
  const hostButton = document.createElement("button");
  slot!.appendChild(hostButton);
  ui.flush(() => hostButton.click());
  expect(closed).toBe(1);
});

test("the rail panel lists the same rows, and a row navigates then goes back", () => {
  const rows = sideNavRows({ tab: "live" });
  const went: string[] = [];
  let backs = 0;
  ui.render(
    <SideNavPanel open onBack={() => (backs += 1)} rows={rows} onNavigate={(key) => went.push(key)} />,
  );
  for (const row of rows) {
    expect(ui.query(`[data-testid="side-nav-row-${row.key}"]`), `missing row ${row.key}`).not.toBeNull();
  }
  ui.flush(() => (ui.query('[data-testid="side-nav-row-auto"]') as HTMLButtonElement).click());
  expect(went).toEqual(["auto"]);
  expect(backs).toBe(1);
  // The current row only goes back; there is nowhere new to go.
  ui.flush(() => (ui.query('[data-testid="side-nav-row-live"]') as HTMLButtonElement).click());
  expect(went).toEqual(["auto"]);
  expect(backs).toBe(2);
  ui.flush(() => (ui.query('[data-testid="side-nav-back"]') as HTMLButtonElement).click());
  expect(backs).toBe(3);
});

test("the rail panel marks unread places and hides itself when closed", () => {
  const rows = sideNavRows({ tab: "auto" });
  const render = (open: boolean) =>
    ui.render(
      <SideNavPanel open={open} onBack={() => {}} rows={rows} onNavigate={() => {}} unread={new Set(["live"])} />,
    );
  render(true);
  expect(ui.query('[data-testid="side-nav-row-live"] [role="status"]')).not.toBeNull();
  expect(ui.query('[data-testid="side-nav-row-auto"] [role="status"]')).toBeNull();
  const panel = ui.query('[data-testid="side-nav-panel"]') as HTMLElement & { inert?: boolean };
  expect(panel.getAttribute("aria-hidden")).toBe("false");
  render(false);
  expect(panel.getAttribute("aria-hidden")).toBe("true");
  expect(panel.inert).toBe(true);
});

test("the rail panel draws the machine picker above the rows", () => {
  ui.render(
    <SideNavPanel
      open
      onBack={() => {}}
      rows={sideNavRows({ tab: "live" })}
      onNavigate={() => {}}
      machineSwitcher={<div data-testid="machine">Work</div>}
    />,
  );
  const machine = ui.query('[data-testid="machine"]')!;
  const firstRow = ui.query('[data-testid="side-nav-row-live"]')!;
  expect(machine.compareDocumentPosition(firstRow) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
});


test("a current rail row dismisses a host page without adding app history", () => {
  let selected = 0;
  const navigated: string[] = [];
  ui.render(<SideNavPanel open onBack={() => {}} rows={sideNavRows({ tab: "live" })}
    onSelect={() => selected++} onNavigate={(key) => navigated.push(key)} />);
  ui.flush(() => (ui.query('[data-testid="side-nav-row-live"]') as HTMLButtonElement).click());
  expect(selected).toBe(1);
  expect(navigated).toEqual([]);
  ui.flush(() => (ui.query('[data-testid="side-nav-row-auto"]') as HTMLButtonElement).click());
  expect(selected).toBe(2);
  expect(navigated).toEqual(["auto"]);
});
