import { afterEach, beforeEach, expect, test } from "bun:test";
import { mount, type Mounted } from "../test-support/render";
import type { ThreadDetail, ThreadMessage } from "../../../packages/protocol/src/threads";

const TASK_ASKING = "d3a0c0de-0000-4000-8000-000000000001";
const TASK_DONE = "f4a1b2c3-0000-4000-8000-000000000002";
const alex = { kind: "human" as const, participantId: "human:alex", name: "Alex" };
const me = { kind: "human" as const, participantId: "human:me", name: "Benny" };
const omg = { kind: "omg" as const };
const MIN = 60_000;

const detail: ThreadDetail = {
  me: "human:me",
  thread: { id: "t1", title: "Pricing ideas", createdAt: 1, updatedAt: 2, project: { cwd: "/repos/web", name: "web" }, lastMessage: null },
  participants: [
    { id: "human:me", kind: "human", display: { name: "Benny", fallback: "Benny" } },
    { id: "human:alex", kind: "human", display: { name: "Alex", fallback: "Alex" } },
  ],
  messages: [
    { id: "m1", threadId: "t1", ts: 1 * MIN, author: alex, text: "Should we drop the free tier?" },
    { id: "m2", threadId: "t1", ts: 2 * MIN, author: me, text: "Keep it, cap it." },
    { id: "m3", threadId: "t1", ts: 3 * MIN, author: alex, text: "@omg what does Linear charge?" },
    { id: "r1", threadId: "t1", ts: 3 * MIN, author: omg, text: "Linear starts at $8 per seat.", replyTo: "m3" },
    { id: "m4", threadId: "t1", ts: 20 * MIN, author: me, text: "@omg update the pricing page" },
    { id: "r2", threadId: "t1", ts: 20 * MIN, author: omg, text: "Started a task in web.", replyTo: "m4",
      task: { sessionId: TASK_ASKING, event: "started", title: "Cap the free tier", project: "web" } },
    { id: "m5", threadId: "t1", ts: 30 * MIN, author: alex, text: "@omg fix the signup typo" },
    { id: "r3", threadId: "t1", ts: 30 * MIN, author: omg, text: "Started a task in web.", replyTo: "m5",
      task: { sessionId: TASK_DONE, event: "started", title: "Fix the signup typo", project: "web" } },
    { id: "r4", threadId: "t1", ts: 40 * MIN, author: omg, text: "Fixed the typo.", replyTo: "m5",
      task: { sessionId: TASK_DONE, event: "finished", title: "Fix the signup typo", project: "web" } },
  ],
  tasks: [
    { sessionId: TASK_ASKING, title: "Cap the free tier", project: "web", busy: false, status: "ok", ended: false },
    { sessionId: TASK_DONE, title: "Fix the signup typo", project: "web", busy: false, status: "ok", ended: true },
  ],
};

const { ThreadChatView, NEW_THREAD_ID } = await import("./threads");

