import { afterEach, beforeEach, expect, test } from "bun:test";
import { mount, window, type Mounted } from "../test-support/render";
const { ProjectPillRail } = await import("./project-pill-rail");

let ui: Mounted;
let resize: () => void;
const originalObserver = globalThis.ResizeObserver;
beforeEach(() => {
  globalThis.ResizeObserver = class {
    constructor(callback: () => void) { resize = callback; }
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
  ui = mount();
});
afterEach(() => { ui.cleanup(); globalThis.ResizeObserver = originalObserver; });
const projects = [{ value: "repo-id", label: "Friendly name" }, { value: "other", label: "Other" }];
const button = (name: string) => ui.query(`button[aria-label="${name}"]`) as HTMLButtonElement | null;

test("uses project identity, offers no All pill, and reflects controlled selection", () => {
  const selected: string[] = [];
  const render = (value: string) => ui.render(<ProjectPillRail projects={projects} value={value} onChange={(id) => selected.push(id)} />);
  render("__all");
  // The rail is folders and nothing else. Unscoped means no pill is pressed,
  // rather than a pill that names the absence of a folder.
  expect(ui.query('button[title="All"]')).toBeNull();
  expect(ui.query('[aria-pressed="true"]')).toBeNull();
  expect(ui.queryAll("button[aria-pressed]").length).toBe(projects.length);
  ui.flush(() => (ui.query('button[title="Friendly name"]') as HTMLButtonElement).click());
  expect(selected).toEqual(["repo-id"]);
  render("repo-id");
  expect(ui.query('[aria-pressed="true"]')?.textContent).toBe("Friendly name");
  // Pressing the selected pill reports that same pill. Turning the second
  // press into "clear" is the shell's decision, not the rail's — see
  // projectFilterAfterPress.
  ui.flush(() => (ui.query('button[title="Friendly name"]') as HTMLButtonElement).click());
  expect(selected).toEqual(["repo-id", "repo-id"]);
  expect(button("Scroll projects right") === null).toBe(true);
});

test("updates arrow boundaries on scroll and removes arrows when resized to fit", () => {
  ui.render(<ProjectPillRail projects={projects} value="__all" onChange={() => {}} />);
  const viewport = ui.query('.overflow-x-auto') as HTMLElement;
  let width = 200;
  Object.defineProperties(viewport, { clientWidth: { get: () => width }, scrollWidth: { get: () => 500 } });
  ui.flush(() => resize());
  expect(button("Scroll projects left")?.disabled).toBe(true);
  expect(button("Scroll projects right")?.disabled).toBe(false);
  ui.flush(() => { viewport.scrollLeft = 300; viewport.dispatchEvent(new Event("scroll")); });
  expect(button("Scroll projects left")?.disabled).toBe(false);
  expect(button("Scroll projects right")?.disabled).toBe(true);
  ui.flush(() => { width = 500; viewport.scrollLeft = 0; resize(); });
  expect(button("Scroll projects right") === null).toBe(true);
});

test("reveals an externally selected project without scrolling the document", () => {
  ui.render(<ProjectPillRail projects={projects} value="__all" onChange={() => {}} />);
  const viewport = ui.query('.overflow-x-auto') as HTMLElement;
  const other = ui.query('button[title="Other"]') as HTMLElement;
  viewport.getBoundingClientRect = () => ({ left: 0, right: 200, width: 200 }) as DOMRect;
  other.getBoundingClientRect = () => ({ left: 300, right: 380 }) as DOMRect;
  ui.render(<ProjectPillRail projects={projects} value="other" onChange={() => {}} />);
  expect(viewport.scrollLeft).toBe(188);
});

test("mouse arrows scroll the viewport and Tab stays native inside the filter", () => {
  ui.render(<ProjectPillRail projects={projects} value="__all" onChange={() => {}} />);
  const viewport = ui.query('.overflow-x-auto') as HTMLElement;
  Object.defineProperties(viewport, { clientWidth: { value: 200 }, scrollWidth: { value: 500 } });
  let distance = 0;
  viewport.scrollBy = ((options: ScrollToOptions) => { distance = options.left ?? 0; }) as typeof viewport.scrollBy;
  ui.flush(() => resize());
  ui.flush(() => button("Scroll projects right")!.click());
  expect(distance).toBe(150);
  let bubbled = false;
  const listener = () => { bubbled = true; };
  window.addEventListener("keydown", listener);
  try {
    const event = new window.KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true });
    ui.query('button[title="Friendly name"]')!.dispatchEvent(event);
    expect(bubbled).toBe(false);
    expect(event.defaultPrevented).toBe(false);
  } finally {
    window.removeEventListener("keydown", listener);
  }
});

test("the phone rail has no scroll arrows", () => {
  ui.render(<ProjectPillRail touch projects={[{ value: "lfg", label: "lfg" }]} value="__all" onChange={() => {}} />);
  expect(ui.text()).toContain("lfg");
  expect(ui.query('[aria-label="Scroll projects left"]')).toBeNull();
});
