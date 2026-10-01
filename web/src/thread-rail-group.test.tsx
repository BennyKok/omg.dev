import { afterEach, beforeEach, expect, test } from "bun:test";
import { mount, type Mounted } from "./test-support/render";
import type { ThreadSummary } from "../../packages/protocol/src/threads";

const { ThreadRailGroup } = await import("./App");

let ui: Mounted;
beforeEach(() => {
  window.localStorage.clear();
  ui = mount();
});
afterEach(() => ui.cleanup());

test("sidebar threads are compact title-only rows", () => {
  const threads: ThreadSummary[] = [
    {
      id: "thread-1",
      title: "Pricing ideas",
      createdAt: Date.now() - 120_000,
      updatedAt: Date.now() - 60_000,
      project: null,
      lastMessage: {
        author: { kind: "human", participantId: "human:alex", name: "Alex" },
        text: "This preview must stay out of the sidebar",
        ts: Date.now() - 60_000,
      },
    },
  ];

  ui.render(
    <ThreadRailGroup
      threads={threads}
      activeId={null}
      collapsed={false}
      dense
      onOpen={() => {}}
    />,
  );

  expect(ui.text()).toContain("Pricing ideas");
  expect(ui.text()).not.toContain("This preview must stay out of the sidebar");
  expect(ui.queryAll(".rail-preview")).toHaveLength(0);
  expect(ui.query('[role="button"][aria-label="Thread Pricing ideas"]')?.className).toContain("h-10");
});
