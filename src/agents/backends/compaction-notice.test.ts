import { expect, test } from "bun:test";
import type { SessionEvent } from "@github/copilot-sdk";
import { watchCopilotCompaction } from "./copilot-sdk-session.ts";
import { piCompactionNotice } from "./pi-session.ts";

test("Copilot maintenance stays silent except on failure, including between turns", () => {
  let listener: ((event: SessionEvent) => void) | undefined;
  const notices: string[] = [];
  const stop = watchCopilotCompaction({
    on(callback) {
      listener = callback;
      return () => { listener = undefined; };
    },
  }, (message) => notices.push(message));
  const emit = (success: boolean, agentId?: string) => listener?.({
    id: crypto.randomUUID(), timestamp: new Date().toISOString(), parentId: null,
    type: "session.compaction_complete", data: { success }, agentId,
  } as SessionEvent);
  emit(true);
  emit(false, "child-agent");
  expect(notices).toEqual([]);
  // No user turn or runTurn listener is needed to receive this event.
  emit(false);
  expect(notices).toEqual(["Copilot could not complete automatic context maintenance."]);
  stop();
  emit(false);
  expect(notices).toHaveLength(1);
});

test("Pi only reports failed automatic compaction after native retries finish", () => {
  const failed = {
    type: "compaction_end" as const, reason: "threshold" as const,
    result: undefined, aborted: false, willRetry: false, errorMessage: "failed",
  };
  expect(piCompactionNotice(failed)).toBe("Pi could not complete automatic context maintenance.");
  expect(piCompactionNotice({ ...failed, willRetry: true })).toBeNull();
  expect(piCompactionNotice({ ...failed, aborted: true })).toBeNull();
  expect(piCompactionNotice({ ...failed, reason: "manual" })).toBeNull();
  expect(piCompactionNotice({ ...failed, errorMessage: undefined })).toBeNull();
  expect(piCompactionNotice({ type: "compaction_start", reason: "threshold" })).toBeNull();
});
