import { afterEach, beforeEach, expect, test } from "bun:test";
import { mount, type Mounted } from "../test-support/render";
import type { ThreadDetail } from "../../../packages/protocol/src/threads";

const TASK_ASKING = "d3a0c0de-0000-4000-8000-000000000001";
const TASK_DONE = "f4a1b2c3-0000-4000-8000-000000000002";
const alex = { kind: "human" as const, participantId: "human:alex", name: "Alex" };
const me = { kind: "human" as const, participantId: "human:me", name: "Benny" };

const detail: ThreadDetail = {
  me: "human:me",
  thread: { id: "t1", title: "Pricing ideas", createdAt: 1, updatedAt: 2, project: { cwd: "/repos/web", name: "web" }, lastMessage: null },
  participants: [
    { id: "human:me", kind: "human", display: { name: "Benny", fallback: "Benny" } },
    { id: "human:alex", kind: "human", display: { name: "Alex", fallback: "Alex" } },
  ],
  messages: [
    { id: "m1", threadId: "t1", ts: 1, author: alex, text: "Should we drop the free tier?" },
    { id: "m2", threadId: "t1", ts: 2, author: me, text: "Keep it, cap it." },
    { id: "m3", threadId: "t1", ts: 3, author: { kind: "omg" }, text: "Linear starts at $8 per seat." },
    { id: "m4", threadId: "t1", ts: 4, author: { kind: "omg" }, text: "Started a task in web.",
      task: { sessionId: TASK_ASKING, event: "started", title: "Cap the free tier", project: "web" } },
    { id: "m5", threadId: "t1", ts: 5, author: { kind: "omg" }, text: "Started a task in web.",
      task: { sessionId: TASK_DONE, event: "started", title: "Fix the signup typo", project: "web" } },
    { id: "m6", threadId: "t1", ts: 6, author: { kind: "omg" }, text: "Fixed the typo.",
      task: { sessionId: TASK_DONE, event: "finished", title: "Fix the signup typo", project: "web" } },
  ],
  tasks: [
    { sessionId: TASK_ASKING, title: "Cap the free tier", project: "web", busy: false, status: "ok", ended: false },
    { sessionId: TASK_DONE, title: "Fix the signup typo", project: "web", busy: false, status: "ok", ended: true },
  ],
};

const { ThreadChatView, ThreadRailSection, NEW_THREAD_ID } = await import("./threads");

const sent: string[] = [];
function view(props: Partial<Parameters<typeof ThreadChatView>[0]> = {}) {
  return (
    <ThreadChatView
      threadId="t1"
      detail={detail}
      repos={[]}
      openAskSessionIds={[TASK_ASKING]}
      questionPanel={<div>Create it in live mode?</div>}
      send={async (text) => {
        sent.push(text);
      }}
      setProject={async () => {}}
      onOpenTask={() => {}}
      {...props}
    />
  );
}

let ui: Mounted;
beforeEach(() => {
  ui = mount();
  sent.length = 0;
});
afterEach(() => ui.cleanup());

test("a thread reads as people talking, with omg only where it was asked", () => {
  ui.render(view());
  const text = ui.text();
  expect(text).toContain("Pricing ideas");
  expect(text).toContain("Benny, Alex");
  expect(text).toContain("Should we drop the free tier?");
  expect(text).toContain("Linear starts at $8 per seat.");
  // No agent chrome: this is not the session chat.
  expect(text).not.toContain("Claude");
  expect(text).not.toContain("Worked");
});

test("each task is one card with its state, and its question shows in the thread", () => {
  const opened: string[] = [];
  ui.render(view({ onOpenTask: (sid) => opened.push(sid) }));
  const asking = ui.query<HTMLButtonElement>('[data-testid="thread-task-d3a0c0de"]');
  const done = ui.query<HTMLButtonElement>('[data-testid="thread-task-f4a1b2c3"]');
  expect(asking?.textContent).toContain("Needs you");
  expect(done?.textContent).toContain("Done");
  expect(ui.queryAll('[data-testid^="thread-task-"]')).toHaveLength(2);
  expect(ui.text()).toContain("Create it in live mode?");
  done?.click();
  expect(opened).toEqual([TASK_DONE]);
});

test("Enter sends the message to the thread", async () => {
  ui.render(view());
  const input = ui.query<HTMLTextAreaElement>('[data-testid="thread-input"]')!;
  await ui.flushAsync(() => {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value")!.set!;
    setter.call(input, "@omg update the pricing page");
    input.dispatchEvent(new window.Event("input", { bubbles: true }));
  });
  await ui.flushAsync(() => {
    input.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  });
  expect(sent).toEqual(["@omg update the pricing page"]);
});

test("an empty new thread sends its first message", async () => {
  ui.render(view({ threadId: NEW_THREAD_ID, detail: null, questionPanel: null }));
  expect(ui.text()).toContain("What is on your mind?");
  const input = ui.query<HTMLTextAreaElement>('[data-testid="thread-input"]')!;
  await ui.flushAsync(() => {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value")!.set!;
    setter.call(input, "Should we drop the free tier?");
    input.dispatchEvent(new window.Event("input", { bubbles: true }));
  });
  await ui.flushAsync(() => {
    input.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  });
  expect(sent).toEqual(["Should we drop the free tier?"]);
});

test("the rail lists threads by who spoke last, and New opens an empty one", () => {
  const actions: string[] = [];
  ui.render(
    <ThreadRailSection
      threads={[{ ...detail.thread, lastMessage: { author: alex, text: "Keep it", ts: 2 } }]}
      activeId={null}
      onOpen={(id) => actions.push(`open:${id}`)}
      onNew={() => actions.push("new")}
    />,
  );
  expect(ui.text()).toContain("Threads · 1");
  expect(ui.text()).toContain("Alex: Keep it");
  ui.query<HTMLButtonElement>('[aria-label="New thread"]')?.click();
  ui.queryAll<HTMLButtonElement>('[data-testid="thread-rail"] button')[1]?.click();
  expect(actions).toEqual(["new", "open:t1"]);
});
