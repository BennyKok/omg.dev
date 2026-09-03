// Role enforcement on a Streamable HTTP MCP endpoint.
//
// Wraps an endpoint handler with two checks, both keyed on the caller's role:
//
//   tools/list  the reply is rewritten so blocked tools are not there.
//   tools/call  a blocked tool is answered with an error result and never
//               reaches the server behind the endpoint.
//
// Both, because an agent that has seen a tool name once can still name it,
// and a list that hides a tool the call path would run is a filter in name
// only. The check is on the JSON-RPC body, not on any server's internals,
// so the same wrapper covers omg's own tools, the Computer tools, and the
// Executor proxy: the server is opaque to it.
//
// Tool ids are `<namespace>.<name>` with the server's own prefix stripped
// (`omg_ship` -> `omg.ship`, `computer_click` -> `computer.click`,
// `execute` -> `executor.execute`), so a rule reads the same whichever
// endpoint the tool lives on.
import { evaluateRole, type Role } from "./roles.ts";

type JsonRpcMessage = {
  jsonrpc?: string;
  id?: number | string | null;
  method?: string;
  params?: { name?: string; [k: string]: unknown };
  result?: { tools?: { name: string }[]; [k: string]: unknown };
};

export interface FilterNamespace {
  /** Policy namespace, e.g. "omg". */
  namespace: string;
  /** Prefix the server puts on its tool names, stripped for the policy id. */
  strip?: string;
}

export function policyToolId(ns: FilterNamespace, toolName: string): string {
  const bare = ns.strip && toolName.startsWith(ns.strip) ? toolName.slice(ns.strip.length) : toolName;
  return `${ns.namespace}.${bare}`;
}

function blockedReply(id: JsonRpcMessage["id"], toolName: string, roleName: string): Response {
  return Response.json(
    {
      jsonrpc: "2.0",
      id: id ?? null,
      result: {
        isError: true,
        content: [
          {
            type: "text",
            text: `Tool "${toolName}" is not available to the ${roleName} role on this box.`,
          },
        ],
      },
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}

function filterTools(message: JsonRpcMessage, role: Role, ns: FilterNamespace): JsonRpcMessage {
  const tools = message.result?.tools;
  if (!Array.isArray(tools)) return message;
  return {
    ...message,
    result: {
      ...message.result,
      tools: tools.filter((tool) => evaluateRole(role, policyToolId(ns, tool.name)) === "allow"),
    },
  };
}

/**
 * Rewrite a tools/list reply. JSON replies are one message; SSE replies are
 * `data:` frames, each one message, and only frames that carry a tool list
 * are touched. Small by construction, so buffering is fine here.
 */
async function rewriteListReply(res: Response, role: Role, ns: FilterNamespace): Promise<Response> {
  const type = res.headers.get("content-type") ?? "";
  const headers = new Headers(res.headers);
  headers.delete("content-length");
  const text = await res.text();
  if (type.includes("text/event-stream")) {
    const out = text
      .split("\n")
      .map((line) => {
        if (!line.startsWith("data:")) return line;
        try {
          const parsed = JSON.parse(line.slice(5).trim()) as JsonRpcMessage;
          return `data: ${JSON.stringify(filterTools(parsed, role, ns))}`;
        } catch {
          return line;
        }
      })
      .join("\n");
    return new Response(out, { status: res.status, headers });
  }
  try {
    const parsed = JSON.parse(text) as JsonRpcMessage | JsonRpcMessage[];
    const filtered = Array.isArray(parsed)
      ? parsed.map((m) => filterTools(m, role, ns))
      : filterTools(parsed, role, ns);
    return new Response(JSON.stringify(filtered), { status: res.status, headers });
  } catch {
    return new Response(text, { status: res.status, headers });
  }
}

/**
 * Apply `role` to one MCP request bound for `handler`.
 *
 * The owner role short-circuits: nothing is parsed and the request body is
 * handed through untouched, so a solo box pays nothing for this layer.
 */
export async function enforceRole(
  req: Request,
  role: Role,
  ns: FilterNamespace,
  handler: (req: Request) => Promise<Response>,
): Promise<Response> {
  if (role.id === "owner" || req.method !== "POST") return handler(req);

  const raw = await req.text();
  let messages: JsonRpcMessage[] = [];
  try {
    const parsed = JSON.parse(raw) as JsonRpcMessage | JsonRpcMessage[];
    messages = Array.isArray(parsed) ? parsed : [parsed];
  } catch {
    // Not JSON-RPC we understand; let the server reject it.
  }
  const forwarded = new Request(req.url, { method: req.method, headers: req.headers, body: raw });

  const call = messages.find((m) => m.method === "tools/call");
  if (call) {
    const name = typeof call.params?.name === "string" ? call.params.name : "";
    if (evaluateRole(role, policyToolId(ns, name)) !== "allow") {
      return blockedReply(call.id, name, role.name);
    }
  }

  const res = await handler(forwarded);
  if (messages.some((m) => m.method === "tools/list")) {
    return rewriteListReply(res, role, ns);
  }
  return res;
}
