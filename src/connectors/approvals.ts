// Owner approval for a connector tool call, answered from chat.
//
// A connector marked requireApproval does not run from the agent. The
// /mcp/connectors gate (wired in serve.ts) posts an Approve/Deny ask to the
// session and holds the call: the pending record here keeps the connector id,
// tool, and arguments so the owner's answer can run it. On Approve the hub
// makes the call with the credential injected and the result is delivered into
// the session; on Deny the agent is told it was refused.
//
// In memory on purpose: a held call is transient, and a serve restart drops
// the agent's turn and this map together.
import { callConnectorTool } from "./hub.ts";
import { getConnector, type Connector } from "./store.ts";

export interface PendingConnectorApproval {
  askId: string;
  sessionId: string;
  connectorId: string;
  connectorName: string;
  tool: string;
  args: Record<string, unknown>;
  createdAt: number;
}

const byAsk = new Map<string, PendingConnectorApproval>();

export function registerPendingConnectorApproval(input: Omit<PendingConnectorApproval, "createdAt">): void {
  byAsk.set(input.askId, { ...input, createdAt: Date.now() });
}

export function pendingConnectorApprovalByAsk(askId: string): PendingConnectorApproval | undefined {
  return byAsk.get(askId);
}

export function clearPendingConnectorApproval(askId: string): void {
  byAsk.delete(askId);
}

export function resetPendingConnectorApprovalsForTests(): void {
  byAsk.clear();
}

export const APPROVE = "Approve";
export const DENY = "Deny";

export function isApproveAnswer(answer: string | null | undefined): boolean {
  const a = (answer ?? "").trim().toLowerCase();
  return a === APPROVE.toLowerCase() || a === "yes" || a === "ok" || a === "y" || a === "approve it";
}

/** The question shown on the ask card. */
export function connectorApprovalQuestion(connector: Connector, tool: string, args: Record<string, unknown>): string {
  const shown = JSON.stringify(args ?? {}, null, 2);
  const trimmed = shown.length > 800 ? `${shown.slice(0, 800)}\n…` : shown;
  return `Approve \`${connector.name}\` → \`${tool}\`?\n\nArguments:\n\`\`\`json\n${trimmed}\n\`\`\``;
}

/** The reply the agent gets instead of the tool result while it waits. */
export function heldText(connector: Connector, tool: string): string {
  return (
    `\`${connector.name}.${tool}\` needs the owner's approval. ` +
    `The owner was asked in the omg chat with Approve / Deny. ` +
    `Do not retry; the result, or the refusal, will arrive as the owner's reply. End your turn now.`
  );
}

export type ApprovalOutcome = { approved: boolean; text: string };

/**
 * Run (or refuse) a held connector call after the owner answered. Used by the
 * /api/ask answer route. Never throws; a failed call becomes a readable note.
 */
export async function resolveConnectorApproval(
  pending: PendingConnectorApproval,
  approved: boolean,
): Promise<ApprovalOutcome> {
  if (!approved) {
    return {
      approved: false,
      text: `The owner declined \`${pending.connectorName}.${pending.tool}\`. It did not run. Do not retry it; continue without it or ask what to do instead.`,
    };
  }
  const connector = getConnector(pending.connectorId);
  if (!connector) {
    return { approved: true, text: `The owner approved \`${pending.connectorName}.${pending.tool}\`, but the connector is gone. It did not run.` };
  }
  try {
    const result = await callConnectorTool(connector, pending.tool, pending.args);
    const body = JSON.stringify(result.content);
    const head = result.isError
      ? `The owner approved \`${connector.name}.${pending.tool}\`. It ran and returned an error.`
      : `The owner approved \`${connector.name}.${pending.tool}\`. It ran. Result:`;
    return { approved: true, text: `${head}\n\n${body}` };
  } catch (e) {
    return {
      approved: true,
      text: `The owner approved \`${connector.name}.${pending.tool}\`, but it failed: ${e instanceof Error ? e.message : String(e)}.`,
    };
  }
}
