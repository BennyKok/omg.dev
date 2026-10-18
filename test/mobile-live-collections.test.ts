// The iOS schedules list and open questions are kept current by the Computer's change
// announcements (liveCollection), shared by every screen that shows it.
//
// Failures this must catch:
// - Each screen keeping its own copy: three screens would cost three reads
//   per change, which is the polling cost this replaced.
// - A findings failure wiping the findings already on screen, or an agents
//   failure taking the findings down with it. The two endpoints fail apart.
// - A change to another list (pins) re-reading schedules.
import { expect, test } from "bun:test";


import { openQuestions } from "../mobile/src/omg/ask-collection.ts";
import { autoCollection } from "../mobile/src/omg/auto-collection.ts";

function fakeClient(responses: Record<string, () => Promise<unknown>>) {
  let emit: (topics: string[]) => void = () => {};
  const calls: string[] = [];
  const client = {
    live: {
      announcesChanges: true,
      subscribeChanges(listener: (topics: string[]) => void) {
        emit = listener;
        return () => {};
      },
    },
    transport: {
      request: (path: string) => {
        calls.push(path);
        return responses[path]!();
      },
    },
  };
  return { client: client as never, calls, emit: (topics: string[]) => emit(topics) };
}

const settle = () => new Promise((r) => setTimeout(r, 5));

test("every screen shares one schedules read, and only an auto change re-reads it", async () => {
  const { client, calls, emit } = fakeClient({
    "/api/auto/agents": async () => ({ agents: [{ id: "a" }], tz: "Europe/London" }),
    "/api/auto/findings?status=open": async () => ({ findings: [{ id: "f" }] }),
  });
  expect(autoCollection(client)).toBe(autoCollection(client));
  const offA = autoCollection(client).subscribe(() => {});
  const offB = autoCollection(client).subscribe(() => {});
  await settle();
  expect(calls.length).toBe(2);
  emit(["pins"]);
  await settle();
  expect(calls.length).toBe(2);
  emit(["auto"]);
  await settle();
  expect(calls.length).toBe(4);
  offA();
  offB();
});

test("a findings failure keeps the findings on screen; an agents failure does not take findings down", async () => {
  let findingsFail = false;
  let agentsFail = false;
  const { client, emit } = fakeClient({
    "/api/auto/agents": async () => {
      if (agentsFail) throw new Error("agents down");
      return { agents: [{ id: "a" }], tz: "Asia/Hong_Kong" };
    },
    "/api/auto/findings?status=open": async () => {
      if (findingsFail) throw new Error("findings down");
      return { findings: [{ id: "f" }] };
    },
  });
  const collection = autoCollection(client);
  const off = collection.subscribe(() => {});
  await settle();
  findingsFail = true;
  emit(["auto"]);
  await settle();
  expect(collection.peek()?.findings).toEqual([{ id: "f" }]);
  expect(collection.peek()?.findingsError).toBe("Could not load findings. Please try again.");
  findingsFail = false;
  agentsFail = true;
  emit(["auto"]);
  await settle();
  expect(collection.peek()?.agents).toEqual([]);
  expect(collection.peek()?.findings).toEqual([{ id: "f" }]);
  expect(collection.peek()?.findingsError).toBeNull();
  expect(collection.peek()?.tz).toBe("Asia/Hong_Kong");
  off();
});

test("the session and thread screens share one questions read, re-read only on an ask change", async () => {
  const { client, calls, emit } = fakeClient({
    "/api/ask?status=open": async () => ({ questions: [{ id: "q", sessionId: "s" }] }),
  });
  const sessionScreen = openQuestions(client).subscribe(() => {});
  const threadScreen = openQuestions(client).subscribe(() => {});
  await settle();
  expect(calls).toEqual(["/api/ask?status=open"]);
  emit(["auto", "threads"]);
  await settle();
  expect(calls.length).toBe(1);
  emit(["ask"]);
  await settle();
  expect(calls.length).toBe(2);
  expect(openQuestions(client).peek()).toEqual([{ id: "q", sessionId: "s" }]);
  sessionScreen();
  threadScreen();
});
