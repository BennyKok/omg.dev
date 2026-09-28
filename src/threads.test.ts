import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PATHS } from "./config.ts";
import { getConversation, listConversations } from "./conversations.ts";
import {
  answerMention,
  appendThreadMessage,
  bridgeTaskCompletion,
  listThreads,
  mentionsOmg,
  parseOmgDecision,
  readThreadMessages,
  startThread,
  threadAuthor,
  threadTasks,
  threadUpdate,
  type ThreadDeps,
} from "./threads.ts";

const originalData = PATHS.data;
let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "omg-threads-"));
  PATHS.data = join(root, "data");
});

afterEach(() => {
  PATHS.data = originalData;
  rmSync(root, { recursive: true, force: true });
});

function deps(overrides: Partial<ThreadDeps> = {}): ThreadDeps & { started: string[] } {
  const started: string[] = [];
  return {
    started,
    complete: async () => null,
    startTask: async ({ prompt }) => {
      started.push(prompt);
      return "a1b2c3d4-0000-4000-8000-000000000001";
    },
    ...overrides,
  };
}

describe("a thread is people-first chat", () => {
  test("starting a thread creates no session, only a conversation and its messages", () => {
    const thread = startThread({ identity: "benny@example.com", name: "Benny" });
    const author = threadAuthor(thread.id, "benny@example.com", "Benny");
    appendThreadMessage(thread.id, { author, text: "Should we drop the free tier?" });

    const stored = getConversation(thread.id)!;
    expect(stored.kind).toBe("thread");
    expect(stored.runtimeSessions).toEqual([]);
    expect(stored.participants.map((row) => row.role)).toEqual(["owner"]);

    const [summary] = listThreads();
    expect(summary.title).toBe("Should we drop the free tier?");
    expect(summary.lastMessage?.text).toBe("Should we drop the free tier?");
  });

  test("a second person joins as a member when they write", () => {
    const thread = startThread({ identity: "benny@example.com" });
    threadAuthor(thread.id, "alex@example.com", "Alex");
    expect(getConversation(thread.id)!.participants.map((row) => row.role)).toEqual(["owner", "member"]);
  });

  test("a box with no identities calls its person You, not the placeholder", () => {
    const thread = startThread({ identity: "__local__" });
    expect(getConversation(thread.id)!.participants[0].display.fallback).toBe("You");
    expect(threadAuthor(thread.id, "__local__")).toMatchObject({ kind: "human", name: "You" });
  });

  test("an archived thread is not listed", () => {
    const thread = startThread({ identity: "benny@example.com" });
    threadUpdate(thread.id, { archived: true });
    expect(listThreads()).toEqual([]);
    expect(listConversations()).toHaveLength(1);
  });
});

