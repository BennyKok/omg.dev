import { afterEach, beforeEach, expect, test } from "bun:test";
import { mount, type Mounted } from "../test-support/render";
import { NO_PROJECT_FILTER } from "../lib/project-filter";
import { resetFolderActivityForTests } from "../lib/folder-activity";

const { MobileNewSessionButton, MobileNewSessionScreen } = await import("./mobile-home-composer");
let ui: Mounted;
beforeEach(() => {
  ui = mount();
  resetFolderActivityForTests(new Map());
});
afterEach(() => ui.cleanup());

const label = (value: string) => (value === NO_PROJECT_FILTER ? "No project" : value);

test("the home button opens the screen and raises the keyboard inside the tap", () => {
  let opened = 0;
  ui.render(<MobileNewSessionButton onOpen={() => opened++} />);
  expect(document.documentElement.style.getPropertyValue("--lfg-inline-composer-height")).toMatch(/px$/);
  const button = ui.queryAll("button").find((el) => el.textContent?.includes("New session"))!;
  ui.flush(() => button.click());
  expect(opened).toBe(1);
  // The stand-in field holds focus until the real field mounts.
  expect(document.activeElement?.tagName).toBe("INPUT");
});

test("the home button is out of reach under an open chat", () => {
  ui.render(<MobileNewSessionButton hidden onOpen={() => {}} />);
  const bar = ui.host.firstElementChild as HTMLElement;
  expect(bar.inert).toBe(true);
  expect(bar.getAttribute("aria-hidden")).toBe("true");
});

test("the home button observes border-box height so safe-area padding updates the CSS variable", () => {
  const originalRO = globalThis.ResizeObserver;
  let observedBox: ResizeObserverBoxOptions | undefined;
  let notify: ResizeObserverCallback | null = null;
  globalThis.ResizeObserver = class {
    constructor(cb: ResizeObserverCallback) {
      notify = cb;
    }
    observe(_target: Element, options?: ResizeObserverOptions) {
      observedBox = options?.box;
    }
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
  try {
    ui.render(<MobileNewSessionButton onOpen={() => {}} />);
    expect(observedBox).toBe("border-box");
    const bar = ui.host.firstElementChild as HTMLElement;
    bar.getBoundingClientRect = () => ({ height: 98 } as DOMRect);
    notify?.([], {} as ResizeObserver);
    expect(document.documentElement.style.getPropertyValue("--lfg-inline-composer-height")).toBe("98px");
  } finally {
    globalThis.ResizeObserver = originalRO;
  }
});

test("the screen shows No project and the first folders as chips, and picks one", () => {
  const picks: string[] = [];
  let closed = 0;
  let history = 0;
  ui.render(
    <MobileNewSessionScreen
      projects={[NO_PROJECT_FILTER, "lfg", "vibes"]}
      folder="lfg"
      labelFor={label}
      onFolder={(value) => picks.push(value)}
      onClose={() => closed++}
      onHistory={() => history++}
    >
      <textarea aria-label="Prompt" />
    </MobileNewSessionScreen>,
  );
  const screen = document.querySelector('[data-testid="mobile-new-session"]')!;
  const chips = [...screen.querySelectorAll('[role="radio"]')];
  expect(chips.map((chip) => chip.textContent)).toEqual(["No project", "lfg", "vibes"]);
  expect(chips[1].getAttribute("aria-checked")).toBe("true");
  // Each folder chip carries the folder's favicon.
  expect(chips[1].querySelector("img")?.getAttribute("src")).toContain("/api/repos/favicon?project=lfg");
  ui.flush(() => (chips[2] as HTMLButtonElement).click());
  expect(picks).toEqual(["vibes"]);
  ui.flush(() => (screen.querySelector('[aria-label="Resume a session"]') as HTMLButtonElement).click());
  expect(history).toBe(1);
  ui.flush(() => (screen.querySelector('[aria-label="Close"]') as HTMLButtonElement).click());
  expect(closed).toBe(1);
  expect(screen.querySelector('[aria-label="Prompt"]')).not.toBeNull();
});

test("folders past the first few wait behind More, and the current one keeps a chip", () => {
  const folders = Array.from({ length: 20 }, (_, i) => `f${String(i).padStart(2, "0")}`);
  const picks: string[] = [];
  ui.render(
    <MobileNewSessionScreen projects={[NO_PROJECT_FILTER, ...folders]} folder="f15" labelFor={label} onFolder={(v) => picks.push(v)} onClose={() => {}}>
      <textarea aria-label="Prompt" />
    </MobileNewSessionScreen>,
  );
  const screen = document.querySelector('[data-testid="mobile-new-session"]')!;
  const radios = () => [...screen.querySelectorAll('[role="radio"]')].map((chip) => chip.textContent);
  // No project plus six folders; the current folder takes the last slot.
  expect(radios()).toHaveLength(7);
  expect(radios()).toContain("f15");
  const more = [...screen.querySelectorAll("button")].find((b) => b.textContent?.startsWith("More"))!;
  ui.flush(() => more.click());
  const search = screen.querySelector('[aria-label="Search folders"]') as HTMLInputElement;
  expect(search).not.toBeNull();
  ui.flush(() => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    setter.call(search, "f19");
    search.dispatchEvent(new Event("input", { bubbles: true }));
  });
  const hit = [...screen.querySelectorAll('[role="radio"]')].find((chip) => chip.textContent === "f19") as HTMLButtonElement;
  ui.flush(() => hit.click());
  expect(picks).toEqual(["f19"]);
  // Picking closes More again.
  expect(screen.querySelector('[aria-label="Search folders"]')).toBeNull();
});

