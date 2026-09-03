// Approval-gated connector calls, answered from the omg chat.
//
// Executor pauses a gated tool call and, in the `model` elicitation mode this
// box runs, tells the agent to ask the human and then call `resume` itself.
// That leaves the decision with the agent. This module takes it back:
//
//   execute reply says waiting_for_interaction with an empty requested schema
//     -> record it as an omg ask with Approve / Deny, rewrite the reply so the
//        agent waits instead of resuming
//   agent calls resume on that execution
//     -> refused while the ask is open
//   human answers the ask
//     -> omg resumes the execution over Executor's REST API with the bearer,
//        and the outcome is delivered into the session as the answer
//
// Interactions that request real form fields (a non-empty schema) are not
// approvals; those keep Executor's own agent-driven flow untouched.
import { type ExecutorUpstream } from "./proxy.ts";

// ---------------------------------------------------------------------------
// Wire parsing. A tools/call request is one JSON object; an execute reply
// over this transport is a single SSE `data:` frame (or JSON when the daemon
// answers JSON). These helpers read and rewrite that one reply without caring
// which framing it used.
// ---------------------------------------------------------------------------

export type ParsedToolCall = { id: number | string | null; name: string; args: Record<string, unknown> };

export function parseToolCall(requestText: string): ParsedToolCall | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(requestText);
  } catch {
    return null;
  }
  const messages = Array.isArray(parsed) ? parsed : [parsed];
  for (const message of messages) {
    const m = message as { id?: number | string | null; method?: string; params?: { name?: string; arguments?: unknown } };
    if (m.method === "tools/call" && typeof m.params?.name === "string") {
      const args = (m.params.arguments ?? {}) as Record<string, unknown>;
      return { id: m.id ?? null, name: m.params.name, args };
    }
  }
  return null;
}

/** Split a response body into (prefix line pieces) and the one JSON-RPC reply. */
function readReply(text: string, contentType: string): { reply: JsonRpcReply; put: (next: JsonRpcReply) => string } | null {
  if (contentType.includes("text/event-stream")) {
    const lines = text.split("\n");
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i]!;
      if (!line.startsWith("data:")) continue;
      try {
        const reply = JSON.parse(line.slice(5).trim()) as JsonRpcReply;
        if (!reply.result) continue;
        return {
          reply,
          put: (next) => {
            const copy = [...lines];
            copy[i] = `data: ${JSON.stringify(next)}`;
            return copy.join("\n");
          },
        };
      } catch {
        // not this frame
      }
    }
    return null;
  }
  try {
    const reply = JSON.parse(text) as JsonRpcReply;
    return { reply, put: (next) => JSON.stringify(next) };
  } catch {
    return null;
  }
}

/** Detect an approval in a forwarded execute reply, and the rewritten body. */
export function interceptExecuteReplyBody(
  text: string,
  contentType: string,
): { paused: PausedInteraction; id: number | string | null; heldBody: string } | null {
  const found = readReply(text, contentType);
  if (!found) return null;
  const paused = pausedApproval(found.reply);
  if (!paused) return null;
  return { paused, id: found.reply.id ?? null, heldBody: found.put(heldReply(found.reply, paused)) };
}

export type PausedInteraction = {
  executionId: string;
  address: string;
  args: unknown;
  message: string;
};

type JsonRpcReply = {
  id?: number | string | null;
  result?: {
    content?: { type: string; text?: string }[];
    structuredContent?: {
      status?: string;
      executionId?: string;
      interaction?: {
        kind?: string;
        message?: string;
        address?: string;
        args?: unknown;
        requestedSchema?: { properties?: Record<string, unknown> };
      };
      [k: string]: unknown;
    };
    [k: string]: unknown;
  };
};

/** The approval this reply is asking for, or null when it is not one. */
export function pausedApproval(reply: JsonRpcReply): PausedInteraction | null {
  const sc = reply.result?.structuredContent;
  if (!sc || sc.status !== "waiting_for_interaction" || !sc.executionId) return null;
  const interaction = sc.interaction;
  if (!interaction?.address) return null;
  const fields = Object.keys(interaction.requestedSchema?.properties ?? {});
  if (fields.length > 0) return null;
  return {
    executionId: sc.executionId,
    address: interaction.address,
    args: interaction.args ?? {},
    message: interaction.message ?? `Approve ${interaction.address}?`,
  };
}

/** The reply the agent sees instead of Executor's "ask, then resume" text. */
export function heldReply(reply: JsonRpcReply, paused: PausedInteraction): JsonRpcReply {
  const text =
    `Execution paused: ${paused.address} needs the owner's approval.\n\n` +
    `The owner has been asked in the omg chat with Approve / Deny. ` +
    `Do not call resume; the result of this call, or the refusal, will arrive as the owner's reply. ` +
    `End your turn now.\n\nexecutionId: ${paused.executionId}`;
  return {
    ...reply,
    result: {
      ...reply.result,
      content: [{ type: "text", text }],
      structuredContent: {
        status: "waiting_for_owner_approval",
        executionId: paused.executionId,
        address: paused.address,
      },
    },
  };
}

/** The question text the human sees on the ask card. */
export function approvalQuestion(paused: PausedInteraction): string {
  const args = JSON.stringify(paused.args ?? {}, null, 2);
  const shownArgs = args.length > 800 ? `${args.slice(0, 800)}\n…` : args;
  return `Approve connector call \`${paused.address}\`?\n\nArguments:\n\`\`\`json\n${shownArgs}\n\`\`\``;
}

