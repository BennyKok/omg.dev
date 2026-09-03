import { afterEach, describe, expect, test } from "bun:test";
import {
  APPROVE,
  approvalDeliveryText,
  blockedResumeReply,
  clearPendingApproval,
  executionAwaitingApproval,
  heldReply,
  interceptExecuteReplyBody,
  isApproveAnswer,
  parseToolCall,
  pausedApproval,
  pendingApprovalByAsk,
  registerPendingApproval,
  resetPendingApprovalsForTests,
  resumeExecution,
} from "./approvals.ts";

afterEach(() => resetPendingApprovalsForTests());

const PAUSED_REPLY = {
  jsonrpc: "2.0",
  id: 4,
  result: {
    content: [{ type: "text", text: "Execution paused: Approve ...? ..." }],
    structuredContent: {
      status: "waiting_for_interaction",
      executionId: "exec_1",
      interaction: {
        kind: "form",
        message: "Approve executor.github.issues.create? (matched policy: *)",
        address: "executor.github.issues.create",
        args: { title: "hi" },
        requestedSchema: { type: "object", properties: {} },
      },
    },
  },
};

const FORM_REPLY = {
  jsonrpc: "2.0",
  id: 5,
  result: {
    structuredContent: {
      status: "waiting_for_interaction",
      executionId: "exec_2",
      interaction: {
        address: "executor.some.tool",
        requestedSchema: { type: "object", properties: { name: { type: "string" } } },
      },
    },
  },
};

describe("pausedApproval", () => {
  test("recognises an empty-schema approval", () => {
    const p = pausedApproval(PAUSED_REPLY);
    expect(p?.executionId).toBe("exec_1");
    expect(p?.address).toBe("executor.github.issues.create");
    expect(p?.args).toEqual({ title: "hi" });
  });

  test("a real form (fields requested) is not an approval", () => {
    expect(pausedApproval(FORM_REPLY)).toBeNull();
  });

  test("a completed reply is not an approval", () => {
    expect(pausedApproval({ result: { structuredContent: { status: "completed" } } })).toBeNull();
  });
});

describe("parseToolCall", () => {
  test("reads name, id and args from a tools/call", () => {
    const call = parseToolCall(
      JSON.stringify({ jsonrpc: "2.0", id: 9, method: "tools/call", params: { name: "resume", arguments: { executionId: "exec_1", action: "accept" } } }),
    );
    expect(call).toEqual({ id: 9, name: "resume", args: { executionId: "exec_1", action: "accept" } });
  });

  test("returns null for a non-call message", () => {
    expect(parseToolCall(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }))).toBeNull();
    expect(parseToolCall("not json")).toBeNull();
  });
});

describe("interceptExecuteReplyBody", () => {
  test("rewrites a JSON execute reply and reports the pause", () => {
    const out = interceptExecuteReplyBody(JSON.stringify(PAUSED_REPLY), "application/json");
    expect(out?.paused.executionId).toBe("exec_1");
    const body = JSON.parse(out!.heldBody) as ReturnType<typeof heldReply>;
    expect(body.result?.content?.[0]?.text).toContain("needs the owner's approval");
    expect((body.result?.structuredContent as { status: string }).status).toBe("waiting_for_owner_approval");
  });

  test("rewrites the right frame of an SSE reply", () => {
    const sse = `event: message\ndata: ${JSON.stringify(PAUSED_REPLY)}\n\n`;
    const out = interceptExecuteReplyBody(sse, "text/event-stream");
    expect(out).not.toBeNull();
    expect(out!.heldBody).toContain("event: message");
    expect(out!.heldBody).toContain("waiting_for_owner_approval");
    expect(out!.heldBody).not.toContain("waiting_for_interaction");
  });

  test("leaves a completed reply alone", () => {
    const reply = { jsonrpc: "2.0", id: 1, result: { content: [{ type: "text", text: "ok" }] } };
    expect(interceptExecuteReplyBody(JSON.stringify(reply), "application/json")).toBeNull();
  });
});

describe("pending store", () => {
  test("gates resume by execution and resolves by ask", () => {
    registerPendingApproval({ askId: "a1", executionId: "exec_1", sessionId: "s1", address: "x" });
    expect(executionAwaitingApproval("exec_1")).toBe(true);
    expect(executionAwaitingApproval("exec_9")).toBe(false);
    expect(pendingApprovalByAsk("a1")?.executionId).toBe("exec_1");
    clearPendingApproval("a1");
    expect(executionAwaitingApproval("exec_1")).toBe(false);
    expect(pendingApprovalByAsk("a1")).toBeUndefined();
  });

  test("blockedResumeReply names the execution", () => {
    const r = blockedResumeReply(7, "exec_1");
    expect(r.id).toBe(7);
    expect(r.result.isError).toBe(true);
    expect(r.result.content[0]!.text).toContain("exec_1");
  });
});

describe("isApproveAnswer", () => {
  test("recognises approve, rejects deny", () => {
    expect(isApproveAnswer(APPROVE)).toBe(true);
    expect(isApproveAnswer("yes")).toBe(true);
    expect(isApproveAnswer("Deny")).toBe(false);
    expect(isApproveAnswer("")).toBe(false);
  });
});

describe("resumeExecution", () => {
  test("sends accept with the bearer and reports the result", async () => {
    const calls: { url: string; headers: Headers; body: string }[] = [];
    const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(input), headers: new Headers(init?.headers), body: String(init?.body) });
      return Response.json({ status: "completed", text: "3 issues", isError: false });
    }) as unknown as typeof fetch;
    const out = await resumeExecution({ origin: "http://127.0.0.1:4788", token: "sec" }, "exec_1", "accept", fetchImpl);
    expect(out).toEqual({ ok: true, status: "completed", text: "3 issues", isError: false });
    expect(calls[0]!.url).toBe("http://127.0.0.1:4788/api/executions/exec_1/resume");
    expect(calls[0]!.headers.get("authorization")).toBe("Bearer sec");
    expect(calls[0]!.body).toBe('{"action":"accept","content":{}}');
  });

  test("maps an expired approval to a clear reason", async () => {
    const fetchImpl = (async () =>
      Response.json({ _tag: "ApprovalExpiredError" }, { status: 409 })) as unknown as typeof fetch;
    const out = await resumeExecution({ origin: "http://x", token: "t" }, "exec_1", "accept", fetchImpl);
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.error).toContain("window closed");
  });

  test("no upstream is a clean failure", async () => {
    const out = await resumeExecution(null, "exec_1", "accept");
    expect(out.ok).toBe(false);
  });
});

describe("approvalDeliveryText", () => {
  const paused = { address: "executor.github.issues.create", executionId: "exec_1" };

  test("declined says it did not run", () => {
    const text = approvalDeliveryText(paused, false, { ok: false, error: "x" });
    expect(text).toContain("declined");
    expect(text).toContain("did not run");
  });

  test("approved and completed carries the result", () => {
    const text = approvalDeliveryText(paused, true, { ok: true, status: "completed", text: "done", isError: false });
    expect(text).toContain("It ran");
    expect(text).toContain("done");
  });

  test("approved but resume failed reports why", () => {
    const text = approvalDeliveryText(paused, true, { ok: false, error: "unreachable" });
    expect(text).toContain("could not be resumed");
    expect(text).toContain("unreachable");
  });
});