test("Escape closes the screen", () => {
  let closed = 0;
  ui.render(
    <MobileNewSessionScreen projects={["lfg"]} folder="lfg" labelFor={label} onFolder={() => {}} onClose={() => closed++}>
      <textarea aria-label="Prompt" />
    </MobileNewSessionScreen>,
  );
  const field = document.querySelector('[aria-label="Prompt"]') as HTMLTextAreaElement;
  ui.flush(() => field.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
  expect(closed).toBe(1);
});

// The same swipe back as an open chat (lib/use-swipe-back).
function drag(target: Element, points: Array<[number, number]>) {
  const touch = (x: number, y: number) => ({ clientX: x, clientY: y, identifier: 1, target }) as unknown as Touch;
  const fire = (type: string, x: number, y: number, ended = false) => {
    const event = new Event(type, { bubbles: true, cancelable: true });
    Object.defineProperty(event, "touches", { value: ended ? [] : [touch(x, y)] });
    target.dispatchEvent(event);
  };
  const [first, ...rest] = points;
  fire("touchstart", ...first);
  for (const [x, y] of rest) fire("touchmove", x, y);
  const last = points[points.length - 1];
  fire("touchend", last[0], last[1], true);
}

function renderScreen(onClose: () => void) {
  ui.render(
    <MobileNewSessionScreen projects={[NO_PROJECT_FILTER, "lfg"]} folder="lfg" labelFor={label} onFolder={() => {}} onClose={onClose}>
      <form data-composer-kind="home">
        <textarea aria-label="Prompt" />
      </form>
    </MobileNewSessionScreen>,
  );
  return document.querySelector('[data-testid="mobile-new-session"]') as HTMLElement;
}

test("a swipe right closes the screen", async () => {
  let closed = 0;
  const screen = renderScreen(() => closed++);
  const title = screen.querySelector("h2")!;
  drag(title, [[20, 100], [40, 102], [160, 104], [260, 106]]);
  expect(screen.style.transform).toBe("translate3d(100%, 0, 0)");
  await new Promise((resolve) => setTimeout(resolve, 500));
  expect(closed).toBe(1);
});

test("a vertical drag, a left drag, or a drag in the field being edited does not close it", async () => {
  let closed = 0;
  const screen = renderScreen(() => closed++);
  const chips = screen.querySelector('[role="radiogroup"]')!;
  drag(chips, [[100, 100], [102, 140], [104, 260]]);
  drag(chips, [[200, 100], [150, 100], [40, 100]]);
  const field = screen.querySelector('[aria-label="Prompt"]') as HTMLTextAreaElement;
  field.focus();
  drag(field, [[20, 100], [160, 100], [260, 100]]);
  await new Promise((resolve) => setTimeout(resolve, 500));
  expect(closed).toBe(0);
  expect(screen.style.transform).toBe("");
});