export const APPROVE = "Approve";
export const DENY = "Deny";

export function isApproveAnswer(answer: string | null | undefined): boolean {
  const a = (answer ?? "").trim().toLowerCase();
  return a === APPROVE.toLowerCase() || a === "yes" || a === "approve it" || a === "ok" || a === "y";
}

export type ResumeOutcome =
  | { ok: true; status: "completed" | "paused"; text: string; isError: boolean }
  | { ok: false; error: string };

/**
 * Resume a paused execution on the human's behalf.
 *
 * Executor's REST resume, with the daemon bearer this process holds. The
 * agent never gets to make this call for an approval; only an answered ask
 * does.
 */
export async function resumeExecution(
  upstream: ExecutorUpstream | null,
  executionId: string,
  action: "accept" | "decline",
  fetchImpl: typeof fetch = fetch,
): Promise<ResumeOutcome> {
  if (!upstream) return { ok: false, error: "the connector gateway is not running" };
  try {
    const res = await fetchImpl(`${upstream.origin}/api/executions/${encodeURIComponent(executionId)}/resume`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${upstream.token}`,
        "content-type": "application/json",
        accept: "application/json",
      },
      body: JSON.stringify({ action, content: {} }),
      signal: AbortSignal.timeout(120_000),
    });
    const body = (await res.json().catch(() => null)) as
      | { status?: string; text?: string; isError?: boolean; _tag?: string; message?: string }
      | null;
    if (!res.ok) {
      const reason = body?._tag === "ApprovalExpiredError"
        ? "the approval window closed before the answer arrived; nothing ran"
        : body?.message || body?._tag || `status ${res.status}`;
      return { ok: false, error: reason };
    }
    return {
      ok: true,
      status: body?.status === "paused" ? "paused" : "completed",
      text: body?.text ?? "",
      isError: body?.isError === true,
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "the connector gateway is unreachable" };
  }
}

// ---------------------------------------------------------------------------
// Pending approvals: which omg ask stands in for which paused execution.
//
// In-memory on purpose. An executionId is ephemeral, Executor expires an
// unanswered approval on its own, and a serve restart drops both the daemon's
// pending execution and this map together — a restart mid-approval is a lost
// approval on both sides, not a dangling one. Keyed by ask id (the human
// answers an ask) with a reverse index by execution id (the agent's resume
// names an execution).
// ---------------------------------------------------------------------------

export interface PendingApproval {
  askId: string;
  executionId: string;
  sessionId: string;
  address: string;
  createdAt: number;
}

const byAsk = new Map<string, PendingApproval>();
const byExecution = new Map<string, PendingApproval>();

export function registerPendingApproval(input: Omit<PendingApproval, "createdAt">): void {
  const record: PendingApproval = { ...input, createdAt: Date.now() };
  byAsk.set(record.askId, record);
  byExecution.set(record.executionId, record);
}

export function pendingApprovalByAsk(askId: string): PendingApproval | undefined {
  return byAsk.get(askId);
}

/** True while an execution is waiting on an omg approval, so resume is refused. */
export function executionAwaitingApproval(executionId: string): boolean {
  return byExecution.has(executionId);
}

export function clearPendingApproval(askId: string): void {
  const record = byAsk.get(askId);
  if (!record) return;
  byAsk.delete(record.askId);
  byExecution.delete(record.executionId);
}

/** Test seam. */
export function resetPendingApprovalsForTests(): void {
  byAsk.clear();
  byExecution.clear();
}

/** The reply an agent gets if it tries to resume an owner-gated execution. */
export function blockedResumeReply(id: number | string | null | undefined, executionId: string): {
  jsonrpc: "2.0";
  id: number | string | null;
  result: { isError: true; content: { type: "text"; text: string }[] };
} {
  return {
    jsonrpc: "2.0",
    id: id ?? null,
    result: {
      isError: true,
      content: [
        {
          type: "text",
          text: `Execution ${executionId} is waiting for the owner's approval in the omg chat. You cannot resume it. End your turn; the outcome will arrive as the owner's reply.`,
        },
      ],
    },
  };
}

/** The message delivered into the session once the human has answered. */
export function approvalDeliveryText(
  paused: { address: string; executionId: string },
  approved: boolean,
  outcome: ResumeOutcome,
): string {
  if (!approved) {
    return `The owner declined the connector call ${paused.address} (execution ${paused.executionId}). It did not run. Do not retry it; continue without it or ask what to do instead.`;
  }
  if (!outcome.ok) {
    return `The owner approved ${paused.address} (execution ${paused.executionId}) but it could not be resumed: ${outcome.error}.`;
  }
  if (outcome.status === "paused") {
    return `The owner approved ${paused.address} (execution ${paused.executionId}). The execution paused again for another interaction; call resume with that execution id as Executor instructs.\n\n${outcome.text}`;
  }
  const head = outcome.isError
    ? `The owner approved ${paused.address} (execution ${paused.executionId}). It ran and returned an error.`
    : `The owner approved ${paused.address} (execution ${paused.executionId}). It ran. Result:`;
  return `${head}\n\n${outcome.text}`;
}
