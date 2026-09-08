import { afterEach, beforeEach, expect, test } from "bun:test";
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
