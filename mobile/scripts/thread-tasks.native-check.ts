/**
 * Threads on the phone: what a task card says, where cards are drawn, what a
 * Home row previews, and the pull distances that start a thread.
 */
import { expect, test } from "bun:test";
import {
  cardMessageIds,
  latestTaskEvent,
  sameSession,
  taskCardState,
  threadPullStage,
  THREAD_PULL_ARM,
  THREAD_PULL_HINT,
} from "../src/omg/thread-tasks";
import { threadPreview, type ThreadMessage } from "../src/omg/threads";

const TASK = "a1b2c3d4-0000-4000-8000-000000000001";
const omg = (id: string, text: string, task?: ThreadMessage["task"]): ThreadMessage =>
  ({ id, threadId: "t", ts: 1, author: { kind: "omg" }, text, ...(task ? { task } : {}) });
const live = (fields: Partial<{ busy: boolean; status: string; ended: boolean }> = {}) => ({
  sessionId: TASK, title: "Fix it", project: "web", busy: false, status: "ok", ended: false, ...fields,
});

test("a task is drawn once, at the message that started it", () => {
  const messages = [
    omg("m1", "Started a task in web.", { sessionId: TASK, event: "started" }),
    omg("m2", "Fixed it.", { sessionId: TASK, event: "finished" }),
  ];
  expect([...cardMessageIds(messages)]).toEqual(["m1"]);
  expect(latestTaskEvent(messages, TASK)).toBe("finished");
});

test("card state: a question waits on you, a running turn is working, a report is done", () => {
  expect(taskCardState({ event: "started", row: live({ busy: true }), openAsk: false })).toBe("working");
  expect(taskCardState({ event: "started", row: live(), openAsk: true })).toBe("needs-you");
  expect(taskCardState({ event: "blocked", row: live(), openAsk: false })).toBe("needs-you");
  expect(taskCardState({ event: "finished", row: live(), openAsk: false })).toBe("done");
  expect(taskCardState({ event: "finished", row: live({ ended: true }), openAsk: false })).toBe("done");
  expect(taskCardState({ event: "started", row: live(), openAsk: false })).toBe("working");
  expect(taskCardState({ event: "started", row: live({ ended: true }), openAsk: false })).toBe("ended");
});

test("a short id and a full id name the same task", () => {
  expect(sameSession("a1b2c3d4", TASK)).toBe(true);
  expect(sameSession("b1b2c3d4", TASK)).toBe(false);
});

test("a Home row previews who spoke last", () => {
  const base = { id: "t", title: "Pricing ideas", createdAt: 1, updatedAt: 2, project: null };
  expect(threadPreview({ ...base, lastMessage: { author: { kind: "human", participantId: "p", name: "Alex" }, text: "Keep it", ts: 2 } }))
    .toBe("Alex: Keep it");
  expect(threadPreview({ ...base, lastMessage: { author: { kind: "omg" }, text: "Done.", ts: 2 } })).toBe("omg: Done.");
  expect(threadPreview({ ...base, lastMessage: null })).toBe("No messages yet");
});

test("a short pull refreshes; only a long pull arms a thread", () => {
  expect(threadPullStage(60)).toBe(0);
  expect(threadPullStage(THREAD_PULL_HINT)).toBe(1);
  expect(threadPullStage(THREAD_PULL_ARM - 1)).toBe(1);
  expect(threadPullStage(THREAD_PULL_ARM)).toBe(2);
});
