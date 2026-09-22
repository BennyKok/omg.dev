import { afterAll, afterEach, beforeEach, describe, expect, test } from "bun:test";

const nativeEvent = globalThis.Event;
const { mount } = await import("../web/src/test-support/render");
const { createElement } = await import("../web/node_modules/react");
type Mounted = import("../web/src/test-support/render").Mounted;

const { AutoAgentPage } = await import("../web/src/components/auto-agent-page");

afterAll(() => {
  globalThis.Event = nativeEvent;
});

describe("auto-agent findings use a full-height page", () => {
  let ui: Mounted;

  beforeEach(() => {
    ui = mount();
  });

  afterEach(() => ui.cleanup());

  test("uses the live viewport and keeps the footer outside the scroller", () => {
    ui.render(
      createElement(
        AutoAgentPage,
        {
          onClose: () => {},
          title: "Fleet Health finding",
          footer: createElement("button", null, "Make the change"),
        },
        createElement("p", null, "The finding body"),
      ),
    );

    const page = document.querySelector("[data-auto-agent-page]") as HTMLElement;
    expect(page).not.toBeNull();
    expect(page.className).toContain("fixed inset-x-0");
    expect(page.className).toContain("flex flex-col overflow-hidden");

    const scroller = page.querySelector(".overflow-y-auto")!;
    const footer = page.querySelector("footer")!;
    expect(scroller.textContent).toContain("The finding body");
    expect(scroller.contains(footer)).toBe(false);
    expect(footer.textContent).toContain("Make the change");
  });

  test("has an explicit back action and does not focus the finding controls", () => {
    let closes = 0;
    ui.render(
      createElement(
        AutoAgentPage,
        { onClose: () => { closes += 1; }, title: "Finding" },
        createElement("input", { "aria-label": "Reply" }),
      ),
    );

    expect(document.querySelector("input") === document.activeElement).toBe(false);
    const back = document.querySelector('button[aria-label="Back"]') as HTMLButtonElement;
    expect(back).not.toBeNull();
    ui.flush(() => back.click());
    expect(closes).toBe(1);
  });
});
