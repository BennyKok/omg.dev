import { describe, expect, test } from "bun:test";
import { withoutCompactionNoise } from "./compaction-rows";
import { classifyUserTurn } from "./system-message";

// The rows an idle compaction wrote in a real session (23c23411, order 615-618).
const notice = {
  role: "assistant",
  kind: "text",
  text: "This conversation's prompt cache is expected to expire soon. If the session stays idle, omg.dev will summarize older context automatically. You do not need to take any action.",
};
const summary = {
  role: "user",
  kind: "text",
  text: "This session is being continued from a previous conversation that ran out of context. The summary below covers the earlier portion of the conversation.\n\nSummary:\n1. Primary Request and Intent: ship City Pop.",
};
const echo = { role: "user", kind: "text", text: "<local-command-stdout>Compacted </local-command-stdout>" };
const answer = { role: "assistant", kind: "text", text: "City Pop is built and live." };

describe("a compaction is one row", () => {
  test("only the summary is left of the three rows", () => {
    expect(withoutCompactionNoise([answer, notice, summary, echo])).toEqual([answer, summary]);
  });

  test("the summary reads as the event, with the summary one tap away", () => {
    const system = classifyUserTurn(summary.text);
    expect(system?.kind).toBe("compaction");
    expect(system?.label).toBe("Conversation compacted");
    expect(system?.body.startsWith("The summary below covers")).toBe(true);
  });

  test("a warning the person answered by coming back stays", () => {
    const rows = [answer, notice, { role: "user", kind: "text", text: "I'm back" }];
    expect(withoutCompactionNoise(rows)).toBe(rows);
  });

  test("a /compact the person typed keeps their command", () => {
    const typed = { role: "user", kind: "text", text: "/compact" };
    expect(withoutCompactionNoise([typed, summary, echo])).toEqual([typed, summary]);
  });

  test("nothing else is touched", () => {
    const rows = [answer, { role: "user", kind: "text", text: "Compacted the CSS, thanks" }];
    expect(withoutCompactionNoise(rows)).toBe(rows);
  });
});
