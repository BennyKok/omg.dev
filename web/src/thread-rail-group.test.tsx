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

test("a collapsed rail draws no thread rows", () => {
  ui.render(
    <ThreadRailGroup
      threads={[{ id: "t", title: "Todos", createdAt: 1, updatedAt: 1, project: null }] as ThreadSummary[]}
      activeId={null}
      collapsed
      dense
      onOpen={() => {}}
    />,
  );
  // A thread has no mark, so in the 56px rail it was an empty button that
  // pushed the session icons down.
  expect(ui.queryAll('[aria-label="Thread Todos"]')).toHaveLength(0);
});

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

test("the desktop header offers a new thread through its + button", () => {
  let started = 0;
  ui.render(
    <ThreadRailGroup
      threads={[{ id: "t", title: "Todos", createdAt: 1, updatedAt: 1, project: null }] as ThreadSummary[]}
      activeId={null}
      collapsed={false}
      dense
      onOpen={() => {}}
      onNew={() => started++}
    />,
  );
  const add = ui.query<HTMLButtonElement>('button[aria-label="New thread"]');
  expect(add).not.toBeNull();
  // Hidden at rest, shown while the pointer is over the header.
  expect(add!.className).toContain("opacity-0");
  expect(add!.className).toContain("group-hover/rail-head:opacity-100");
  add!.click();
  expect(started).toBe(1);
});

test("with no threads the header stays only when it can start one", () => {
  ui.render(<ThreadRailGroup threads={[]} activeId={null} collapsed={false} dense onOpen={() => {}} />);
  expect(ui.text()).not.toContain("Threads");

  ui.render(<ThreadRailGroup threads={[]} activeId={null} collapsed={false} dense onOpen={() => {}} onNew={() => {}} />);
  expect(ui.text()).toContain("Threads · 0");
  expect(ui.query('button[aria-label="New thread"]')).not.toBeNull();
});
