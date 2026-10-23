import { afterEach, beforeEach, expect, test } from "bun:test";
import { mount, type Mounted } from "../../test-support/render";

const { SlidePanel } = await import("./slide-panel");

let ui: Mounted;
let shell: HTMLElement;
beforeEach(() => {
  shell = document.createElement("div");
  shell.id = "root";
  document.body.appendChild(shell);
  ui = mount();
});
afterEach(() => {
  ui.cleanup();
  shell.remove();
});

const surface = () => document.querySelector('[data-slot="test-panel"]') as HTMLElement;

function renderPanel(open: boolean, onOpenChange: (next: boolean) => void = () => {}, slot = "test-panel") {
  ui.render(
    <SlidePanel open={open} onOpenChange={onOpenChange} edge="bottom" label="Test" slot={slot}>
      <div data-testid="list" style={{ overflowY: "auto" }}>
        <button type="button">inside</button>
      </div>
    </SlidePanel>,
  );
}

function drag(target: HTMLElement, dys: number[], dx = 0) {
  const fire = (type: string, x: number, y: number) =>
    target.dispatchEvent(
      new window.PointerEvent(type, { bubbles: true, clientX: x, clientY: y, pointerId: 1, isPrimary: true, pointerType: "touch" }),
    );
  ui.flush(() => {
    fire("pointerdown", 200, 300);
    for (const dy of dys) fire("pointermove", 200 + dx, 300 + dy);
    fire("pointerup", 200 + dx, 300 + dys[dys.length - 1]!);
  });
}

test("the page under an open panel is hidden from focus and assistive tech, and comes back on close", () => {
  renderPanel(true);
  expect((shell as HTMLElement & { inert?: boolean }).inert).toBe(true);
  expect(shell.getAttribute("aria-hidden")).toBe("true");
  renderPanel(false);
  expect((shell as HTMLElement & { inert?: boolean }).inert).toBe(false);
  expect(shell.getAttribute("aria-hidden")).toBeNull();
});

test("the page stays hidden while a second panel is still open", () => {
  ui.render(
    <>
      <SlidePanel open onOpenChange={() => {}} edge="left" label="A" slot="a">
        a
      </SlidePanel>
      <SlidePanel open onOpenChange={() => {}} edge="bottom" label="B" slot="b">
        b
      </SlidePanel>
    </>,
  );
  ui.render(
    <>
      <SlidePanel open={false} onOpenChange={() => {}} edge="left" label="A" slot="a">
        a
      </SlidePanel>
      <SlidePanel open onOpenChange={() => {}} edge="bottom" label="B" slot="b">
        b
      </SlidePanel>
    </>,
  );
  expect(shell.getAttribute("aria-hidden")).toBe("true");
});

test("focus moves into the panel on open and returns on close", () => {
  const trigger = document.createElement("button");
  document.body.appendChild(trigger);
  trigger.focus();
  renderPanel(true);
  expect(surface().contains(document.activeElement)).toBe(true);
  renderPanel(false);
  expect(document.activeElement).toBe(trigger);
  trigger.remove();
});

test("a swipe down closes a bottom panel", () => {
  const changes: boolean[] = [];
  renderPanel(true, (next) => changes.push(next));
  drag(surface(), [12, 80, 400]);
  expect(changes).toEqual([false]);
});

test("a swipe up, a sideways scroll or a twitch does not close a bottom panel", () => {
  const changes: boolean[] = [];
  renderPanel(true, (next) => changes.push(next));
  drag(surface(), [-12, -200]);
  drag(surface(), [10, 20], 160);
  drag(surface(), [3, 5]);
  expect(changes).toEqual([]);
});

test("pulling down a list that is scrolled away from its top scrolls it instead of closing", () => {
  const changes: boolean[] = [];
  renderPanel(true, (next) => changes.push(next));
  const list = document.querySelector('[data-testid="list"]') as HTMLElement;
  list.scrollTop = 120;
  drag(list.querySelector("button") as HTMLElement, [12, 80, 400]);
  expect(changes).toEqual([]);
});

test("a closed panel does not render its content again when its owner renders", () => {
  let renders = 0;
  function Content({ label }: { label: string }) {
    renders += 1;
    return <span>{label}</span>;
  }
  const at = (open: boolean, label: string, refreshKey = 0) =>
    ui.render(
      <SlidePanel open={open} onOpenChange={() => {}} edge="left" label="Test" slot="test-panel" refreshKey={refreshKey}>
        <Content label={label} />
      </SlidePanel>,
    );
  at(true, "one");
  at(false, "one");
  const closed = renders;
  at(false, "two");
  at(false, "three");
  expect(renders).toBe(closed);
  at(false, "four", 1);
  expect(renders).toBe(closed + 1);
  expect(surface().textContent).toBe("four");
  at(true, "five", 1);
  expect(surface().textContent).toBe("five");
});

test("the click that ends the opening tap does not close the panel", () => {
  // The composer's agent button opens on pointerup. The click of that same
  // tap then lands on the backdrop that has just appeared under the finger.
  const changes: boolean[] = [];
  renderPanel(true, (next) => changes.push(next));
  const backdrop = document.querySelector('[data-slot="drawer-overlay"]') as HTMLElement;
  ui.flush(() => backdrop.click());
  expect(changes).toEqual([]);
  ui.flush(() => {
    backdrop.dispatchEvent(new window.PointerEvent("pointerdown", { bubbles: true, pointerId: 2, isPrimary: true }));
    backdrop.click();
  });
  expect(changes).toEqual([false]);
});
