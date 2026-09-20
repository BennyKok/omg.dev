import { expect, test } from "bun:test";
import { startPendingSession, getPendingSession, clearPendingSessions } from "../mobile/src/omg/pending-session";
test("prompt is available before creation resolves and only in its original scope", async () => {
  let resolve!: (value: {sessionId: string}) => void;
  const pending = startPendingSession("alice:mac", "Build a thing", () => new Promise(r => { resolve = r; }));
  expect(getPendingSession(pending.token, "alice:mac")?.prompt).toBe("Build a thing");
  expect(getPendingSession(pending.token, "bob:mac")).toBeNull();
  await Promise.resolve(); resolve({ sessionId: "created" });
  expect(await pending.result).toBe("created"); clearPendingSessions();
});
test("creation failure preserves the prompt and never retries a possibly accepted POST", async () => {
  let calls = 0;
  const pending = startPendingSession("alice:mac", "Keep this", async () => { calls++; throw Error("Connection lost"); });
  await expect(pending.result).rejects.toThrow("Connection lost");
  expect(getPendingSession(pending.token, "alice:mac")?.prompt).toBe("Keep this");
  expect(calls).toBe(1); clearPendingSessions();
});
