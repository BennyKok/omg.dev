import { afterEach, beforeEach, expect, spyOn, test } from "bun:test";
import { mount, type Mounted } from "../../test-support/render";
const { MorphText } = await import("./morph-text");

let ui: Mounted;
beforeEach(() => { ui = mount(); });
afterEach(() => ui.cleanup());

test("renders the text and follows updates without the Web Animations API", () => {
  ui.render(<MorphText className="lbl">Welcome, Benny</MorphText>);
  expect(ui.text()).toContain("Welcome, Benny");
  expect(ui.query(".lbl")).not.toBeNull();
  ui.render(<MorphText className="lbl">2 agents building</MorphText>);
  expect(ui.text()).toContain("2 agents building");
  expect(ui.text()).not.toContain("Welcome");
});

test("shimmer wraps the text in the shimmer overlay and keeps data-text in sync", () => {
  ui.render(<MorphText shimmer className="lbl">Thinking… 3s</MorphText>);
  const wrap = ui.query(".lfg-shimmer-text.lbl");
  expect(wrap?.getAttribute("data-text")).toBe("Thinking… 3s");
  ui.render(<MorphText shimmer className="lbl">Thinking… 4s</MorphText>);
  expect(ui.query(".lfg-shimmer-text")?.getAttribute("data-text")).toBe("Thinking… 4s");
  expect(ui.text()).toContain("Thinking… 4s");
});

test("text stays immediate without glyph measurements, including repeated updates", () => {
  const measure = spyOn(Element.prototype, "getBoundingClientRect");
  try {
    ui.render(<MorphText>Ready</MorphText>);
    for (let i = 1; i <= 20; i++) {
      ui.render(<MorphText>{`Working ${i}s`}</MorphText>);
      expect(ui.text()).toBe(`Working ${i}s`);
    }
    expect(measure).not.toHaveBeenCalled();
    expect(ui.host.querySelectorAll("*")).toHaveLength(1);
  } finally {
    measure.mockRestore();
  }
});

test("only visible updates animate and unmount cancels the animation", () => {
  const originalObserver = globalThis.IntersectionObserver;
  const originalAnimate = HTMLElement.prototype.animate;
  let notify: (entries: { target: Element; isIntersecting: boolean }[]) => void;
  let target: Element;
  let animations = 0;
  let cancellations = 0;
  globalThis.IntersectionObserver = class {
    constructor(callback: typeof notify) { notify = callback; }
    observe(element: Element) { target = element; }
    unobserve() {}
    disconnect() {}
  } as unknown as typeof IntersectionObserver;
  HTMLElement.prototype.animate = (() => {
    animations++;
    return { cancel() { cancellations++; } };
  }) as unknown as typeof HTMLElement.prototype.animate;
  try {
    ui.render(<MorphText shimmer>Ready</MorphText>);
    expect(animations).toBe(0);
    notify!([{ target: target!, isIntersecting: true }]);
    ui.render(<MorphText shimmer>Working</MorphText>);
    expect(animations).toBe(1);
    notify!([{ target: target!, isIntersecting: false }]);
    expect(cancellations).toBeGreaterThan(0);
    ui.render(<MorphText shimmer>Finished</MorphText>);
    expect(animations).toBe(1);
    expect(ui.text()).toBe("Finished");
    notify!([{ target: target!, isIntersecting: true }]);
    ui.render(<MorphText shimmer disabled>Ready again</MorphText>);
    expect(animations).toBe(1);
    ui.render(<MorphText shimmer>Starting</MorphText>);
    expect(animations).toBe(2);
    const before = cancellations;
    ui.cleanup();
    expect(cancellations).toBeGreaterThan(before);
  } finally {
    ui.cleanup();
    globalThis.IntersectionObserver = originalObserver;
    if (originalAnimate) HTMLElement.prototype.animate = originalAnimate;
    else delete (HTMLElement.prototype as unknown as Record<string, unknown>).animate;
  }
});
