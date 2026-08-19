// Who is reporting.
//
// A human message to a bot has always said who sent it. An agent's did not, so
// a bot running two background tasks received two anonymous `[subagent
// complete] …` reports and had to guess which was which from the prose.
import { describe, expect, test } from "bun:test";

import { attributedAgentUpdate } from "./commands/serve.ts";

const CHILD = "cde6c958-e470-4ee5-bd22-28722919ee65";

describe("attributing an agent update to a bot", () => {
  test("names the task and its short id", () => {
    const out = attributedAgentUpdate("[subagent complete] rebased onto main", {
      fromSessionId: CHILD,
      senderTitle: "Rebase the mobile branch",
      targetPersistent: true,
    });
    expect(out).toStartWith("[Background task Rebase the mobile branch · cde6c958]");
    // The report itself is untouched below the wrapper.
    expect(out).toContain("[subagent complete] rebased onto main");
  });

  test("falls back to the id when the task has no title", () => {
    const out = attributedAgentUpdate("done", { fromSessionId: CHILD, targetPersistent: true });
    expect(out).toStartWith("[Background task cde6c958]");
  });

  test("collapses and truncates a runaway title", () => {
    const out = attributedAgentUpdate("done", {
      fromSessionId: CHILD,
      senderTitle: "  a\n\nvery   long ".concat("x".repeat(200)),
      targetPersistent: true,
    });
    // Bounded and on one line: the header is a label, not a paragraph.
    const header = out.split("\n")[0];
    expect(header.length).toBeLessThanOrEqual(96);
    expect(header).toStartWith("[Background task a very long");
    expect(header).toEndWith("]");
  });

  test("leaves a human's message alone", () => {
    // No fromSessionId means a person at a composer; their text is their own.
    expect(attributedAgentUpdate("hey", { targetPersistent: true })).toBe("hey");
  });

  test("leaves a task session's inbox alone", () => {
    // A task session reading a child's report is reading a log, and its
    // transcript already shows the sender.
    expect(attributedAgentUpdate("done", { fromSessionId: CHILD, targetPersistent: false }))
      .toBe("done");
  });
});
