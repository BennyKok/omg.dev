// The agent-facing connector surface: `/mcp/connectors?session=<id>`.
//
// omg exposes the calling session's member connectors (their own plus
// org-shared) as namespaced tools `<connectorSlug>__<tool>`, backed by the hub
// (./hub.ts). This is the native replacement for `/mcp/executor`: no daemon,
// credentials injected host-side, and the tool set is scoped to the session's
// member, so all of a member's agents share their connections and see no one
// else's.
//
// A minimal, stateless JSON-RPC responder rather than the McpServer builder:
// connectors only proxy, and passing the remote tools' JSON Schemas straight
// through preserves them exactly (the Zod round-trip McpServer needs would
// flatten them). Role filtering and approval are applied by the caller in
// serve.ts, on the `connectors.<slug>.<tool>` id.
import { connectorsForOwner, type Connector } from "./store.ts";
import { callConnectorTool, listConnectorTools } from "./hub.ts";

export const NS = "__";

export function connectorToolName(slug: string, tool: string): string {
  return `${slug}${NS}${tool}`;
}

export function splitConnectorTool(name: string): { slug: string; tool: string } | null {
  const idx = name.indexOf(NS);
  if (idx <= 0) return null;
  return { slug: name.slice(0, idx), tool: name.slice(idx + NS.length) };
}

/**
 * Decide whether a tool call runs now or is held for owner approval. serve.ts
 * supplies the real gate (post an ask, hold the call); the default runs inline,
 * which is what a connector without `requireApproval` wants.
 */
export type ApprovalGate = (
  connector: Connector,
  tool: string,
  args: Record<string, unknown>,
) => Promise<{ held: true; text: string } | { held: false }>;

const runInline: ApprovalGate = async () => ({ held: false });

type Rpc = { jsonrpc?: string; id?: number | string | null; method?: string; params?: Record<string, unknown> };

/** The tools this owner's connectors expose, namespaced, with a slug index. */
export async function listOwnerTools(owner: string): Promise<{
  tools: { name: string; description: string; inputSchema: unknown }[];
  bySlug: Map<string, Connector>;
}> {
  const connectors = connectorsForOwner(owner);
  const bySlug = new Map(connectors.map((c) => [c.slug, c]));
  const tools: { name: string; description: string; inputSchema: unknown }[] = [];
  for (const connector of connectors) {
    let connectorTools;
    try {
      connectorTools = await listConnectorTools(connector);
    } catch {
      continue; // an unreachable connector is skipped, not fatal
    }
    for (const t of connectorTools) {
      tools.push({
        name: connectorToolName(connector.slug, t.name),
        description: `${connector.name}: ${t.description}`.trim(),
        inputSchema: t.inputSchema ?? { type: "object", properties: {} },
      });
    }
  }
  return { tools, bySlug };
}

async function handleMessage(msg: Rpc, owner: string, gate: ApprovalGate): Promise<Rpc | null> {
  const id = msg.id ?? null;
  switch (msg.method) {
    case "initialize":
      return {
        jsonrpc: "2.0",
        id,
        result: {
          protocolVersion: "2025-06-18",
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: "omg-connectors", version: "0.1.0" },
        },
      } as Rpc;
    case "notifications/initialized":
    case "notifications/cancelled":
      return null; // notifications get no response
    case "tools/list": {
      const { tools } = await listOwnerTools(owner);
      return { jsonrpc: "2.0", id, result: { tools } } as Rpc;
    }
    case "tools/call": {
      const name = String(msg.params?.name ?? "");
      const args = (msg.params?.arguments as Record<string, unknown>) ?? {};
      const split = splitConnectorTool(name);
      const bySlug = new Map(connectorsForOwner(owner).map((c) => [c.slug, c]));
      const connector = split ? bySlug.get(split.slug) : undefined;
      if (!split || !connector) {
        return { jsonrpc: "2.0", id, result: toolError(`unknown connector tool "${name}"`) } as Rpc;
      }
      const decision = await gate(connector, split.tool, args);
      if (decision.held) {
        return { jsonrpc: "2.0", id, result: { content: [{ type: "text", text: decision.text }] } } as Rpc;
      }
      try {
        const result = await callConnectorTool(connector, split.tool, args);
        const content = Array.isArray(result.content)
          ? result.content
          : [{ type: "text", text: JSON.stringify(result.content) }];
        return { jsonrpc: "2.0", id, result: { content, isError: result.isError } } as Rpc;
      } catch (e) {
        return { jsonrpc: "2.0", id, result: toolError(e instanceof Error ? e.message : String(e)) } as Rpc;
      }
    }
    default:
      if (id === null) return null;
      return { jsonrpc: "2.0", id, error: { code: -32601, message: `method not found: ${msg.method}` } } as Rpc;
  }
}

function toolError(text: string) {
  return { isError: true, content: [{ type: "text", text }] };
}

/** Answer one `/mcp/connectors` request for `owner`. */
export async function serveConnectorsMcpRequest(
  req: Request,
  owner: string,
  gate: ApprovalGate = runInline,
): Promise<Response> {
  if (req.method === "GET") {
    // No server-initiated stream; the client falls back to POST request/response.
    return new Response(null, { status: 405, headers: { "Cache-Control": "no-store" } });
  }
  if (req.method !== "POST") return new Response(null, { status: 405 });
  let parsed: unknown;
  try {
    parsed = await req.json();
  } catch {
    return Response.json({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "parse error" } }, { status: 400 });
  }
  const batch = Array.isArray(parsed);
  const messages = (batch ? parsed : [parsed]) as Rpc[];
  const responses: Rpc[] = [];
  for (const m of messages) {
    const r = await handleMessage(m, owner, gate);
    if (r) responses.push(r);
  }
  const headers = { "Cache-Control": "no-store" } as Record<string, string>;
  if (responses.length === 0) return new Response(null, { status: 202, headers });
  return Response.json(batch ? responses : responses[0], { headers });
}