const sent: { text: string; replyTo: string | null }[] = [];
function view(props: Partial<Parameters<typeof ThreadChatView>[0]> = {}) {
  return (
    <ThreadChatView
      threadId="t1"
      detail={detail}
      repos={[]}
      openAskSessionIds={[TASK_ASKING]}
      questionPanel={(ids) => (ids.includes(TASK_ASKING) ? <div>Create it in live mode?</div> : null)}
      send={async (text, replyTo) => {
        sent.push({ text, replyTo });
        return { id: "new-root", threadId: "t1", ts: 50 * MIN, author: me, text } satisfies ThreadMessage;
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

async function type(selector: string, value: string) {
  const input = ui.query<HTMLTextAreaElement>(selector)!;
  await ui.flushAsync(() => {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value")!.set!;
    setter.call(input, value);
    input.dispatchEvent(new window.Event("input", { bubbles: true }));
  });
  await ui.flushAsync(() => {
    input.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  });
}

const links = () => ui.queryAll<HTMLButtonElement>('[data-testid="thread-replies-link"]');

test("the main list is the people's: omg's answers are replies, not messages", () => {
  ui.render(view());
  const text = ui.text();
  expect(text).toContain("Should we drop the free tier?");
  expect(text).toContain("@omg what does Linear charge?");
  expect(text).not.toContain("Linear starts at $8 per seat.");
  expect(text).not.toContain("Claude");
  expect(ui.queryAll('[data-testid="thread-message"]')).toHaveLength(5);
});

test("each message with replies says how many, and the task's state", () => {
  ui.render(view());
  const lines = links().map((link) => link.textContent ?? "");
  expect(lines).toHaveLength(3);
  expect(lines[0]).toContain("1 reply");
  expect(lines[1]).toContain("Needs you");
  expect(lines[2]).toContain("2 replies");
  expect(lines[2]).toContain("Done");
});

test("opening replies shows omg's answer, the task card and the task's question", async () => {
  ui.render(view());
  await ui.flushAsync(() => links()[0].click());
  expect(ui.query('[data-testid="thread-replies"]')?.textContent).toContain("Linear starts at $8 per seat.");
  await ui.flushAsync(() => links()[1].click());
  const panel = ui.query('[data-testid="thread-replies"]')!;
  expect(panel.querySelector('[data-testid="thread-task-d3a0c0de"]')?.textContent).toContain("Needs you");
  expect(panel.textContent).toContain("Create it in live mode?");
});

test("a reply is posted to the message it answers", async () => {
  ui.render(view());
  await ui.flushAsync(() => links()[2].click());
  await type('[data-testid="thread-reply-input"]', "thanks");
  expect(sent).toEqual([{ text: "thanks", replyTo: "m5" }]);
});

test("asking omg at the top level opens the replies it will answer in", async () => {
  ui.render(view());
  await type('[data-testid="thread-input"]', "@omg summarise this");
  expect(sent).toEqual([{ text: "@omg summarise this", replyTo: null }]);
  expect(ui.query('[data-testid="thread-replies"]')).not.toBeNull();
});

test("an empty new thread sends its first message", async () => {
  ui.render(view({ threadId: NEW_THREAD_ID, detail: null, send: async (text, replyTo) => { sent.push({ text, replyTo }); return null; } }));
  expect(ui.text()).toContain("What is on your mind?");
  await type('[data-testid="thread-input"]', "Should we drop the free tier?");
  expect(sent).toEqual([{ text: "Should we drop the free tier?", replyTo: null }]);
});



test("the header has no project chip; the title opens details with members, omg and the project", async () => {
  ui.render(view());
  const header = ui.query("header")!;
  expect(header.textContent).not.toContain("web");
  expect(header.textContent).not.toContain("No project");
  expect(ui.query('[data-testid="thread-menu"]')).not.toBeNull();
  await ui.flushAsync(() => ui.query<HTMLButtonElement>('[data-testid="thread-title"]')!.click());
  const details = document.querySelector('[data-testid="thread-details"]');
  expect(details?.textContent).toContain("Members · 3");
  expect(details?.textContent).toContain("Benny (you)");
  expect(details?.textContent).toContain("Answers, or starts a task");
  expect(details?.querySelector<HTMLSelectElement>('[data-testid="thread-details-project"]')?.value).toBe("/repos/web");
});

test("people show their own photo and current name; no photo falls back to a letter", () => {
  const withPhotos = {
    ...detail,
    participants: [
      { id: "human:me", kind: "human", display: { name: "Benny", fallback: "Benny", avatar: "/api/avatars/benny.png" } },
      { id: "human:alex", kind: "human", display: { name: "Alex Chan", fallback: "Alex", avatar: null } },
    ],
  };
  ui.render(view({ detail: withPhotos }));
  const photos = ui.queryAll<HTMLImageElement>('[data-testid="thread-message"] img').map((img) => img.getAttribute("src"));
  expect(photos).toContain("/api/avatars/benny.png");
  expect(ui.text()).toContain("Alex Chan");
});

test("people and omg typing show over the bar where they write", async () => {
  const typing = [
    { author: alex, replyTo: null },
    { author: omg, replyTo: "m4" },
  ];
  ui.render(view({ detail: { ...detail, typing } }));
  // omg answers in replies, so the main list shows it too.
  expect(ui.query('[data-testid="thread-typing"]')?.textContent).toBe("Alex and omg are typing");
  const needsYou = links().find((link) => link.textContent?.includes("Needs you"))!;
  await ui.flushAsync(() => needsYou.click());
  expect(ui.query('[data-testid="thread-reply-typing"]')?.textContent).toBe("omg is typing");
});

test("typing in the bar tells the thread, and stops when the field empties", async () => {
  const pings: [boolean, string | null][] = [];
  ui.render(view({ typing: (on, replyTo) => pings.push([on, replyTo]) }));
  const input = ui.query<HTMLTextAreaElement>('[data-testid="thread-input"]')!;
  const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value")!.set!;
  for (const value of ["h", "hi", ""]) {
    await ui.flushAsync(() => {
      setter.call(input, value);
      input.dispatchEvent(new window.Event("input", { bubbles: true }));
    });
  }
  expect(pings).toEqual([[true, null], [false, null]]);
});
