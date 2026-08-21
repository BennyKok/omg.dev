// Who is allowed to interrupt a bot mid-reply.
//
// /api/sessions/:id/send carries both a human at a composer and a background
// child reporting home. They want opposite things from a persistent bot
// session: the human is correcting it and should cut in; the child is
// machinery and must wait, or the human watches their answer get truncated by
// a `[subagent progress]` line they never asked for.
import { describe, expect, test } from "bun:test";

import { agentUpdateSendMode } from "./commands/serve.ts";

describe("send mode into a bot session", () => {
  test("a background child's update queues behind the live turn", () => {
    expect(agentUpdateSendMode(undefined, { fromSessionId: "child", targetPersistent: true }))
      .toBe("queue");
    // Even when the child explicitly asks to steer.
    expect(agentUpdateSendMode("steer", { fromSessionId: "child", targetPersistent: true }))
      .toBe("queue");
  });

  test("a human keeps the right to interrupt the same session", () => {
    expect(agentUpdateSendMode(undefined, { targetPersistent: true })).toBe("steer");
    expect(agentUpdateSendMode("queue", { targetPersistent: true })).toBe("queue");
  });

  test("an ordinary task session is unchanged — steering home is how subagents report", () => {
    expect(agentUpdateSendMode(undefined, { fromSessionId: "child" })).toBe("steer");
    expect(agentUpdateSendMode("queue", { fromSessionId: "child" })).toBe("queue");
    expect(agentUpdateSendMode(undefined, {})).toBe("steer");
  });
});