describe("@omg", () => {
  test("only an explicit mention wakes omg", () => {
    expect(mentionsOmg("@omg what does Linear charge?")).toBe(true);
    expect(mentionsOmg("ok @OMG do it")).toBe(true);
    expect(mentionsOmg("omg that is great")).toBe(false);
    expect(mentionsOmg("mail me at x@omg.dev")).toBe(false);
  });

  test("the model's JSON decides reply or task; anything else is a task", () => {
    expect(parseOmgDecision('{"action":"reply","text":"About $8 a seat."}', "q")).toEqual({
      action: "reply",
      text: "About $8 a seat.",
    });
    expect(parseOmgDecision('```json\n{"action":"task","title":"Update pricing","prompt":"Edit pricing.tsx"}\n```', "q"))
      .toEqual({ action: "task", title: "Update pricing", prompt: "Edit pricing.tsx" });
    expect(parseOmgDecision(null, "update the pricing page")).toEqual({
      action: "task",
      title: "update the pricing page",
      prompt: "update the pricing page",
    });
  });

  test("a quick question gets a reply from omg and starts nothing", async () => {
    const thread = startThread({ identity: "benny@example.com" });
    const d = deps({ complete: async () => '{"action":"reply","text":"Linear is $8 per seat."}' });
    const reply = await answerMention(thread.id, "@omg what does Linear charge?", "benny@example.com", d, "root-1");
    expect(reply).toMatchObject({ author: { kind: "omg" }, text: "Linear is $8 per seat.", replyTo: "root-1" });
    expect(d.started).toEqual([]);
    expect(getConversation(thread.id)!.runtimeSessions).toEqual([]);
  });

  test("real work starts one task in the thread's project, with the thread as context", async () => {
    const thread = startThread({ identity: "benny@example.com" });
    threadUpdate(thread.id, { project: { cwd: "/repos/web", name: "web" } });
    appendThreadMessage(thread.id, {
      author: threadAuthor(thread.id, "alex@example.com", "Alex"),
      text: "Keep the free tier but cap it at 3 tasks a day.",
    });
    let cwd: string | null = "unset";
    const d = deps({
      complete: async () => '{"action":"task","title":"Cap the free tier","prompt":"Update the pricing page."}',
      startTask: async (input) => {
        cwd = input.cwd;
        d.started.push(input.prompt);
        return "a1b2c3d4-0000-4000-8000-000000000001";
      },
    });
    const posted = await answerMention(thread.id, "@omg update the pricing page", "benny@example.com", d, "root-2");

    expect(cwd).toBe("/repos/web");
    expect(d.started[0]).toContain("Update the pricing page.");
    expect(d.started[0]).toContain("Alex: Keep the free tier but cap it at 3 tasks a day.");
    expect(posted).toMatchObject({
      author: { kind: "omg" },
      text: "Started a task in web.",
      task: { sessionId: "a1b2c3d4-0000-4000-8000-000000000001", event: "started", project: "web" },
      replyTo: "root-2",
    });
    expect(getConversation(thread.id)!.runtimeSessions).toMatchObject([
      { sessionId: "a1b2c3d4-0000-4000-8000-000000000001", kind: "execution" },
    ]);
  });

  test("a task that cannot start says why, in the thread", async () => {
    const thread = startThread({ identity: "benny@example.com" });
    const d = deps({ startTask: async () => { throw new Error("24 of 16 agents live"); } });
    const posted = await answerMention(thread.id, "@omg fix the build", "benny@example.com", d, "root-3");
    expect(posted.text).toBe("I could not start the task: 24 of 16 agents live");
    expect(posted.task).toBeUndefined();
  });
});

describe("task results come back as omg messages", () => {
  const TASK = "a1b2c3d4-0000-4000-8000-000000000001";

  async function threadWithTask() {
    const thread = startThread({ identity: "benny@example.com" });
    await answerMention(thread.id, "@omg fix it", "benny@example.com", deps(), "root-4");
    return thread;
  }

  test("a finished turn posts the task's own words", async () => {
    const thread = await threadWithTask();
    const posted = bridgeTaskCompletion(TASK, {
      title: "Fix it",
      project: "web",
      status: "ok",
      last: { role: "assistant", kind: "text", text: "Fixed the build.\n\nTests pass.\nNothing else to do.\nExtra line." },
    });
    expect(posted).toMatchObject({
      author: { kind: "omg" },
      text: "Fixed the build.\nTests pass.\nNothing else to do.",
      task: { sessionId: TASK, event: "finished", project: "web" },
      // In the same replies the task was started in.
      replyTo: "root-4",
    });
    expect(readThreadMessages(thread.id).at(-1)?.id).toBe(posted!.id);
  });

  test("a blocked task says it needs you", async () => {
    await threadWithTask();
    const posted = bridgeTaskCompletion(TASK, { status: "blocked", statusDetail: "Waiting for approval to deploy." });
    expect(posted).toMatchObject({ text: "Waiting for approval to deploy.", task: { event: "blocked" } });
  });

  test("a session no thread started posts nothing", () => {
    expect(bridgeTaskCompletion("ffffffff-0000-4000-8000-000000000000", null)).toBeNull();
  });

  test("task rows say which tasks are live and which ended", async () => {
    const thread = await threadWithTask();
    const conversation = getConversation(thread.id)!;
    expect(threadTasks(conversation, [{ sessionId: TASK, busy: true, title: "Fix it", project: "web", status: "ok" }]))
      .toEqual([{ sessionId: TASK, title: "Fix it", project: "web", busy: true, status: "ok", ended: false }]);
    expect(threadTasks(conversation, [])[0].ended).toBe(true);
  });
});
