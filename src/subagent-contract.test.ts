// The instruction that carries a background session's result home.
//
// A bot answers in chat and hands heavy work to a task session; that session's
// report is the only way the work ever reaches the human. The contract named
// `lfg_send_session_message` long after the tools were registered as `omg_*` —
// inbound `lfg_*` calls are still aliased at the wire, but a name that appears
// in no tool catalog is one the model has to guess at first, and a guess that
// misses looks exactly like a background task that did nothing.
import { describe, expect, test } from "bun:test";

import { withOmgSubagentContract } from "./commands/serve.ts";

describe("subagent operating contract", () => {
  test("names tools that are actually registered", () => {
    const contract = withOmgSubagentContract("Rebase onto main", {
      parentSessionId: "93b246d0-a0f1-4beb-a22c-d64a6f1f7436",
      depth: 1,
    });
    expect(contract).toContain("omg_send_session_message");
    expect(contract).toContain("omg_create_subagent");
    expect(contract).toContain("omg_delegate_*");
    expect(contract).not.toContain("lfg_send_session_message");
    expect(contract).not.toContain("lfg_create_subagent");
  });

  test("still carries the parent id and the task", () => {
    const contract = withOmgSubagentContract("Rebase onto main", {
      parentSessionId: "93b246d0-a0f1-4beb-a22c-d64a6f1f7436",
    });
    // Short id: the MCP layer resolves any unambiguous prefix.
    expect(contract).toContain("93b246d0");
    expect(contract).toContain("Rebase onto main");
    expect(contract).toContain("[subagent progress]");
    expect(contract).toContain("[subagent complete]");
  });

  test("without a parent, the child reports in its final response instead", () => {
    const contract = withOmgSubagentContract("Do the thing", {});
    expect(contract).toContain("include progress and terminal state in your final response");
    expect(contract).not.toContain("[subagent progress]");
  });
});
