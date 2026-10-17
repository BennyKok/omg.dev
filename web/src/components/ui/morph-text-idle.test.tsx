import { afterAll, afterEach, beforeEach, expect, mock, test } from "bun:test";
import { mount, type Mounted } from "../../test-support/render";

// TextMorph measures its glyphs on mount, which forces a whole-page layout.
// On the Computer screen that cost about 85 ms before the screen was usable.
// The first render must be plain text; TextMorph mounts once the browser is
// idle, so later changes still animate.
let morphMounts = 0;
mock.module("torph/react", () => ({
  TextMorph: ({ children, as: Tag = "span", className }: { children: string; as?: "span"; className?: string }) => {
    morphMounts += 1;
    return <Tag data-morph="" className={className}>{children}</Tag>;
  },
}));
// Make this environment look like a browser with the Web Animations API.
const proto = Element.prototype as unknown as Record<string, unknown>;
const added = ["animate", "getAnimations"].filter((name) => typeof proto[name] !== "function");
for (const name of added) proto[name] = name === "animate" ? () => ({}) : () => [];
afterAll(() => { for (const name of added) delete proto[name]; });
const { MorphText } = await import("./morph-text");

let ui: Mounted;
beforeEach(() => { ui = mount(); morphMounts = 0; });
afterEach(() => ui.cleanup());

test("the first render is plain text; TextMorph takes over when the browser is idle", async () => {
  ui.render(<MorphText className="lbl">Welcome, Benny</MorphText>);
  expect(ui.text()).toContain("Welcome, Benny");
  expect(ui.query("[data-morph]")).toBeNull();
  expect(morphMounts).toBe(0);

  await new Promise((resolve) => setTimeout(resolve, 250));
  await ui.flushAsync();
  expect(ui.query("[data-morph].lbl")).not.toBeNull();
  expect(ui.text()).toContain("Welcome, Benny");
});
